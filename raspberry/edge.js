const { clearTimeout } = require('timers');
const { IP_ADDRESS, NODE_TYPE_PORT, TYPE_BLE, TYPE_BRIDGE } = require('./net'); 
const TYPE = process.argv[2]; 


//////////////////////////////
// Run the BLE edge-process //
//////////////////////////////

if (TYPE == TYPE_BLE) {

    // Import serial modules 
    const { parser, serialWrite, serialDelay, serialDrain } = require('./serial'); 

    // For detecting trigger changes
    let pastTrigger = false;
    // Global variables to hold the current parameter state for parser.on('data', ...) data handling
    let currentParams = { trigger : false };

    // uart-rx: on receive data from uart-tx device (nordic)
    // --> Edge Process: send state (x) to backend-process
    parser.on('data', (data) => {
        
        const line = data.replace(/\r/g, '').replace(/\n/g, '');

        // Log to console the nordic serial logging: [SERIAL RX]
        if (!currentParams.trigger) {
            console.log(`[SERIAL RX] ${line}`);
        }

        const msgType = line[0]; 
        if (msgType == 'd') {
            
            // Data message decoding: 
            // "d<timestamp>,<state>,<vstate>,<vartheta>,<neighbor_vstate1>,<neighbor_vstate2>,...<neighbor_vstateN>\n\r"
            const arr = line.slice(1).split(',');
            const state = { 
                timestamp: arr[0], 
                state: arr[1], 
                vstate: arr[2], 
                vartheta: arr[3], 
                neighborVStates: arr.slice(4) 
            };
            process.send(state); 
        }
    })

    process.on('message', async (params) => {

        // 3 types of messages from backend-process: n -> network, a,p -> coordination (used to be 'a' as algorithm), t -> trigger
        // (1) Network params: { enabled, node, neighbors } --> 'n'
        const msgNetwork = `n${params.enabled ? 1 : 0},${params.node},${params.neighbors.join(',')}\n\r`;
        // >>> Split in two messages to avoid overflow in nordic uart buffer (defined as 64 bytes) <<<
        // (2.1) Coordination Algorithm params updated to: { clock, dt, state, vstate, vartheta, eta, alpha, delta, consensual_avg_law } --> 'a'
        const msgCoordination = `a${params.clock},${params.dt},${params.state},${params.vstate},${params.vartheta},${params.eta},${params.alpha},`+
        `${params.delta},${params.consensual_avg_law ? 1 : 0}\n\r`; 
        // (2.2) Coordination Disturbance params update to : { amplitude, offset, beta, A, f, phi, N_samples } --> 'p'
        const msgDisturbance = `p${params.disturbance.disturbance_on ? 1 : 0},${params.disturbance.amplitude},${params.disturbance.offset},` +
            `${params.disturbance.beta},${params.disturbance.Amp},${params.disturbance.frequency},${params.disturbance.phase},` +
            `${params.disturbance.samples}\n\r`;
        // (3) Trigger params: { trigger } --> 't'
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
    const express = require('express');
    const axios = require('axios');
    const diag = require('./diag'); 
    const { bleGetDevices, bleGetState, bleGenerateManufacturerData, bleStopDiscovery, bleCleanup } = require('./ble');
    const { algo } = require('./algo');
    const { spawn } = require('child_process')

    let advProcess = null;
    let bleNeighbors = {};

    // BLE restart backoff state 
    let bleRestartDelay = 100;          // ms; doubles on each failure
    let bleRestartTimer = null;         // pending restart, if any
    const BLE_RESTART_MAX = 1000;       // cap at 1 s
    const BLE_RESTART_MIN = 100;        // initial / reset value

    // Create HTTP server (express-server) and configure middleware to parse JSON bodies for express-server
    const app = express();
    const server = http.createServer(app);
    app.use(express.json());

    // Store data in RAM for consensus parameters/variables
    // New configuration posted in /updateParams route
    let params = { trigger: false }; 
    
    /* Logger for diagnosis */
    diag.start(process.env.NODE_ID || (TYPE === TYPE_BRIDGE ? 'bridge' : TYPE)); 

    // Global variables related to the consensus algorithm
    let dynamicsLoopTimeoutId = null;     // ID for the dynamics loop (dt --> clock)
    let networkLoopTimeoutId = null;      // ID for the network fetch loop (must be faster than 10-15 ms)
    let isInitial = true;

    let time0 = 0; 
    let state = {}; // --> { timestamp, state, vstate, vartheta, neighborState }

    // --- Shared State for Decoupled Loops --- //
    let latestNeighborVStates = [];
    let latestNeighborEnabled = [];

    // Auxiliary function for starting BLE for bridge configuration (restarts the advertising process if any error)
    function startBleBridge() {
        const data = bleGenerateManufacturerData(params.enabled, params.node, state.vstate); 
        advProcess = spawn('./bleadv.sh', [data], { stdio: ['pipe', 'ignore', 'ignore']}); 

        advProcess.on('exit', (code, _signal) => {
            // Clean exit, or consensus has stopped — don't restart.
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

    // Module-level cache. One entry per neighbor id with last good values.
    // Prevents a transient fetch failure from injecting spurious zeros into
    // the consensus update.
    const _neighborStateCache = new Map();
    // Max age of cached state before we consider it too stale to use, even
    // in lieu of a fresh value. Beyond this, return enabled=false so the
    // algorithm can mask the neighbor out properly. Set ~3 × clock period;
    // adjust based on your tolerance for missing-link behavior.
    const NEIGHBOR_CACHE_MAX_AGE_MS = 2000;

    async function getNeighborStates() {
        // Tighter timeout — clock/2 instead of clock-50. With 4 neighbors in
        // parallel, the typical case is well under this. Failing fast means
        // we fall back to cache rather than burning ~1s on a stuck request.
        const fetchTimeoutMs = Math.max(50, Math.floor((params.clock ?? 1000) / 2));
        const now = Date.now();

        const results = await Promise.all(params.neighbors.map(async (id) => {
            try {
                let fresh;

                if (params.neighborTypes[id] === TYPE_BLE) {
                    const data = await withTimeout(
                        bleGetState(bleNeighbors[id]),
                        fetchTimeoutMs,
                        null   // sentinel; handled below
                    );
                    if (data === null || data.vstate === null || data.ok === false) {
                        throw new Error('BLE state unavailable');
                    }
                    fresh = {
                        vstate:  Number(data.vstate),
                        enabled: Boolean(data.enabled),
                    };
                } else {
                    const response = await axios.get(
                        `${params.neighborAddresses[id]}/getVState`,
                        { timeout: fetchTimeoutMs }
                    );
                    fresh = {
                        vstate:  Number(response.data.vstate),
                        enabled: Boolean(response.data.enabled),
                    };
                }

                _neighborStateCache.set(id, { ...fresh, ts: now });
                return fresh;

            } catch (err) {
                const cached = _neighborStateCache.get(id);
                if (cached && (now - cached.ts) < NEIGHBOR_CACHE_MAX_AGE_MS) {
                    // Fresh enough cached value — return it but flag as not-currently-live.
                    // The algorithm should treat `enabled: false` as "ignore this neighbor"
                    // for the duration of the outage, while keeping the vstate value to
                    // prevent the zero-injection artifact in case enabled is ignored.
                    return { vstate: cached.vstate, enabled: false };
                }
                // No cache or cache too stale — neighbor truly unavailable.
                return { vstate: 0, enabled: false };
            }
        }));

        return {
            neighborVStates: results.map(r => r.vstate),
            neighborEnabled: results.map(r => r.enabled),
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
        const { neighborVStates, neighborEnabled } = await getNeighborStates();
        
        // 2. Update the shared state variables
        latestNeighborVStates = neighborVStates;
        latestNeighborEnabled = neighborEnabled;
        
        // 3. Send the updated local state (which was updated by the fast loop) to the backend process
        process.send(state); 

        // 4. Broadcast via BLE (only needs to happen at the slow network update rate)
        if (TYPE === TYPE_BRIDGE && advProcess?.stdin?.writable) {
            const bleCommand = `manufacturer 0x0059 0x7` + bleGenerateManufacturerData(params.enabled, params.node, state.vstate) + `\r`;
            const ok = advProcess.stdin.write(bleCommand);
            if (!ok) console.warn('[BLE] adv stdin backpressured, skipping this update');
        }

        // 5. Schedule next run
        const drift = Date.now() - nextTick;
        // Floor at 10% of clock period so even slow cycles preserve breathing room
        // for the dynamics loop and the BLE adv update to run.
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
            // DISCRETE-TIME DYNAMICS
            // Execute the discrete-time update step
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

    // Edge-process: on params message received from backend-process
    // --> Edge Process: if trigger, than start/stop consensus algorithm
    // --> Edge Process: update the params global variable 
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
                // Start consensus algorithm if trigger is true and was false before <-- GUI interaction
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
                    const bleNeighborsRequired = updatedParams.neighbors.filter(id => updatedParams.neighborTypes[id] === TYPE_BLE).map(id => id);
                    /* Diagnosis */
                    diag.recordCycleStart();
                    const _diagT0 = Date.now();
                    bleNeighbors = await bleGetDevices(bleNeighborsRequired);
                    diag.recordGetDevices(Date.now() - _diagT0, Object.keys(bleNeighbors).length);
                    /* Diagnosis */
                }

                // *** START BOTH LOOPS ***
                const t0 = Date.now();
                // 1. Start the SLOW network fetch/post loop (100ms)
                networkLoopTimeoutId  = setTimeout(() => networkFetchLoop(t0 + params.clock), params.clock);
                // 2. Start the FAST dynamics loop (dt, e.g., 1ms)
                dynamicsLoopTimeoutId = setTimeout(() => dynamicsLoop(t0 + params.dt), params.dt);

            } else if (!updatedParams.trigger && params.trigger) {
                /* Diagnosis */
                diag.recordCycleEnd(); 
                /* Diagnosis */
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

    // Express-server: on get to /getVState route
    // --> Return the current vstate of the edge process
    app.get('/getVState', (_req, res) => {
        res.json({vstate: state.vstate, enabled: params.enabled});
    });

    // http-server: start edge http server (express-server)
    server.listen(NODE_TYPE_PORT[TYPE], '0.0.0.0', () => {
        console.log(`Edge-Server running at http://${IP_ADDRESS}:${NODE_TYPE_PORT[TYPE]}`);
    });

}