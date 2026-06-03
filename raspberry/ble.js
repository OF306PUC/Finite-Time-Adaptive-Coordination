'use strict';

const { createBluetooth } = require('node-ble');
const { bluetooth, destroy } = createBluetooth();

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const SCAN_INTERVAL_MS  = 200;
const MAX_ATTEMPTS      = 30;
const LABCTRL_NAME      = 'LABCTRL';
const MANUFACTURER_ID   = 0x0059;            // Nordic Semiconductor
const ENABLED_FLAG      = 0x7F;              // first received byte when enabled
const PAYLOAD_BYTES     = 6;                 // [flag | node | vstate(4 LE)]

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _adapter = null;

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Adapter lifecycle
// ---------------------------------------------------------------------------

async function _getAdapter() {
    if (!_adapter) _adapter = await bluetooth.defaultAdapter();
    return _adapter;
}

/**
 * Start LE-only discovery with an explicit filter.
 *
 *   Transport='le'        — skip classic BR/EDR inquiry, which otherwise
 *                           periodically steals airtime from LE scanning.
 *   DuplicateData=true    — BlueZ default; set explicitly so behaviour is
 *                           obvious in code rather than dependent on distro
 *                           defaults. Required for fresh ManufacturerData on
 *                           each adv packet.
 *
 * setDiscoveryFilter must be called BEFORE startDiscovery, otherwise BlueZ
 * silently ignores it. If discovery is already running, we leave it alone.
 */
async function bleStartDiscovery() {
    const adapter = await _getAdapter();
    if (await adapter.isDiscovering()) return;
    try {
        await adapter.setDiscoveryFilter({
            Transport: 'le',
            DuplicateData: true,
        });
    } catch (err) {
        /* ignore */ //console.warn('[BLE] setDiscoveryFilter failed:', err.message ?? err);
    }
    await adapter.startDiscovery();
}

async function bleStopDiscovery() {
    if (!_adapter) return;
    try {
        if (await _adapter.isDiscovering()) await _adapter.stopDiscovery();
    } catch (err) {
        console.warn('[BLE] stopDiscovery failed:', err.message ?? err);
    }
}

/**
 * Clean shutdown — call from edge.js's SIGTERM/SIGINT handlers.
 */
async function bleCleanup() {
    await bleStopDiscovery();
    try { destroy(); } catch (_) { /* node-ble can throw if already torn down */ }
    _adapter = null;
}

// ---------------------------------------------------------------------------
// Safe property readers
// ---------------------------------------------------------------------------

async function _tryGetName(device) {
    try {
        return await device.getName();
    } catch (err) {
        const missing =
            err?.errorName === 'org.freedesktop.DBus.Error.InvalidArgs' ||
            err?.text?.includes("No such property 'Name'");
        if (missing) return null;
        throw err;
    }
}

async function _tryGetManufacturerData(device) {
    try {
        return await device.getManufacturerData();
    } catch {
        return null;
    }
}

async function _tryGetRSSI(device) {
    try {
        return await device.getRSSI();
    } catch {
        return null;
    }
}

/**
 * Extract the payload buffer for our manufacturer ID. node-ble keys this map
 * by integer in some versions and by stringified integer in others — check
 * both. Falls back to "first value" to preserve original behaviour.
 * Returns null if absent or shorter than PAYLOAD_BYTES.
 */
function _extractPayload(dataRaw) {
    if (!dataRaw) return null;
    let buf = dataRaw[MANUFACTURER_ID] ?? dataRaw[String(MANUFACTURER_ID)];
    if (!buf) buf = Object.values(dataRaw)[0];
    if (!buf || buf.length < PAYLOAD_BYTES) return null;
    return buf;
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

const _uuidClassification = new Map(); 

async function bleGetDevices(neighborsRequired) {
    const bleNeighbors = {};
    const found = new Set();

    await bleStartDiscovery();
    const adapter = await _getAdapter();

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        console.log(`[BLE] Attempt ${attempt}/${MAX_ATTEMPTS} – need: [${neighborsRequired}]`);

        const uuids = await adapter.devices();

        for (const uuid of uuids) {
            /* Skip uuids we've añready classified as non-(BLE-name-for-network) */
            if (_uuidClassification.has(uuid) && _uuidClassification.get(uuid) == null) {
                continue; 
            }

            try {
                /* Only hit this branch for uuids we've already proxied - no new match rules for DBus */
                if (_uuidClassification.has(uuid)) {
                    const cachedNode = _uuidClassification.get(uuid); 
                    if (neighborsRequired.includes(cachedNode) && !found.has(cachedNode)) {
                        const device = await adapter.getDevice(uuid); 
                        bleNeighbors[cachedNode] = device; 
                        found.add(cachedNode); 
                        console.log(`[BLE] Found (cached) node ${cachedNode}`); 
                    }
                    continue; 
                }

                /* Unknown uuid: classify it ==> only path that create a new proxy that holds match rules for DBus */
                const device = await adapter.getDevice(uuid);
                const name = await _tryGetName(device);
                if (name !== LABCTRL_NAME) {
                    _uuidClassification.set(uuid, null); /* Marked as non-(BLE-name-for-network) forever */
                    continue;
                }

                const dataRaw = await _tryGetManufacturerData(device);
                const buf     = _extractPayload(dataRaw);
                if (!buf) continue;

                const node = buf.readUInt8(1);
                _uuidClassification.set(uuid, node); 

                if (neighborsRequired.includes(node) && !found.has(node)) {
                    console.log(`[BLE] Found required node ${node}`);
                    bleNeighbors[node] = device;
                    found.add(node);
                }
            } catch (err) {
                console.warn(`[BLE] Unexpected error (UUID ${uuid}):`, err.message ?? err);
            }
        }

        if (found.size === neighborsRequired.length) {
            console.log(`[BLE] All ${found.size} node(s) found.`);
            return bleNeighbors;
        }

        if (attempt === MAX_ATTEMPTS) {
            console.error(`[BLE] Timed out. Found ${found.size}/${neighborsRequired.length} nodes.`);
            return bleNeighbors;
        }

        await delay(SCAN_INTERVAL_MS);
    }
}

/**
 * Read the current virtual state from a Nordic device's manufacturer data.
 *
 * Payload layout (after the 2-byte manufacturer ID stripped by node-ble):
 *   Offset 0 : uint8  – flag (0x7F = enabled, 0x70 = disabled)
 *   Offset 1 : uint8  – node ID
 *   Offset 2 : int32  – vstate (little-endian)
 *
 * Returns the parsed state plus RSSI and an `ok` flag. The original code
 * threw on missing fields, which crashed the network fetch loop; this
 * version returns a safe default and lets the caller decide.
 *
 * RSSI is exposed so the caller can use it as a liveness proxy: BlueZ
 * updates it on every received adv packet, so an unchanging RSSI across
 * polls strongly suggests the device has gone silent and the cached
 * manufacturer data is stale.
 *
 * @returns {{ vstate: number|null, enabled: boolean, rssi: number|null, ok: boolean }}
 */
async function bleGetState(device) {
    try {
        const dataRaw = await _tryGetManufacturerData(device);
        const buf     = _extractPayload(dataRaw);
        if (!buf) {
            return { vstate: null, enabled: false, rssi: null, ok: false };
        }

        const flag   = buf.readUInt8(0);
        const vstate = buf.readInt32LE(2);
        const rssi   = await _tryGetRSSI(device);

        return {
            vstate,
            enabled: flag === ENABLED_FLAG,
            rssi,
            ok: true,
        };
    } catch (err) {
        console.warn('[BLE] bleGetState failed:', err.message ?? err);
        return { vstate: null, enabled: false, rssi: null, ok: false };
    }
}

/**
 * Build the manufacturer-data string for the bleadv.sh script.
 *
 * 5-byte payload: [ node(1) | vstate(4 LE) ]
 * Prefixed with character 'f' (enabled) or '0' (disabled).
 *
 * The shell script bleadv.sh prepends "0x7" to this string, which combines
 * with 'f' or '0' to form the first transmitted byte (0x7F or 0x70). This
 * split-encoding convention is preserved as-is per user request.
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

module.exports = {
    bleGetDevices,
    bleGetState,
    bleGenerateManufacturerData,
    bleStartDiscovery,
    bleStopDiscovery,
    bleCleanup,
};