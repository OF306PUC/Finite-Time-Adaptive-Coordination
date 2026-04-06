'use strict';

const { createBluetooth } = require('node-ble');
const { bluetooth } = createBluetooth();

const SCAN_INTERVAL_MS  = 500;
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