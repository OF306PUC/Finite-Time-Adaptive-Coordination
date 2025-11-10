const http = require('http'); 
const express = require('express'); 
const socketIo = require('socket.io');
const path = require('path');

const { fork } = require('child_process');
const { loggerUpdateFilename, loggerStart, loggerLine, loggerEnd } = require('./log'); 
const { IP_ADDRESS, BACKEND_TYPE_PORT } = require('./net'); 

// Edge Process type: 
const TYPE = process.argv[2]; 
const BACKEND_PORT = BACKEND_TYPE_PORT[TYPE];

// Create main server to host app: (express-server and io-server)
const app = express(); 
const server = http.createServer(app);
const io = socketIo(server)

// Middleware configuration for serving static json files and parsing json bodies for express-server
app.use(express.static(path.join(__dirname, 'data')))
app.use(express.json());

// Store data in RAM for consensus parameters/variables
let params = { trigger: false }; 
/**
 * params = {
 * trigger: false, filename: 'temp', node: 1, address: `http://192.168.1.126:${BLE_PORT}`,
 * neighborAddresses: {2: `http://192.168.1.126:${BLE_PORT}`, 3: `http://192.168.1.127:${BLE_PORT}`, 7: `http://192.168.1.123:${BRIDGE_PORT}`},
 * type: TYPE_BLE, enabled: true, neighbors: [2,3,7], clock: 1000, state: 100, vstate: 50, vartheta: 0, eta: 1,
 * neighborTypes: {2: TYPE_BLE, 3: TYPE_BLE, 7: TYPE_BRIDGE},
 * }
 */

// Backend Process: 
// --> Spawn edge-process
// --> process: on messsage received from edge-process (BLE, WiFi or Bridge)
// --> io-server: emit the state to the io-client (server-hub) >>> state = { timestamp, state, vstate, vartheta, neighborVStates }
// --> logger: save data line 
const edgeProcess = fork(`./edge.js`, [TYPE]);

edgeProcess.on('message', (state) => {
    io.emit('state', state); 
    loggerLine(state); 
    console.log(`IO-Server-${params.node} Sent: state = ${state.state}, vstate = ${state.vstate}, vartheta = ${state.vartheta}`);
})

// Express-server: on post /updateParams route
// --> logger: start or end logger according to trigger
// --> backend-process: send params message to edge-process (BLE, WiFi or Bridge)
// { enabled, node, neighbors, clock, state, vstate, vartheta, eta, disturbance: { random, offset, amplitude, phase, samples }, trigger, 
//   neighborTypes: {}, neighborAddress: {} }
app.post(`/updateParams`, async (req, res) => {
    try {
        const updatedParams = req.body; 
        if (updatedParams.trigger && !params.trigger) {
            // Start logger new file if trigger is true and was false before <-- GUI interaction
            loggerUpdateFilename(`${updatedParams.filename}-${updatedParams.type}.json`)
            await loggerStart(updatedParams); 
        } else if (!updatedParams.trigger && params.trigger) {
            // End logger if trigger is false and was true before <-- GUI interaction
            await loggerEnd(); 
        }

        edgeProcess.send(updatedParams); 
        params = updatedParams; 
        console.log('Backend-Server params updated successfully: ', params);
        res.status(200).json({ message: 'Backend-Server params updated successfully', params });
    } catch (error) {
        res.status(500).json({ message: 'Backend-Server error updating params', error: error.message });
    }
}); 


// http-server: 
// --> Start express-server: handles static files, json parsing and routing (HTTP requests)
// --> Start socket.io-server: handles real-time communication with clients
server.listen(BACKEND_PORT, '0.0.0.0', () => {
    console.log(`Backend-Server running at http://${IP_ADDRESS}:${BACKEND_PORT}`);
}); 