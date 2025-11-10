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
            process.send(state); //process.send({ type: 'state', data: state });
        }
    })

    process.on('message', async (params) => {

        // 3 types of messages from backend-process: n -> network, a,p -> consensus (used to be 'a' as algorithm), t -> trigger
        // (1) Network params: { enabled, node, neighbors } --> 'n'
        const msgNetwork = `n${params.enabled ? 1 : 0},${params.node},${params.neighbors.join(',')}\n\r`;
        // >>> Split in two messages to avoid overflow in nordic uart buffer (defined as 64 bytes) <<<
        // (2.1) Consensus Algorithm params updated to: { clock, dt, state, vstate, vartheta, eta } --> 'a'
        const msgConsensus = `a${params.clock},${params.dt},${params.state},${params.vstate},${params.vartheta},${params.eta}\n\r`; 
        // (2.2) Consensus Disturbance params update to : { amplitude, offset, beta, A, f, phi, N_samples } --> 'p'
        const msgDisturbance = `p${params.disturbance.disturbance_on ? 1 : 0},${params.disturbance.amplitude},${params.disturbance.offset},` +
            `${params.disturbance.beta},${params.disturbance.Amp},${params.disturbance.frequency},${params.disturbance.phase},` +
            `${params.disturbance.samples}\n\r`;
        // (3) Trigger params: { trigger } --> 't'
        const msgTrigger = `t${params.trigger ? 1 : 0}\n\r`;

        try {

            await serialWrite(msgNetwork); 
            await serialDrain(); 
            await serialDelay();
            
            await serialWrite(msgConsensus);
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
    
    const { bleGetDevices, bleGetState, bleGenerateManufacturerData } = require('./ble');
    const { algo } = require('./algo');

    const { exec } = require('child_process');

    let advProcess = null;
    let nordicNeighbors = [];

    // Create HTTP server (express-server) and configure middleware to parse JSON bodies for express-server
    const app = express();
    const server = http.createServer(app);
    app.use(express.json());

    // Store data in RAM for consensus parameters/variables
    // New configuration posted in /updateParams route
    let params = { trigger: false }; 

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
        advProcess = exec(`./bleadv.sh "${bleGenerateManufacturerData(params.enabled, params.node, state.vstate)}"`);
        advProcess.on('exit', (code, signal) => {
            if (code !== 0) {
                console.log(`Advertise process exited with error code ${code}. Restarting advertising process...`); 
                startBleBridge(); 
            }
        }); 
    }

    // Auxiliary function to return neighbor virtual states 
    async function getNeighborStates() {
        let neighborVStates = [];
        let neighborEnabled = []; 

        try { 
            for (let id of params.neighbors) {

                if (params.neighborTypes[id] == TYPE_BLE) {
                    const data = await bleGetState(nordicNeighbors[id]); 
                    neighborVStates.push(Number(data.vstate));
                    neighborEnabled.push(Boolean(data.enabled));
                } else {
                    const response = await axios.get(`${params.neighborAddresses[id]}/getVState`)
                    neighborVStates.push(Number(response.data.vstate));
                    neighborEnabled.push(Boolean(response.data.enabled));
                }
            }
        } catch (error) {
            console.error('Error fetching from url');
        }

        return { neighborVStates: neighborVStates, neighborEnabled: neighborEnabled };
    }

    /**
     * SLOW LOOP: Network Fetching
     * Fetches neighbor data, updates the shared state variables and sends the lastest complete state
     * to the backend process every NETWORK_FETCH_INTERVAL [ms:
     */
    async function networkFetchLoop() {
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
        if (TYPE === TYPE_BRIDGE) {
            const bleCommand = `manufacturer 0x0059 0x7` + bleGenerateManufacturerData(params.enabled, params.node, state.vstate) + `\r`; 
            advProcess.stdin.write(bleCommand);
        }

        // 5. Schedule next run
        networkLoopTimeoutId = setTimeout(networkFetchLoop, params.clock);
    }

    /**
     * FAST LOOP (Simulation/Euler Integration) - Runs every params.dt (e.g., 1ms).
     * Reads the latest available neighbor data (snapshot) and updates the local state.
     * Executes the consensus algorithm update step.
     */
    async function dynamicsLoop() { 
        if (!params.trigger) {
            dynamicsLoopTimeoutId = null;
            return;
        }

        // 1. Update state: timestamp
        state.timestamp = Date.now() - time0; 

        if (params.enabled) {
            // READ from the latest shared variables (instantaneous, no await)
            state.neighborVStates = latestNeighborVStates;
            // Execute the fast Euler step
            ({ state: state.state, vstate: state.vstate, vartheta: state.vartheta } = algo.update(latestNeighborVStates, latestNeighborEnabled));
        }

        // 2. Schedule the next iteration using the DT period (params.dt)
        dynamicsLoopTimeoutId = setTimeout(dynamicsLoop, params.dt);
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
                
                algo.setParams(params);
                algo.resetInitialConditions(); 

                latestNeighborVStates = [];
                latestNeighborEnabled = [];

                if (TYPE === TYPE_BRIDGE) {
                    startBleBridge();
                    const nordicNeighborsRequired = updatedParams.neighbors.filter(id => updatedParams.neighborTypes[id] === TYPE_BLE).map(id => id);
                    nordicNeighbors = await bleGetDevices(nordicNeighborsRequired);
                }

                // *** START BOTH LOOPS ***
                // 1. Start the SLOW network fetch/post loop (100ms)
                networkLoopTimeoutId = setTimeout(networkFetchLoop, params.clock);
                // 2. Start the FAST dynamics loop (dt, e.g., 1ms)
                dynamicsLoopTimeoutId = setTimeout(dynamicsLoop, params.dt);

            } else if (!updatedParams.trigger && params.trigger) {
                if (dynamicsLoopTimeoutId) {
                    clearTimeout(dynamicsLoopTimeoutId);
                }
                if (networkLoopTimeoutId) {
                    clearTimeout(networkLoopTimeoutId);
                }
                if (TYPE === TYPE_BRIDGE) {
                    advProcess.kill();
                }
            }

            params = updatedParams; 
            algo.setParams(params);
            console.log('Edge-Server params updated successfully: ', params);

        } catch (error) {
            console.error('Error updating Edge-Server params: ', error);
        }
    }); 

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