const { createBluetooth } = require('node-ble');
const { bluetooth, destroy } = createBluetooth();

const DELAY_LOOP = 1000; // Delay between each loop iteration in milliseconds

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));    
}

// Function to discover and retrive the required network devices
async function bleGetDevices(neighborsRequired) { 
    
    let numberAttempts = 0; 
    let devices = []; 
    let nordicNeighbors = {}; 

    const adapter = await bluetooth.defaultAdapter();
    if (!(await adapter.isDiscovering())) {
        await adapter.startDiscovery();
    }

    // >>> neighborsRequired is a list of devices included in the params --> updateParams route
    while (devices.length !== neighborsRequired.length) {
        
        numberAttempts++;
        console.log('Finding nodes. Attempt ' + numberAttempts); 

        // Get available devices: uuids
        const uuids = await adapter.devices(); 

        // Filter devices based on: 
        // >>> UUID 
        // >>> Node requirements 
        for (const uuid of uuids) {
            try { 
                const device = await adapter.getDevice(uuid);
                const name = await device.getName(); 
                
                if (name === 'LABCTRL') {
                    console.log('name: ', name); 

                    const dataRaw = await device.getManufacturerData();
                    const dataBuff = Object.values(dataRaw)[0]; 
                    const netidEnabled = dataBuff.readUInt8(0);
                    const node = dataBuff.readUInt8(1);
                    const value = dataBuff.readInt32LE(2);

                    console.log('node: ', node);

                    // If node is required given the params (Neighbors)
                    if (neighborsRequired.includes(node)) {
                        console.log('Found node: ', node); 
                        devices.push(device);
                        nordicNeighbors[node] = device; 
                    }
                }
            } catch (error) {
                // TODO: Handle error if device is not found or other issues
                console.error('Error retrieving device:', error);
            }
        }

        // If all required devices are found, break the loop
        if (devices.length === neighborsRequired.length) {
            console.log('All required nodes found: ', devices.length);
            break;
        }

        await delay(DELAY_LOOP); 
    }

    return nordicNeighbors;
}

// Function to get the state and vstate of a specific device: 
// For nordic board one defines a structure in C (custom_data_type) and sends it via manufacturer data: 
// Example of the custom_data_type structure in C that is being used:
// >>> typedef struct { 
// >>>     uint16_t manufacturer;
// >>>     uint8_t netid_enabled;
// >>>     uint8_t node;
// >>>     int32_t vstate;
// >>> } custom_data_type;
async function bleGetState(device) {

    // Field          | Size (bytes) | Offset in payload (excluding manufacturer ID)
    // -------------- | ------------ | ---------------------------------------------
    // netid_enabled  | 1            | 0
    // node           | 1            | 1
    // vstate         | 4            | 2

    const dataRaw = await device.getManufacturerData();
    const dataBuff = Object.values(dataRaw)[0];
    const netidEnabled = dataBuff.readUInt8(0);
    const node = dataBuff.readUInt8(1);
    const vstate = dataBuff.readInt32LE(2);

    return {vstate: vstate, enabled: (netidEnabled === 127)};
}

/**
 * Generates manufacturer data payload for BLE advertising.
 * 
 * Matches the behavior of the second version:
 * - Prepends "f" if enabled, "0" otherwise (not stored in buffer).
 * - node: 1 byte at offset 0.
 * - vstate: 4 bytes signed int (little endian) at offsets 1–4.
 * 
 * Returns a string like "f 0x01 0x34 0x12 0x00 0x00".
 */
function bleGenerateManufacturerData(enabled, node, vstate) {
    const buffer = Buffer.alloc(5);
  
    // Write node in first byte
    buffer.writeUInt8(node, 0);
  
    // Write 4-byte signed integer in little endian after node
    buffer.writeInt32LE(vstate, 1);
  
    // Build result string;
    return `${enabled ? 'f' : '0'}` +
         ` 0x${buffer.toString('hex', 0, 1)}` +
         ` 0x${buffer.toString('hex', 1, 2)}` + 
         ` 0x${buffer.toString('hex', 2, 3)}` +
         ` 0x${buffer.toString('hex', 3, 4)}` +
         ` 0x${buffer.toString('hex', 4, 5)}`;
}


// Exports:
module.exports = {
    bleGetDevices,
    bleGetState,
    bleGenerateManufacturerData
};
