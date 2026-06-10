const { clearTimeout } = require('timers');
const { IP_ADDRESS, NODE_TYPE_PORT, TYPE_BLE, TYPE_BRIDGE } = require('./net'); 
const TYPE = process.argv[2]; 


//////////////////////////////
// Run the BLE edge-process //
//////////////////////////////
if (TYPE == TYPE_BLE) {

    /* BLE Serial modules */
    const { parser, serialWrite, serialDelay, serialDrain } = require('./serial'); 

    let pastTrigger = false;
    let currentParams = { trigger : false };
    let time0 = 0; 

    /* 
     * UART-Rx: on receive data from UART-Tx device (Nordic nRF52480-DK)    
     *
     *  >>> Edge Process: send state vector data {t, x, z, ϑ, {z_j, ..., z_k}} to backend-process
     */
    parser.on('data', (data) => {
        
        const line = data.replace(/\r/g, '').replace(/\n/g, '');
        if (!currentParams.trigger) {
            console.log(`[SERIAL RX] ${line}`);
        }

        const msgType = line[0]; 
        if (msgType == 'd') {
            
            const arr = line.slice(1).split(',');
            const now = Date.now() - time0; 
            const state = { 
                timestamp: now, 
                state: arr[1], 
                vstate: arr[2], 
                vartheta: arr[3], 
                neighborVStates: arr.slice(4) 
            };
            process.send(state); 
        }
    })

    /**
     * Edge process: BLE
     */
    process.on('message', async (params) => {
        /**
         * 3 tyoes of messages from backend-process update experimental parameteres: 
         *  (1) Network params: 
         *      { enabled, node, neighbors } --> 'n'
         *  (2.1) Coordination Algorithm params updated to: 
         *      { clock, dt, state, vstate, vartheta, eta, alpha, delta, consensual_avg_law } --> 'a'
         *  (2.2) Coordination Disturbance params update to : 
         *      { amplitude, offset, beta, A, f, phi, N_samples } --> 'p'
         *  (3) Trigger params: 
         *      { trigger } --> 't'
         */
        const msgNetwork = `n${params.enabled ? 1 : 0},${params.node},${params.neighbors.join(',')}\n\r`;
        /* Split in two messages to avoid overflow in nordic uart buffer (defined as 64 bytes) */
        const msgCoordination = `a${params.clock},${params.dt},${params.state},${params.vstate},`+
            `${params.vartheta},${params.eta},${params.alpha},${params.delta},`+
            `${params.consensual_avg_law ? 1 : 0}\n\r`; 
        const msgDisturbance = `p${params.disturbance.disturbance_on ? 1 : 0},${params.disturbance.amplitude},`+
            `${params.disturbance.offset},${params.disturbance.beta},${params.disturbance.Amp},`+
            `${params.disturbance.frequency},${params.disturbance.phase},${params.disturbance.samples}\n\r`;
        const msgTrigger = `t${params.trigger ? 1 : 0}\n\r`;

        try {

            await serialWrite(msgNetwork); 
            await serialDrain(); 
            await serialDelay();
            
            await serialWrite(msgCoordination);
            await serialDrain();
            await serialDelay();

            await serialWrite(msgDisturbance);
            await serialDrain();
            await serialDelay();

            if ((params.trigger && !pastTrigger) || (!params.trigger && pastTrigger)) {
                await serialDelay();
                await serialWrite(msgTrigger);
                pastTrigger = params.trigger;
            }

            currentParams = params;
            console.log('Edge-Server params updated successfully: ', params);

        } catch (error) {
            console.error('Edge-Server error updating params: ', error);
        }
    }); 


/////////////////////////////////////////
// Run the WIFI or BRIDGE edge-process //
/////////////////////////////////////////
} else { 

    const http = require('http');
    const axios = require('axios');
    const { algo } = require('./algo');
    const express = require('express');
    const { spawn } = require('child_process')
    const { bleGetDevices, bleGetState, bleGenerateManufacturerData, bleStopDiscovery, bleCleanup } = require('./ble');

    /* HTTP server (express-server) and configure middleware to parse JSON bodies for express-server */
    const app = express();
    const server = http.createServer(app);
    app.use(express.json());

    /* Raspberry Pi BLE module */
    let advProcess = null;
    let bleNeighbors = {};
    let bleRestartDelay = 100;          // ms; doubles on each failure
    let bleRestartTimer = null;         // pending restart, if any
    const BLE_RESTART_MAX = 1000;       // cap at 1 s
    const BLE_RESTART_MIN = 100;        // initial / reset value

    /**
     * Data stored in RAM fro coordination:
     * - parameters
     * - variables
     * 
     * New configuration posted in /updateParams route
     */
    let params = { trigger: false }; 
    
    /* Global vairbales for the coordination alogrithm execution */
    let dynamicsLoopTimeoutId = null;     // ID for the dynamics loop (fast: dt time-step)
    let networkLoopTimeoutId = null;      // ID for the network fetch loop (slow: clock time-step)
    let isInitial = true;
    let time0 = 0; 
    /* State vector buffer: {t, x, z, ϑ, {z_j, ..., z_k}} */
    let state = {};
    /* Shared buffers for decoupled loops: dynamics and network fetching */
    let latestNeighborVStates = [];
    let latestNeighborEnabled = [];

    /**
     * Auxiliary function for starting/stopping BLE (bridge configuration)
     * 
     * Restarts advertising process (BlueZ-based) if any error
     */
    function startBleBridge() {
        const data = bleGenerateManufacturerData(params.enabled, params.node, state.vstate); 
        advProcess = spawn('./bleadv.sh', [data], { stdio: ['pipe', 'ignore', 'ignore']}); 

        advProcess.on('exit', (code, _signal) => {
            if (code === 0 || !params.trigger) {
                bleRestartDelay = BLE_RESTART_MIN;
                return;
            }
            console.log(`[BLE] adv exited code=${code} signal=${_signal}; restart in ${bleRestartDelay}ms`);
            console.log(new Error().stack);
            bleRestartTimer = setTimeout(() => {
                bleRestartTimer = null;
                startBleBridge();
                bleRestartDelay = Math.min(bleRestartDelay * 2, BLE_RESTART_MAX);
            }, bleRestartDelay);
        });

        advProcess.on('error', (err) => console.error('[BLE] spawn failed:', err.message)); 
    }
 
    function stopBleBridge() {
        if (bleRestartTimer) { clearTimeout(bleRestartTimer); bleRestartTimer = null; }
        bleRestartDelay = BLE_RESTART_MIN;
        if (advProcess && !advProcess.killed) {
            advProcess.removeAllListeners('exit'); 
            try {
                if (advProcess.stdin?.writable) { advProcess.stdin.write('advertise off\r'); }
            } catch (_) { /* ignore */ }
            advProcess.kill();
        }
        advProcess = null;
    }

    function withTimeout(promise, ms, fallback) {
        let timer; 
        promise.catch(() => {}); 
        const timeout = new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); }); 
        return Promise.race([promise, timeout]).finally(() => clearTimeout(timer)); 
    }


    /**
     * Needed function for neighbor data fetching
     */
    const _neighborStateCache = new Map();
    const NEIGHBOR_CACHE_MAX_AGE_MS = 2000;

    async function getNeighborStates() {
        const fetchTimeoutMs = Math.max(50, Math.floor((params.clock ?? 1000) / 2));
        const now = Date.now();

        const results = await Promise.all(params.neighbors.map(async (id) => {
            try {
                let fresh;

                if (params.neighborTypes[id] === TYPE_BLE) {
                    const data = await withTimeout(
                        bleGetState(bleNeighbors[id]), fetchTimeoutMs, null  
                    );
                    if (data === null || data.vstate === null || data.ok === false) {
                        throw new Error('BLE state unavailable');
                    }
                    fresh = { vstate:  Number(data.vstate), enabled: Boolean(data.enabled),
                    };
                } else {
                    const response = await axios.get(
                        `${params.neighborAddresses[id]}/getVState`,
                        { timeout: fetchTimeoutMs }
                    );
                    fresh = { vstate:  Number(response.data.vstate), enabled: Boolean(response.data.enabled),
                    };
                }

                _neighborStateCache.set(id, { ...fresh, ts: now });
                return { ...fresh, received: true };

            } catch (err) {
                const cached = _neighborStateCache.get(id);
                if (cached && (now - cached.ts) < NEIGHBOR_CACHE_MAX_AGE_MS) {
                    return { vstate: cached.vstate, enabled: false, received: false };
                }
                // No cache or cache too stale — neighbor truly unavailable.
                return { vstate: 0, enabled: false, received: false };
            }
        }));

        return {
            neighborVStates:  results.map(r => r.vstate),
            neighborEnabled:  results.map(r => r.enabled),
            neighborReceived: results.map(r => r.received),
        };
    }

    /**
     * SLOW LOOP: Network Fetching
     * Fetches neighbor data, updates the shared state variables and sends the lastest complete state
     * to the backend process every NETWORK_FETCH_INTERVAL 
     */
    async function networkFetchLoop(nextTick) {
        if (!params.trigger) {
            networkLoopTimeoutId = null;
            return;
        }
        // 1. Fetch data from neighbors (slow, asynchronous operation)
        const { neighborVStates, neighborEnabled, neighborReceived } = await getNeighborStates();
        // 2. Update the shared state variables
        latestNeighborVStates = neighborVStates;
        latestNeighborEnabled = neighborEnabled;
        // 3. Stamp the state with the latest neighbor data so the logger always
        //    has a complete snapshot — regardless of dynamics-loop timing.
        state.neighborVStates  = neighborVStates;
        state.neighborReceived = neighborReceived;   // true = fresh, false = cache hit (missed packet)
        // 4. Send the updated local state (which was updated by the fast loop) to the backend process
        process.send(state); 
        // 4. Broadcast via BLE (only needs to happen at the slow network update rate)
        if (TYPE === TYPE_BRIDGE && advProcess?.stdin?.writable) {
            const bleCommand = `manufacturer 0x0059 0x7` + bleGenerateManufacturerData(params.enabled, params.node, state.vstate) + `\r`;
            const ok = advProcess.stdin.write(bleCommand);
            if (!ok) console.warn('[BLE] adv stdin backpressured, skipping this update');
        }

        // 5. Schedule next run
        const drift = Date.now() - nextTick;
        const delayMs = Math.max(params.clock * 0.1, params.clock - drift);
        networkLoopTimeoutId = setTimeout(() => networkFetchLoop(nextTick + params.clock), delayMs);
    }

    /**
     * FAST LOOP - Runs every params.dt (e.g., 1ms).
     * Reads the latest available neighbor data (snapshot) and updates the local state.
     * Executes the consensus algorithm update step.
     */
    async function dynamicsLoop(nextTick) { 
        if (!params.trigger) {
            dynamicsLoopTimeoutId = null;
            return;
        }

        // 1. Update state: timestamp
        state.timestamp = Date.now() - time0; 

        if (params.enabled) {
            // READ from the latest shared variables (instantaneous, no await)
            state.neighborVStates = latestNeighborVStates;
            /* 
             * DISCRETE-TIME DYNAMICS: Execute the discrete-time update step 
             */
            ({ state: state.state, vstate: state.vstate, vartheta: state.vartheta } = algo.discrete_step(
                latestNeighborVStates, 
                latestNeighborEnabled
            ));
        }

        // 2. Schedule the next iteration using the DT period (params.dt)
        const drift = Date.now() - nextTick;
        const delayMs = Math.max(params.dt * 0.1, params.dt - drift);
        dynamicsLoopTimeoutId = setTimeout(() => dynamicsLoop(nextTick + params.dt), delayMs);
    }

    /**
     * Edge process: WiFi & Bridge:
     * 
     *  - If trigger, then start/stop coordination platform
     *  - Update the "params" global variable
     */
    process.on('message', async (updatedParams) => {
        try {
            if (isInitial) {
                state = {
                    timestamp: 0, 
                    state: updatedParams.state, 
                    vstate: updatedParams.vstate, 
                    vartheta: updatedParams.vartheta, 
                    neighborVStates: []
                }; 
                isInitial = false;
            }
            if (updatedParams.trigger && !params.trigger) {
                time0 = Date.now();
                state = {
                    timestamp: Date.now() - time0, 
                    state: updatedParams.state, 
                    vstate: updatedParams.vstate, 
                    vartheta: updatedParams.vartheta, 
                    neighborVStates: []
                };
                
                algo.setParams(updatedParams);
                algo.resetInitialConditions(); 
                params = updatedParams; 

                latestNeighborVStates = [];
                latestNeighborEnabled = [];

                if (TYPE === TYPE_BRIDGE) {
                    startBleBridge();
                    const bleNeighborsRequired = updatedParams.neighbors.filter(
                        id => updatedParams.neighborTypes[id] === TYPE_BLE).map(id => id);
                    bleNeighbors = await bleGetDevices(bleNeighborsRequired);
                }

                /**
                 * START BOTH LOOPS 
                 * - networkFetching @ "clock" rate
                 * - plant dynamis @ "dt" rate
                 */
                const t0 = Date.now();
                networkLoopTimeoutId  = setTimeout(() => networkFetchLoop(t0 + params.clock), params.clock);
                dynamicsLoopTimeoutId = setTimeout(() => dynamicsLoop(t0 + params.dt), params.dt);

            } else if (!updatedParams.trigger && params.trigger) {
                if (networkLoopTimeoutId) {
                    clearTimeout(networkLoopTimeoutId);
                    networkLoopTimeoutId = null; 
                }
                if (dynamicsLoopTimeoutId) {
                    clearTimeout(dynamicsLoopTimeoutId);
                    dynamicsLoopTimeoutId = null; 
                }
                if (TYPE === TYPE_BRIDGE) {
                    stopBleBridge(); 
                    try { await bleStopDiscovery(); } catch(_) { /* ignore */}
                    bleNeighbors = {}; 
                }
                latestNeighborVStates = []; 
                latestNeighborEnabled = []; 
            }

            params = updatedParams; 
            algo.setParams(params);
            console.log('Edge-Server params updated successfully: ', params);

        } catch (error) {
            console.error('Error updating Edge-Server params: ', error);
        }
    }); 

    async function shutdown(signal) {
        console.log(`[edge] received ${signal}, cleaning up...`);
        try {
            if (networkLoopTimeoutId)  clearTimeout(networkLoopTimeoutId);
            if (dynamicsLoopTimeoutId) clearTimeout(dynamicsLoopTimeoutId);
            if (TYPE === TYPE_BRIDGE) {
                stopBleBridge();
                try { await bleCleanup(); } catch (_) { /* ignore */ }
            }
        } finally {
            process.exit(0);
        }
    }
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT',  () => shutdown('SIGINT'));

    /**
     * Express-server: on get to '/getVState' route
     * 
     * return: current virtual state of the edge process
     */
    app.get('/getVState', (_req, res) => {
        res.json({vstate: state.vstate, enabled: params.enabled});
    });

    /**
     * http-server: start edge http server (express-server)
     */
    server.listen(NODE_TYPE_PORT[TYPE], '0.0.0.0', () => {
        console.log(`Edge-Server running at http://${IP_ADDRESS}:${NODE_TYPE_PORT[TYPE]}`);
    });

}