// Module-level cache: uuid -> nodeId (if LABCTRL) or null (if not LABCTRL).
// Persists for the lifetime of the Node process. Bounds match rule growth
// to "number of unique BLE addresses ever seen", not "number of cycles".
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
            // Skip uuids we've already classified as non-LABCTRL — no getDevice call.
            // This is the key change: prevents node-ble from re-proxying known-uninteresting devices.
            if (_uuidClassification.has(uuid) && _uuidClassification.get(uuid) === null) {
                continue;
            }

            try {
                // For known LABCTRL uuids matching our needs, getDevice is unavoidable
                // (we need the device object to pass to bleGetState later). But we only
                // hit this branch for uuids we've already proxied — no new match rules.
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

                // Unknown uuid: classify it. This is the only path that creates a new proxy.
                const device  = await adapter.getDevice(uuid);
                const name    = await _tryGetName(device);
                if (name !== LABCTRL_NAME) {
                    _uuidClassification.set(uuid, null);   // mark non-LABCTRL forever
                    continue;
                }

                const dataRaw = await _tryGetManufacturerData(device);
                const buf     = _extractPayload(dataRaw);
                if (!buf) continue;   // don't cache yet; payload may arrive later

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