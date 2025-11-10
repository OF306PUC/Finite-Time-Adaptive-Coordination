const os = require('os');
const fs = require('fs');
const path = require('path');
const seedrandom = require('seedrandom');

// Define function to get backend-server's IP address
function getIpAddress() {
    const networkInterfaces = os.networkInterfaces();
    for (const interfaceName in networkInterfaces) {
        const interfaces = networkInterfaces[interfaceName];
        for (const iface of interfaces) {
            if (iface.family === 'IPv4' && !iface.internal) {
                return iface.address;
            }
        }
    }
    console.log('Cannot find IP address.');
    process.exit(1);
}

// Define function to encode float to integer (for transmission)
const SCALE_FACTOR = 1e6;

function encodeFloat(x, scale = SCALE_FACTOR) {
  return Math.round(x * scale);
}

// Define constants for the backend server:
const IP_ADDRESS = getIpAddress();

// Ports:
const HUB_PORT = 3000;
const BACKEND_BLE_PORT = 3001;
const BACKEND_WIFI_PORT = 3002;
const BACKEND_BRIDGE_PORT = 3003;
const NODE_BLE_PORT = BACKEND_BLE_PORT;     //Not used, but it would make sense if the ble edge would use a port
const NODE_WIFI_PORT = 3004;
const NODE_BRIDGE_PORT = 3005;

// Types of nodes:
const TYPE_BLE = 'ble';
const TYPE_WIFI = 'wifi';
const TYPE_BRIDGE = 'bridge';
const BACKEND_TYPE_PORT = {
  [TYPE_BLE]: BACKEND_BLE_PORT,
  [TYPE_WIFI]: BACKEND_WIFI_PORT,
  [TYPE_BRIDGE]: BACKEND_BRIDGE_PORT,
};
const NODE_TYPE_PORT = {
  [TYPE_BLE]: NODE_BLE_PORT,
  [TYPE_WIFI]: NODE_WIFI_PORT,
  [TYPE_BRIDGE]: NODE_BRIDGE_PORT,
};

// Number of nodes: 
const NUM_NODES = 30; // maximum number of nodes supported

// Seed the random number generator for reproducibility
const rng = seedrandom('consensus');

// Pre-generated initial states for up to 30 nodes (clusters scenario: {BLE, WiFi, Bridge} x 10 nodes):
const INITIAL_STATES_BLE = Array.from({length: Math.floor(NUM_NODES/3)}, () => encodeFloat(rng() * 10));
const INITIAL_STATES_WIFI = Array.from({length: Math.floor(NUM_NODES/3)}, () => encodeFloat(rng() * 10 + 10));
const INITIAL_STATES_BRIDGE = Array.from({length: Math.floor(NUM_NODES/3)}, () => encodeFloat(rng() * 10 + 20));
const INITIAL_VSTATES_BLE = Array.from({length: Math.floor(NUM_NODES/3)}, () => encodeFloat(rng() * 10));
const INITIAL_VSTATES_WIFI = Array.from({length: Math.floor(NUM_NODES/3)}, () => encodeFloat(rng() * 10 + 10));
const INITIAL_VSTATES_BRIDGE = Array.from({length: Math.floor(NUM_NODES/3)}, () => encodeFloat(rng() * 10 + 20));


function createNodes(topologyConfig) {
    const nodes = {}; 
    const initialConditions = []; 

    for (let i = 0; i < topologyConfig.length; i++) {
        const cfg = topologyConfig[i];
        const nodeIndex = cfg.id - 1;

        if (nodeIndex < 0 || nodeIndex >= NUM_NODES) {
            console.log(`Node ID ${cfg.id} is out of range. It should be between 1 and ${NUM_NODES}.`);
            continue; 
        }

        // Determine which initial set to use based on communication type
        let state, vstate;
        switch (cfg.type) {
            case TYPE_BLE:
                state  = INITIAL_STATES_BLE[nodeIndex % INITIAL_STATES_BLE.length];
                vstate = INITIAL_VSTATES_BLE[nodeIndex % INITIAL_VSTATES_BLE.length];
                break;

            case TYPE_WIFI:
                state  = INITIAL_STATES_WIFI[nodeIndex % INITIAL_STATES_WIFI.length];
                vstate = INITIAL_VSTATES_WIFI[nodeIndex % INITIAL_VSTATES_WIFI.length];
                break;

            case TYPE_BRIDGE:
                state  = INITIAL_STATES_BRIDGE[nodeIndex % INITIAL_STATES_BRIDGE.length];
                vstate = INITIAL_VSTATES_BRIDGE[nodeIndex % INITIAL_VSTATES_BRIDGE.length];
                break;

            default:
                // fallback in case of unknown type
                state  = INITIAL_STATES[nodeIndex];
                vstate = INITIAL_VSTATES[nodeIndex];
                break;
        }

        const INITIAL_PHASES = Array.from({length: NUM_NODES}, () => encodeFloat(rng()));
        nodes[cfg.id] = {
            ip: cfg.ip,
            type: cfg.type,
            enabled: cfg.enabled,
            neighbors: cfg.neighbors,
            clock: cfg.clock,
            dt: 1,                      
            state: state,
            vstate: vstate,
            vartheta: 0,
            eta: 500000,        
            disturbance: {                    
                disturbance_on: true,        
                amplitude: 1500000,
                offset: 500000,
                beta: 100000, 
                Amp: 400000,   
                frequency: 10,  
                phase: INITIAL_PHASES[nodeIndex],
                samples: 1000
            }
        };
        initialConditions.push({
            id: cfg.id,
            type: cfg.type,
            state: state,
            vstate: vstate
        }); 
    }

    const dataDir = path.join(__dirname, 'data');
    if (!fs.existsSync(dataDir)){
        fs.mkdirSync(dataDir);
    }

    const csvPath = path.join(dataDir, 'initial_conditions.csv');
    const csvHeader = 'id,type,state,vstate,enable\n';
    const csvRows = initialConditions.map(ic => `${ic.id},${ic.type},${ic.state},${ic.vstate},${ic.enabled}`).join('\n');
    fs.writeFileSync(csvPath, csvHeader + csvRows);
    console.log(`Initial conditions saved to ${csvPath}`);

    return nodes;
}


// Define the network: red-jetson -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
// IP addresses of the nodes in the network are given by the office router (192.168.0.1) ==> red-jetson

// Consider a scale factor of 10000 to be able to work Tx integers in the nodes

let TOPOLOGY;

// 9node-ring-dir: ... ---> 4 ---> 1 ---> 9 ---> 5 ---> 2 ---> 6 ---> 8 ---> 3 ---> 7 ---> ...
// TOPOLOGY = [
//   {id: 1, ip: '192.168.0.136', type: TYPE_BLE,    enabled: true, neighbors: [4], clock: 250},
//   {id: 2, ip: '192.168.0.136', type: TYPE_WIFI,   enabled: true, neighbors: [5], clock: 250},
//   {id: 3, ip: '192.168.0.136', type: TYPE_BRIDGE, enabled: true, neighbors: [8], clock: 250},
//   {id: 4, ip: '192.168.0.101', type: TYPE_BLE,    enabled: true, neighbors: [7], clock: 250},
//   {id: 5, ip: '192.168.0.101', type: TYPE_WIFI,   enabled: true, neighbors: [9], clock: 250},
//   {id: 6, ip: '192.168.0.101', type: TYPE_BRIDGE, enabled: true, neighbors: [2], clock: 250},
//   {id: 7, ip: '192.168.0.134', type: TYPE_BLE,    enabled: true, neighbors: [3], clock: 250},
//   {id: 8, ip: '192.168.0.134', type: TYPE_WIFI,   enabled: true, neighbors: [6], clock: 250},
//   {id: 9, ip: '192.168.0.134', type: TYPE_BRIDGE, enabled: true, neighbors: [1], clock: 250},
// ]; 

// 9node-clusters
//       3 --- 9
//        \   /
//          6
//        /   \
// 7 --- 1     8 --- 2
//  \   /       \   /
//    4           5
// TOPOLOGY = [
//   {id: 1, ip: '192.168.0.136', type: TYPE_BLE,    enabled: true,  neighbors: [4,6,7],   clock: 250},
//   {id: 2, ip: '192.168.0.136', type: TYPE_WIFI,   enabled: true,  neighbors: [5,8],     clock: 250},
//   {id: 3, ip: '192.168.0.136', type: TYPE_BRIDGE, enabled: true,  neighbors: [6,9],     clock: 250},
//   {id: 4, ip: '192.168.0.101', type: TYPE_BLE,    enabled: true,  neighbors: [1,7],     clock: 250},
//   {id: 5, ip: '192.168.0.101', type: TYPE_WIFI,   enabled: true,  neighbors: [2,8],     clock: 250},
//   {id: 6, ip: '192.168.0.101', type: TYPE_BRIDGE, enabled: false, neighbors: [1,3,8,9], clock: 250},
//   {id: 7, ip: '192.168.0.134', type: TYPE_BLE,    enabled: true,  neighbors: [1,4],     clock: 250},
//   {id: 8, ip: '192.168.0.134', type: TYPE_WIFI,   enabled: true,  neighbors: [2,5,6],   clock: 250},
//   {id: 9, ip: '192.168.0.134', type: TYPE_BRIDGE, enabled: true,  neighbors: [3,6],     clock: 250},
// ]; 

// 18nodes-ring -----------------------------------------------------------------------------------------------------
// ... --- 1 --- 2 --- 3 --- ... --- 16 --- 17 --- 18 --- ...
// TOPOLOGY = [
//   {id:  1, ip: '192.168.0.136', type: TYPE_BLE,    enabled:  true, neighbors: [ 2,18], clock: 200}, 
//   {id:  2, ip: '192.168.0.101', type: TYPE_BLE,    enabled:  true, neighbors: [ 3, 1], clock: 200}, 
//   {id:  3, ip: '192.168.0.134', type: TYPE_BLE,    enabled:  true, neighbors: [ 4, 2], clock: 200}, 
//   {id:  4, ip: '192.168.0.191', type: TYPE_BLE,    enabled:  true, neighbors: [ 5, 3], clock: 200}, 
//   {id:  5, ip: '192.168.0.166', type: TYPE_BLE,    enabled:  true, neighbors: [ 6, 4], clock: 200}, 
//   {id:  6, ip: '192.168.0.130', type: TYPE_BLE,    enabled:  true, neighbors: [ 7, 5], clock: 200}, 
//   {id:  7, ip: '192.168.0.136', type: TYPE_BRIDGE, enabled: false, neighbors: [ 8, 6], clock: 200}, 
//   {id:  8, ip: '192.168.0.101', type: TYPE_BRIDGE, enabled:  true, neighbors: [ 9, 7], clock: 200}, 
//   {id:  9, ip: '192.168.0.134', type: TYPE_BRIDGE, enabled:  true, neighbors: [10, 8], clock: 200}, 
//   {id: 10, ip: '192.168.0.136', type: TYPE_WIFI,   enabled:  true, neighbors: [11, 9], clock: 200}, 
//   {id: 11, ip: '192.168.0.101', type: TYPE_WIFI,   enabled:  true, neighbors: [12,10], clock: 200}, 
//   {id: 12, ip: '192.168.0.134', type: TYPE_WIFI,   enabled:  true, neighbors: [13,11], clock: 200}, 
//   {id: 13, ip: '192.168.0.191', type: TYPE_WIFI,   enabled:  true, neighbors: [14,12], clock: 200}, 
//   {id: 14, ip: '192.168.0.166', type: TYPE_WIFI,   enabled:  true, neighbors: [15,13], clock: 200}, 
//   {id: 15, ip: '192.168.0.130', type: TYPE_WIFI,   enabled:  true, neighbors: [16,14], clock: 200}, 
//   {id: 16, ip: '192.168.0.191', type: TYPE_BRIDGE, enabled:  true, neighbors: [17,15], clock: 200}, 
//   {id: 17, ip: '192.168.0.166', type: TYPE_BRIDGE, enabled:  true, neighbors: [18,16], clock: 200}, 
//   {id: 18, ip: '192.168.0.130', type: TYPE_BRIDGE, enabled: false, neighbors: [ 1,17], clock: 200}, 
// ]
// ------------------------------------------------------------------------------------------------------------------

// 18nodes-ring-dir -------------------------------------------------------------------------------------------------
// ... <--- 1 <--- 2 <--- 3 <--- ... <--- 16 <--- 17 <--- 18 <--- ...
// TOPOLOGY = [
//   {id:  1, ip: '192.168.0.136', type: TYPE_BLE,    enabled:  true, neighbors: [ 2], clock: 200}, 
//   {id:  2, ip: '192.168.0.101', type: TYPE_BLE,    enabled:  true, neighbors: [ 3], clock: 200}, 
//   {id:  3, ip: '192.168.0.134', type: TYPE_BLE,    enabled:  true, neighbors: [ 4], clock: 200}, 
//   {id:  4, ip: '192.168.0.191', type: TYPE_BLE,    enabled:  true, neighbors: [ 5], clock: 200}, 
//   {id:  5, ip: '192.168.0.166', type: TYPE_BLE,    enabled:  true, neighbors: [ 6], clock: 200}, 
//   {id:  6, ip: '192.168.0.130', type: TYPE_BLE,    enabled:  true, neighbors: [ 7], clock: 200}, 
//   {id:  7, ip: '192.168.0.136', type: TYPE_BRIDGE, enabled:  true, neighbors: [ 8], clock: 200}, 
//   {id:  8, ip: '192.168.0.101', type: TYPE_BRIDGE, enabled:  true, neighbors: [ 9], clock: 200}, 
//   {id:  9, ip: '192.168.0.134', type: TYPE_BRIDGE, enabled:  true, neighbors: [10], clock: 200}, 
//   {id: 10, ip: '192.168.0.136', type: TYPE_WIFI,   enabled:  true, neighbors: [11], clock: 200}, 
//   {id: 11, ip: '192.168.0.101', type: TYPE_WIFI,   enabled:  true, neighbors: [12], clock: 200}, 
//   {id: 12, ip: '192.168.0.134', type: TYPE_WIFI,   enabled:  true, neighbors: [13], clock: 200}, 
//   {id: 13, ip: '192.168.0.191', type: TYPE_WIFI,   enabled:  true, neighbors: [14], clock: 200}, 
//   {id: 14, ip: '192.168.0.166', type: TYPE_WIFI,   enabled:  true, neighbors: [15], clock: 200}, 
//   {id: 15, ip: '192.168.0.130', type: TYPE_WIFI,   enabled:  true, neighbors: [16], clock: 200}, 
//   {id: 16, ip: '192.168.0.191', type: TYPE_BRIDGE, enabled:  true, neighbors: [17], clock: 200}, 
//   {id: 17, ip: '192.168.0.166', type: TYPE_BRIDGE, enabled:  true, neighbors: [18], clock: 200}, 
//   {id: 18, ip: '192.168.0.130', type: TYPE_BRIDGE, enabled:  true, neighbors: [ 1], clock: 200}, 
// ]
// ------------------------------------------------------------------------------------------------------------------

// n30-dirline
// ... <-- 1 <-- 2 <-- 3 <-- 4 <-- 5 <-- 6 <-- 7 <-- 8 <-- 9 <-- 10 <-- 21 <-- 22 <-- 23 <-- 24 <-- 25 <-- 11 <-- 12 <-- 13 <-- 14 <-- 15 <-- 16 <-- 17 <-- 18 <-- 19 <-- 20 <-- 26 <-- 27 <-- 28 <-- 29 <-- 30 <-- ...
// TOPOLOGY = [
//  {id:  1, ip: '192.168.0.136', type: TYPE_BLE,    enabled:  true, neighbors: [ 2], clock: 200},
//  {id:  2, ip: '192.168.0.101', type: TYPE_BLE,    enabled:  true, neighbors: [ 3], clock: 200},
//  {id:  3, ip: '192.168.0.134', type: TYPE_BLE,    enabled:  true, neighbors: [ 4], clock: 200},
//  {id:  4, ip: '192.168.0.191', type: TYPE_BLE,    enabled:  true, neighbors: [ 5], clock: 200},
//  {id:  5, ip: '192.168.0.166', type: TYPE_BLE,    enabled:  true, neighbors: [ 6], clock: 200},
//  {id:  6, ip: '192.168.0.130', type: TYPE_BLE,    enabled:  true, neighbors: [ 7], clock: 200},
//  {id:  7, ip: '192.168.0.126', type: TYPE_BLE,    enabled:  true, neighbors: [ 8], clock: 200},
//  {id:  8, ip: '192.168.0.122', type: TYPE_BLE,    enabled:  true, neighbors: [ 9], clock: 200},
//  {id:  9, ip: '192.168.0.146', type: TYPE_BLE,    enabled:  true, neighbors: [10], clock: 200},
//  {id: 10, ip: '192.168.0.135', type: TYPE_BLE,    enabled:  true, neighbors: [21], clock: 200},
//  {id: 11, ip: '192.168.0.136', type: TYPE_WIFI,   enabled:  true, neighbors: [12], clock: 200},
//  {id: 12, ip: '192.168.0.101', type: TYPE_WIFI,   enabled:  true, neighbors: [13], clock: 200},
//  {id: 13, ip: '192.168.0.134', type: TYPE_WIFI,   enabled:  true, neighbors: [14], clock: 200},
//  {id: 14, ip: '192.168.0.191', type: TYPE_WIFI,   enabled:  true, neighbors: [15], clock: 200},
//  {id: 15, ip: '192.168.0.166', type: TYPE_WIFI,   enabled:  true, neighbors: [16], clock: 200},
//  {id: 16, ip: '192.168.0.130', type: TYPE_WIFI,   enabled:  true, neighbors: [17], clock: 200},
//  {id: 17, ip: '192.168.0.126', type: TYPE_WIFI,   enabled:  true, neighbors: [18], clock: 200},
//  {id: 18, ip: '192.168.0.122', type: TYPE_WIFI,   enabled:  true, neighbors: [19], clock: 200},
//  {id: 19, ip: '192.168.0.146', type: TYPE_WIFI,   enabled:  true, neighbors: [20], clock: 200},
//  {id: 20, ip: '192.168.0.135', type: TYPE_WIFI,   enabled:  true, neighbors: [26], clock: 200},
//  {id: 21, ip: '192.168.0.136', type: TYPE_BRIDGE, enabled:  true, neighbors: [22], clock: 200},
//  {id: 22, ip: '192.168.0.101', type: TYPE_BRIDGE, enabled:  true, neighbors: [23], clock: 200},
//  {id: 23, ip: '192.168.0.134', type: TYPE_BRIDGE, enabled:  true, neighbors: [24], clock: 200},
//  {id: 24, ip: '192.168.0.191', type: TYPE_BRIDGE, enabled:  true, neighbors: [25], clock: 200},
//  {id: 25, ip: '192.168.0.166', type: TYPE_BRIDGE, enabled:  true, neighbors: [11], clock: 200},
//  {id: 26, ip: '192.168.0.130', type: TYPE_BRIDGE, enabled:  true, neighbors: [27], clock: 200},
//  {id: 27, ip: '192.168.0.126', type: TYPE_BRIDGE, enabled:  true, neighbors: [28], clock: 200},
//  {id: 28, ip: '192.168.0.122', type: TYPE_BRIDGE, enabled:  true, neighbors: [29], clock: 200},
//  {id: 29, ip: '192.168.0.146', type: TYPE_BRIDGE, enabled:  true, neighbors: [30], clock: 200},
//  {id: 30, ip: '192.168.0.135', type: TYPE_BRIDGE, enabled:  true, neighbors: [ 1], clock: 200},
// ]; 

// n30-clusters
TOPOLOGY = [ 
{id: 1,  ip: '192.168.0.136', type: TYPE_BLE,    enabled:  true,  neighbors: [2, 3, 21],       clock: 200},
{id: 2,  ip: '192.168.0.101', type: TYPE_BLE,    enabled:  true,  neighbors: [1, 4],           clock: 200},
{id: 3,  ip: '192.168.0.134', type: TYPE_BLE,    enabled:  true,  neighbors: [1, 5],           clock: 200},
{id: 4,  ip: '192.168.0.191', type: TYPE_BLE,    enabled:  true,  neighbors: [2, 5, 6],        clock: 200},
{id: 5,  ip: '192.168.0.166', type: TYPE_BLE,    enabled:  true,  neighbors: [3, 4, 7],        clock: 200},
{id: 6,  ip: '192.168.0.130', type: TYPE_BLE,    enabled:  true,  neighbors: [4, 7, 8],        clock: 200},
{id: 7,  ip: '192.168.0.126', type: TYPE_BLE,    enabled:  true,  neighbors: [5, 6, 9],        clock: 200},
{id: 8,  ip: '192.168.0.122', type: TYPE_BLE,    enabled:  true,  neighbors: [6, 10],          clock: 200},
{id: 9,  ip: '192.168.0.146', type: TYPE_BLE,    enabled:  true,  neighbors: [7, 10],          clock: 200},
{id: 10, ip: '192.168.0.135', type: TYPE_BLE,    enabled:  true,  neighbors: [8, 9, 30],       clock: 200},
{id: 11, ip: '192.168.0.136', type: TYPE_WIFI,   enabled:  true,  neighbors: [12, 13, 21],     clock: 200},
{id: 12, ip: '192.168.0.101', type: TYPE_WIFI,   enabled:  true,  neighbors: [11, 14],         clock: 200},
{id: 13, ip: '192.168.0.134', type: TYPE_WIFI,   enabled:  true,  neighbors: [11, 15],         clock: 200},
{id: 14, ip: '192.168.0.191', type: TYPE_WIFI,   enabled:  true,  neighbors: [12, 15, 16],     clock: 200},
{id: 15, ip: '192.168.0.166', type: TYPE_WIFI,   enabled:  true,  neighbors: [13, 14, 17],     clock: 200},
{id: 16, ip: '192.168.0.130', type: TYPE_WIFI,   enabled:  true,  neighbors: [14, 17, 18],     clock: 200},
{id: 17, ip: '192.168.0.126', type: TYPE_WIFI,   enabled:  true,  neighbors: [15, 16, 19],     clock: 200},
{id: 18, ip: '192.168.0.122', type: TYPE_WIFI,   enabled:  true,  neighbors: [16, 20],         clock: 200},
{id: 19, ip: '192.168.0.146', type: TYPE_WIFI,   enabled:  true,  neighbors: [17, 20],         clock: 200},
{id: 20, ip: '192.168.0.135', type: TYPE_WIFI,   enabled:  true,  neighbors: [18, 19, 30],     clock: 200},
{id: 21, ip: '192.168.0.136', type: TYPE_BRIDGE, enabled:  false, neighbors: [1, 11, 22, 23],  clock: 200},
{id: 22, ip: '192.168.0.101', type: TYPE_BRIDGE, enabled:  true,  neighbors: [21, 24],         clock: 200},
{id: 23, ip: '192.168.0.134', type: TYPE_BRIDGE, enabled:  true,  neighbors: [21, 25],         clock: 200},
{id: 24, ip: '192.168.0.191', type: TYPE_BRIDGE, enabled:  true,  neighbors: [22, 25, 26],     clock: 200},
{id: 25, ip: '192.168.0.166', type: TYPE_BRIDGE, enabled:  true,  neighbors: [23, 24, 27],     clock: 200},
{id: 26, ip: '192.168.0.130', type: TYPE_BRIDGE, enabled:  true,  neighbors: [24, 27, 28],     clock: 200},
{id: 27, ip: '192.168.0.126', type: TYPE_BRIDGE, enabled:  true,  neighbors: [25, 26, 29],     clock: 200},
{id: 28, ip: '192.168.0.122', type: TYPE_BRIDGE, enabled:  true,  neighbors: [26, 30],         clock: 200},
{id: 29, ip: '192.168.0.146', type: TYPE_BRIDGE, enabled:  true,  neighbors: [27, 30],         clock: 200},
{id: 30, ip: '192.168.0.135', type: TYPE_BRIDGE, enabled:  false, neighbors: [10, 20, 28, 29], clock: 200},
];



// ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------

const NODES = createNodes(TOPOLOGY); 
const BACKEND_IDS = Object.keys(NODES); 
const NODE_ADDRESSES = Object.fromEntries(BACKEND_IDS.map(id => [id, `http://${NODES[id].ip}:${NODE_TYPE_PORT[NODES[id].type]}`]));
const BACKEND_ADDRESSES = Object.fromEntries(BACKEND_IDS.map(id => [id, `http://${NODES[id].ip}:${BACKEND_TYPE_PORT[NODES[id].type]}`]));

// Export the network related constants
module.exports = {
  IP_ADDRESS, 
  HUB_PORT, 
  BACKEND_TYPE_PORT, 
  NODE_TYPE_PORT, 
  NODE_WIFI_PORT, 
  NODE_BRIDGE_PORT,
  TYPE_BLE, 
  TYPE_WIFI, 
  TYPE_BRIDGE,
  BACKEND_IDS, 
  BACKEND_ADDRESSES, 
  NODE_ADDRESSES, 
  NODES,
};

