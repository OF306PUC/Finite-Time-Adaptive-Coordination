'use strict';

/**
 * BLE advertisement registrar using BlueZ's D-Bus LEAdvertisement1 interface.
 *
 * Replaces the bluetoothctl/expect approach (bleadv.sh) with a native Node
 * implementation. Benefits:
 *   - Exact control over MinInterval / MaxInterval (40 / 50 ms here)
 *   - Manufacturer data updates via PropertiesChanged signals; no stdin pipe,
 *     no expect script, no SIGTERM restart loop
 *   - Clean lifecycle: start / update / stop, with idempotent re-registration
 *
 * Dependency: dbus-next (already pulled in transitively by node-ble). Add it
 * as a direct dependency if you want to depend on it explicitly:
 *     npm install dbus-next
 *
 * Reference: doc/advertising-api.txt in the BlueZ source tree.
 */

const dbus = require('dbus-next');
const { Variant, Message, MessageType } = dbus;
const Interface = dbus.interface.Interface;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ADV_PATH          = '/org/bluez/labctrl/advertisement0';
const BLUEZ_SERVICE     = 'org.bluez';
const ADAPTER_PATH      = '/org/bluez/hci0';
const ADV_MANAGER_IFACE = 'org.bluez.LEAdvertisingManager1';

const MANUFACTURER_ID = 0x0059;      // Nordic Semiconductor
const ENABLED_FLAG    = 0x7F;
const DISABLED_FLAG   = 0x70;
const PAYLOAD_BYTES   = 6;           // [flag | node | vstate(4 LE)]
const LOCAL_NAME      = 'LABCTRL';
const MIN_INTERVAL_MS = 100;
const MAX_INTERVAL_MS = 150;

// ---------------------------------------------------------------------------
// LEAdvertisement1 D-Bus object
// ---------------------------------------------------------------------------

class LEAdvertisement extends Interface {
    constructor() {
        super('org.bluez.LEAdvertisement1');
        this.Type             = 'broadcast';   // non-connectable, non-scannable
        this.LocalName        = LOCAL_NAME;
        this.ManufacturerData = {};
        this.MinInterval      = MIN_INTERVAL_MS;
        this.MaxInterval      = MAX_INTERVAL_MS;
    }

    // BlueZ calls Release() when it drops the advertisement (e.g. on adapter
    // power-cycle). Logging this is helpful for debugging unexpected drops.
    Release() {
        console.log('[BLE] advertisement released by BlueZ');
    }

    /**
     * Replace the manufacturer-data payload and notify BlueZ to update the
     * on-air advertising data. BlueZ subscribes to PropertiesChanged on
     * registered advertisements and reprograms the controller automatically.
     */
    setPayload(payload) {
        this.ManufacturerData = {};
        this.ManufacturerData[MANUFACTURER_ID] = new Variant('ay', payload);
    }
}

LEAdvertisement.configureMembers({
    properties: {
        Type:             { signature: 's',     access: 'read' },
        LocalName:        { signature: 's',     access: 'read' },
        ManufacturerData: { signature: 'a{qv}', access: 'read' },
        MinInterval:      { signature: 'u',     access: 'read' },
        MaxInterval:      { signature: 'u',     access: 'read' },
    },
    methods: {
        Release: { inSignature: '', outSignature: '' },
    },
});

// ---------------------------------------------------------------------------
// Module state
// ---------------------------------------------------------------------------

let _bus           = null;
let _advertisement = null;
let _advManager    = null;
let _registered    = false;

// ---------------------------------------------------------------------------
// Payload encoding
// ---------------------------------------------------------------------------

/**
 * Build the 6-byte advertising payload:
 *   [0]    flag    (0x7F enabled / 0x70 disabled)
 *   [1]    node    (uint8)
 *   [2..5] vstate  (int32 little-endian)
 */
function _buildPayload(enabled, node, vstate) {
    const buf = Buffer.alloc(PAYLOAD_BYTES);
    buf.writeUInt8(enabled ? ENABLED_FLAG : DISABLED_FLAG, 0);
    buf.writeUInt8(node & 0xFF, 1);
    buf.writeInt32LE(vstate | 0, 2);   // |0 coerces to int32
    return buf;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Register the LE advertisement with BlueZ. Idempotent — if already
 * registered, just updates the payload.
 *
 * @param {{ enabled: boolean, node: number, vstate: number }} state
 */
async function start({ enabled, node, vstate }) {
    if (_registered) {
        return update({ enabled, node, vstate });
    }

    _bus = dbus.systemBus();
    _advertisement = new LEAdvertisement();
    _advertisement.setPayload(_buildPayload(enabled, node, vstate));

    _bus.export(ADV_PATH, _advertisement);

    const obj = await _bus.getProxyObject(BLUEZ_SERVICE, ADAPTER_PATH);
    _advManager = obj.getInterface(ADV_MANAGER_IFACE);

    // If a previous run crashed without cleaning up, BlueZ may still hold a
    // stale registration at our path. Try to clear it first; ignore errors.
    try { await _advManager.UnregisterAdvertisement(ADV_PATH); } catch (_) {}

    await _advManager.RegisterAdvertisement(ADV_PATH, {});
    _registered = true;
    console.log(`[BLE] advertisement registered (interval ${MIN_INTERVAL_MS}-${MAX_INTERVAL_MS} ms)`);
}

/**
 * Update the manufacturer data on the existing advertisement.
 *
 * Re-registers the advertisement to apply new data. The unregister/register
 * cycle conflicts with active LE scanning (BlueZ tries to set a random address
 * during registration, which the controller refuses with Command Disallowed
 * when scanning is enabled). So we pause discovery around the cycle.
 *
 * @param {object} state         - { enabled, node, vstate }
 * @param {object} discoveryCtl  - optional, { pause(), resume() } async functions
 */
async function update({ enabled, node, vstate }, discoveryCtl) {
    if (!_advertisement || !_registered) return;

    _advertisement.ManufacturerData = {};
    _advertisement.ManufacturerData[MANUFACTURER_ID] =
        new Variant('ay', _buildPayload(enabled, node, vstate));

    let wasPaused = false;
    if (discoveryCtl) {
        try {
            await discoveryCtl.pause();
            wasPaused = true;
            // Give BlueZ a moment to actually disable scanning at the controller.
            await new Promise(r => setTimeout(r, 20));
        } catch (err) {
            console.warn('[BLE] discovery pause failed (proceeding anyway):',
                err.message ?? err);
        }
    }

    try {
        try {
            await _advManager.UnregisterAdvertisement(ADV_PATH);
        } catch (_) { /* already unregistered, ignore */ }

        await _advManager.RegisterAdvertisement(ADV_PATH, {});
    } catch (err) {
        console.warn('[BLE] adv re-register failed:',
            err.message ?? err,
            '(errorName:', err.errorName ?? 'unknown', ')');
        throw err;
    } finally {
        if (wasPaused) {
            try {
                await discoveryCtl.resume();
            } catch (err) {
                console.warn('[BLE] discovery resume failed:', err.message ?? err);
            }
        }
    }
}

/**
 * Unregister the advertisement and release D-Bus resources.
 *
 * Does NOT disconnect from the system bus, since node-ble may share it.
 */
async function stop() {
    if (!_registered) return;
    try {
        await _advManager.UnregisterAdvertisement(ADV_PATH);
    } catch (err) {
        console.warn('[BLE] UnregisterAdvertisement failed:', err.message ?? err);
    }
    try { _bus.unexport(ADV_PATH); } catch (_) { /* ignore */ }
    _registered    = false;
    _advertisement = null;
    _advManager    = null;
}

module.exports = { start, update, stop };
