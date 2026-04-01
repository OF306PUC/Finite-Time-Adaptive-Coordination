// const { createBluetooth } = require('node-ble');
// const { bluetooth, destroy } = createBluetooth();

// const DELAY_LOOP = 1000; // Delay between each loop iteration in milliseconds

// function delay(ms) {
//     return new Promise(resolve => setTimeout(resolve, ms));    
// }

// // Function to discover and retrive the required network devices
// async function bleGetDevices(neighborsRequired) { 
    
//     let numberAttempts = 0; 
//     let devices = []; 
//     let nordicNeighbors = {}; 

//     const adapter = await bluetooth.defaultAdapter();
//     if (!(await adapter.isDiscovering())) {
//         await adapter.startDiscovery();
//     }

//     // >>> neighborsRequired is a list of devices included in the params --> updateParams route
//     while (devices.length !== neighborsRequired.length) {
        
//         numberAttempts++;
//         console.log('Finding nodes. Attempt ' + numberAttempts); 

//         // Get available devices: uuids
//         const uuids = await adapter.devices(); 

//         // Filter devices based on: 
//         // >>> UUID 
//         // >>> Node requirements 
//         for (const uuid of uuids) {
//             try { 
//                 const device = await adapter.getDevice(uuid);
//                 const name = await device.getName(); 
                
//                 if (name === 'LABCTRL') {
//                     console.log('name: ', name); 

//                     const dataRaw = await device.getManufacturerData();
//                     const dataBuff = Object.values(dataRaw)[0]; 
//                     const netidEnabled = dataBuff.readUInt8(0);
//                     const node = dataBuff.readUInt8(1);
//                     const value = dataBuff.readInt32LE(2);

//                     console.log('node: ', node);

//                     // If node is required given the params (Neighbors)
//                     if (neighborsRequired.includes(node)) {
//                         console.log('Found node: ', node); 
//                         devices.push(device);
//                         nordicNeighbors[node] = device; 
//                     }
//                 }
//             } catch (error) {
//                 // TODO: Handle error if device is not found or other issues
//                 console.error('Error retrieving device:', error);
//             }
//         }

//         // If all required devices are found, break the loop
//         if (devices.length === neighborsRequired.length) {
//             console.log('All required nodes found: ', devices.length);
//             break;
//         }

//         await delay(DELAY_LOOP); 
//     }

//     return nordicNeighbors;
// }

// // Function to get the state and vstate of a specific device: 
// // For nordic board one defines a structure in C (custom_data_type) and sends it via manufacturer data: 
// // Example of the custom_data_type structure in C that is being used:
// // >>> typedef struct { 
// // >>>     uint16_t manufacturer;
// // >>>     uint8_t netid_enabled;
// // >>>     uint8_t node;
// // >>>     int32_t vstate;
// // >>> } custom_data_type;
// async function bleGetState(device) {

//     // Field          | Size (bytes) | Offset in payload (excluding manufacturer ID)
//     // -------------- | ------------ | ---------------------------------------------
//     // netid_enabled  | 1            | 0
//     // node           | 1            | 1
//     // vstate         | 4            | 2

//     const dataRaw = await device.getManufacturerData();
//     const dataBuff = Object.values(dataRaw)[0];
//     const netidEnabled = dataBuff.readUInt8(0);
//     const node = dataBuff.readUInt8(1);
//     const vstate = dataBuff.readInt32LE(2);

//     return {vstate: vstate, enabled: (netidEnabled === 127)};
// }

// /**
//  * Generates manufacturer data payload for BLE advertising.
//  * 
//  * Matches the behavior of the second version:
//  * - Prepends "f" if enabled, "0" otherwise (not stored in buffer).
//  * - node: 1 byte at offset 0.
//  * - vstate: 4 bytes signed int (little endian) at offsets 1–4.
//  * 
//  * Returns a string like "f 0x01 0x34 0x12 0x00 0x00".
//  */
// function bleGenerateManufacturerData(enabled, node, vstate) {
//     const buffer = Buffer.alloc(5);
  
//     // Write node in first byte
//     buffer.writeUInt8(node, 0);
  
//     // Write 4-byte signed integer in little endian after node
//     buffer.writeInt32LE(vstate, 1);
  
//     // Build result string;
//     return `${enabled ? 'f' : '0'}` +
//          ` 0x${buffer.toString('hex', 0, 1)}` +
//          ` 0x${buffer.toString('hex', 1, 2)}` + 
//          ` 0x${buffer.toString('hex', 2, 3)}` +
//          ` 0x${buffer.toString('hex', 3, 4)}` +
//          ` 0x${buffer.toString('hex', 4, 5)}`;
// }


// // Exports:
// module.exports = {
//     bleGetDevices,
//     bleGetState,
//     bleGenerateManufacturerData
// };

'use strict';

const { createBluetooth } = require('node-ble');
const { bluetooth } = createBluetooth();

const SCAN_INTERVAL_MS  = 1000;
const MAX_ATTEMPTS      = 30;
const LABCTRL_NAME      = 'LABCTRL';

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Try to read the Name property of a BlueZ device object.
 *
 * BlueZ only exposes `Name` once a device has advertised it. For every other
 * device in the cache dbus-next throws:
 *   DBusError: No such property 'Name'  (org.freedesktop.DBus.Error.InvalidArgs)
 *
 * We catch that specific error silently and return null so the caller can skip
 * the device without polluting the console.
 */
async function _tryGetName(device) {
    try {
        return await device.getName();
    } catch (err) {
        const isNameMissing =
            err?.errorName === 'org.freedesktop.DBus.Error.InvalidArgs' ||
            err?.text?.includes("No such property 'Name'");
        if (isNameMissing) return null;
        throw err;  // unexpected error – re-throw
    }
}

/**
 * Try to read ManufacturerData. Returns null if the property isn't available.
 */
async function _tryGetManufacturerData(device) {
    try {
        return await device.getManufacturerData();
    } catch {
        return null;
    }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Scan for BLE devices and return { nodeId → device } for every ID in
 * `neighborsRequired`. Retries every SCAN_INTERVAL_MS up to MAX_ATTEMPTS.
 *
 * @param {number[]} neighborsRequired  – 1-based node IDs to discover
 * @returns {Promise<Record<number, object>>}
 */
async function bleGetDevices(neighborsRequired) {
    const nordicNeighbors = {};
    const found = new Set();

    const adapter = await bluetooth.defaultAdapter();
    if (!(await adapter.isDiscovering())) {
        await adapter.startDiscovery();
    }

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log(`[BLE] Attempt ${attempt}/${MAX_ATTEMPTS} – need: [${neighborsRequired}]`);

        const uuids = await adapter.devices();

        for (const uuid of uuids) {
            try {
                const device = await adapter.getDevice(uuid);

                // Silently skip devices with no advertised name (fixes DBus flood)
                const name = await _tryGetName(device);
                if (name !== LABCTRL_NAME) continue;

                const dataRaw = await _tryGetManufacturerData(device);
                if (!dataRaw) continue;

                const dataBuff = Object.values(dataRaw)[0];
                if (!dataBuff || dataBuff.length < 6) continue;

                const node = dataBuff.readUInt8(1);

                if (neighborsRequired.includes(node) && !found.has(node)) {
                    console.log(`[BLE] Found required node ${node}`);
                    nordicNeighbors[node] = device;
                    found.add(node);
                }
            } catch (err) {
                console.warn(`[BLE] Unexpected error (UUID ${uuid}):`, err.message ?? err);
            }
        }

        if (found.size === neighborsRequired.length) {
            console.log(`[BLE] All ${found.size} node(s) found.`);
            break;
        }

        if (attempt === MAX_ATTEMPTS) {
            console.error(`[BLE] Timed out. Found ${found.size}/${neighborsRequired.length} nodes.`);
            break;
        }

        await delay(SCAN_INTERVAL_MS);
    }

    return nordicNeighbors;
}

/**
 * Read the current virtual state from a Nordic device's manufacturer data.
 *
 * Payload layout (after the 2-byte manufacturer ID stripped by node-ble):
 *   Offset 0 : uint8  – netid_enabled (127 = enabled)
 *   Offset 1 : uint8  – node ID
 *   Offset 2 : int32  – vstate (little-endian)
 *
 * @param {object} device  – node-ble device handle
 * @returns {{ vstate: number, enabled: boolean }}
 */
async function bleGetState(device) {
    const dataRaw  = await device.getManufacturerData();
    const dataBuff = Object.values(dataRaw)[0];
    const netidEnabled = dataBuff.readUInt8(0);
    const vstate       = dataBuff.readInt32LE(2);
    return { vstate, enabled: netidEnabled === 127 };
}

/**
 * Build the manufacturer-data string for the bleadv.sh script.
 *
 * 5-byte payload: [ node(1) | vstate(4 LE) ]
 * Prefixed with 'f' (enabled) or '0' (disabled).
 *
 * @returns {string}  e.g. "f 0x01 0x34 0x12 0x00 0x00"
 */
function bleGenerateManufacturerData(enabled, node, vstate) {
    const buf = Buffer.alloc(5);
    buf.writeUInt8(node, 0);
    buf.writeInt32LE(vstate, 1);

    const prefix = enabled ? 'f' : '0';
    const bytes  = Array.from({ length: 5 }, (_, i) => `0x${buf.toString('hex', i, i + 1)}`);
    return `${prefix} ${bytes.join(' ')}`;
}

module.exports = { bleGetDevices, bleGetState, bleGenerateManufacturerData };