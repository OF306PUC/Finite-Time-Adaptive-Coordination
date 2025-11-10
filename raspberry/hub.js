const http = require('http');
const express = require('express');
const axios = require('axios');
const socketIo = require('socket.io');
const socketIoClient = require('socket.io-client');
const path = require('path');

const { IP_ADDRESS, HUB_PORT, NODES, BACKEND_IDS, BACKEND_ADDRESSES, NODE_ADDRESSES } = require('./net');
const { dataGetTree, dataUpdateTree, dataWriteFile } = require('./data');

// HTTP server: Hub server (express-server and socket.io server)
/**
 * The flow here goes like this:
 * 1. Parameter Update: 
 * >> Browser UI → (HTTP POST) → Hub Server → (HTTP POST) → Backend Server → (IPC) → Edge Process
 * 2. State Reporting: 
 * >> Edge Process → (IPC) → Backend Server → (Socket.IO) → Hub Server → (Socket.IO) → Browser UI
 * 3. Data Retrieval after test: 
 * >> Hub Server → (HTTP GET) → Backend Server (JSON logs) → Hub stores in /data tree
 */
const app = express();
const server = http.createServer(app);
const io = socketIo(server); 

// Middleware to serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use(express.json());

// Store data in RAM for consensus parameters
let params = { trigger: false, filename: "dummy", nodes: NODES, };

// Auxiliary function to generate backend parameters
function generateBackendParams(updatedParams, id) {
    const neighbors = updatedParams.nodes[id].neighbors; 
    
    const backendParams = {
        trigger: updatedParams.trigger,
        filename: updatedParams.filename,
        node: id, 
        address: NODE_ADDRESSES[id],
        neighborAddresses: Object.fromEntries(neighbors.map(id => [id, NODE_ADDRESSES[id]])),
        // Example result: 
        /**
         * neighborAddresses = {
         * node1: "192.168.0.101",
         * node3: "192.168.0.103",
         * node5: "192.168.0.105"
         * };
         */
        ...updatedParams.nodes[id], 
        neighborTypes: Object.fromEntries(neighbors.map(id => [id, NODES[id].type])),
    }; 

    return backendParams;
}

// Script-process: on script load
// --> axios-client: post initial params to server-backend-i/updateParams
// --> io-client: start the io-clients
async function updateBackendParams(updatedParams) {
    try {
        for (let id of BACKEND_IDS) {
            const backendParams = generateBackendParams(updatedParams, id);
            await axios.post(`${BACKEND_ADDRESSES[id]}/updateParams`, backendParams);
        }
        console.log('Hub-Server: Backend-Server params updated successfully:', updatedParams);
    } catch (error) {
        console.error('Hub-Server: Backend-Server error updating params ==>', error.message);
    }
}

updateBackendParams(params);

// io-client: Auxiliary function to start io-clients
function startIoClients() {
    // io-client: connect to the io-servers (server-backends)
    const sockets = BACKEND_IDS.reduce((sockets, id) => {
        sockets[id] = socketIoClient(BACKEND_ADDRESSES[id]);
        return sockets;
    }, {});

    // io-client: on data reception from the io-servers (server-backends)
    // --> io-server: relay the state to the io-client (browser-client)
    for (let id of BACKEND_IDS) {
        sockets[id].on('state', (state) => {
            io.emit(`state${id}`, state);
            console.log(`Received from IO-Server-${id}: state = ${state.state}, vstate = ${state.vstate}, vartheta = ${state.vartheta}`);
        });
    }
}

startIoClients();

// SERVER: -------------------------------------------------------------------
// io-server: on io-client (browser-client) connection simply log a message
io.on('connection', (_socket) => {
    console.log('Hub-Server socket connected to Browser-Client');
});

// Express-server: on get to /getDataTree route
app.get('/getDataTree', (_req, res) => {
    res.json(dataGetTree());
});

// Express-server: on get to /getIds route
app.get('/getBackendIds', (_req, res) => {
    res.json(BACKEND_IDS);
});

// Express-server: on get to /getParams route
app.get('/getParams', (req, res) => {
    res.json(params);
});

// Express-server: on post to /updateParams route
app.post('/updateParams', async (req, res) => {
    const updatedParams = req.body;
    try {
        await updateBackendParams(updatedParams);
        if (!updatedParams.trigger && params.trigger) {
            for (let id of BACKEND_IDS) {
                const response = await axios.get(`${BACKEND_ADDRESSES[id]}/${updatedParams.filename}-${updatedParams.nodes[id].type}.json`);
                await dataWriteFile(response.data, `${updatedParams.filename}`, id);
            }
            await dataUpdateTree();
        }
        params = updatedParams;
        console.log('Hub-Server params updated successfully.', params);
        res.status(200).json({ message: 'Hub-Server params updated successfully.', params });
    } catch (error) {
        res.status(500).json({ message: 'Hub-Server error updating params.' });
    }
});

// http-server: start express-server and io-server
server.listen(HUB_PORT, '0.0.0.0', () => {
    console.log(`Hub-Server running at http://${IP_ADDRESS}:${HUB_PORT}`);
});