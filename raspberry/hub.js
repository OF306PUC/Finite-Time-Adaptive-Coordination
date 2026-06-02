const http = require('http');
const express = require('express');
const axios = require('axios');
const socketIo = require('socket.io');
const socketIoClient = require('socket.io-client');
const path = require('path');
const { execSync } = require('child_process');

const { IP_ADDRESS, HUB_PORT, NODES, BACKEND_IDS, BACKEND_ADDRESSES, NODE_ADDRESSES } = require('./net');
const { dataGetTree, dataUpdateTree, dataWriteFile } = require('./data');

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

app.use(express.static(path.join(__dirname, 'public')));
app.use('/data', express.static(path.join(__dirname, 'data')));
app.use(express.json());

// Store data in RAM for consensus parameters
let params = { trigger: false, filename: "dummy", nodes: NODES };

// ─── Experiment state buffer ─────────────────────────────────────────────────
// Hub accumulates every state event received via Socket.IO while trigger is on.
// A snapshot is written to disk every SNAPSHOT_INTERVAL_MS so data survives a
// hub crash (the per-node backend logs are the authoritative source; this is a
// hub-side safety copy that also carries experiment metadata).

const SNAPSHOT_INTERVAL_MS = 60_000;

let experimentBuffer  = {};  // { [id]: state[] }
let experimentMeta    = {};
let experimentDirPath = '';  // hub-side storage path for the active run
let snapshotIntervalId = null;

function getGitHash() {
    try { return execSync('git rev-parse HEAD').toString().trim(); }
    catch { return 'unknown'; }
}

function startExperimentBuffer(dirPath, filename, nodes) {
    experimentBuffer  = Object.fromEntries(BACKEND_IDS.map(id => [id, []]));
    experimentDirPath = dirPath;
    experimentMeta = {
        filename,
        startTime:   new Date().toISOString(),
        nodeVersion: process.version,
        gitHash:     getGitHash(),
        topology:    Object.fromEntries(BACKEND_IDS.map(id => [id, nodes[id] ?? NODES[id]])),
    };
    snapshotIntervalId = setInterval(() => saveSnapshot(), SNAPSHOT_INTERVAL_MS);
    console.log(`Hub-Server: experiment buffer started → ${dirPath}`);
}

async function saveSnapshot() {
    try {
        await dataWriteFile(
            { meta: experimentMeta, snapshotTime: new Date().toISOString(), data: experimentBuffer },
            experimentDirPath, 'hub_snapshot'
        );
        console.log(`Hub-Server: snapshot saved → ${experimentDirPath}`);
    } catch (err) {
        console.error('Hub-Server: snapshot save failed:', err.message);
    }
}

function stopExperimentBuffer() {
    if (snapshotIntervalId) {
        clearInterval(snapshotIntervalId);
        snapshotIntervalId = null;
    }
}

// dirPath   — hub storage directory  (e.g. "exp_ring9/run01" or "exp_ring9")
// backendFilename — name the backend used for its log file (e.g. "exp_ring9_run01")
async function collectRunData(dirPath, backendFilename, nodes) {
    stopExperimentBuffer();
    await dataWriteFile(
        { meta: { ...experimentMeta, endTime: new Date().toISOString() } },
        dirPath, 'meta'
    );
    const results = await Promise.allSettled(
        BACKEND_IDS.map(async id => {
            const response = await axios.get(
                `${BACKEND_ADDRESSES[id]}/${backendFilename}-${nodes[id].type}.json`
            );
            await dataWriteFile(response.data, dirPath, id);
        })
    );
    const failedCount = results.filter(r => r.status === 'rejected').length;
    if (failedCount > 0)
        console.error(`Hub-Server: ${failedCount}/${BACKEND_IDS.length} nodes failed data collection`);
    await dataUpdateTree();
}

// ─── Multi-run controller ─────────────────────────────────────────────────────

let multiRunState = { active: false, run: 0, total: 0, abort: false };

// midRunEvents: [{ delayMs, nodeUpdates: { [id]: { enabled, ... } } }, ...]
// Each event fires once per run at delayMs after the run starts, merging nodeUpdates
// into the live params and pushing them to all backends.
async function executeMultiRun(baseParams, numRuns, runDuration, runPause, midRunEvents = []) {
    multiRunState = { active: true, run: 0, total: numRuns, abort: false };

    for (let run = 1; run <= numRuns; run++) {
        if (multiRunState.abort) break;

        multiRunState.run = run;
        const runName         = `run${String(run).padStart(2, '0')}`;
        const backendFilename = `${baseParams.filename}_${runName}`;
        const dirPath         = `${baseParams.filename}/${runName}`;
        const runNodes = Object.fromEntries(
            Object.entries(baseParams.nodes).map(([id, node]) => [id, { ...node, vartheta: 0 }])
        );
        const runParams = { ...baseParams, nodes: runNodes, filename: backendFilename, trigger: true };

        console.log(`[multi-run] starting run ${run}/${numRuns}: "${backendFilename}"`);
        io.emit('multirun_progress', { run, total: numRuns, phase: 'running', filename: backendFilename });

        await updateBackendParams(runParams);
        startExperimentBuffer(dirPath, backendFilename, runNodes);
        params = runParams;

        // Schedule mid-run node updates
        const eventTimers = midRunEvents.map(({ delayMs, nodeUpdates }) =>
            setTimeout(async () => {
                if (multiRunState.abort) return;
                const updatedNodes = Object.fromEntries(
                    Object.entries(params.nodes).map(([id, node]) => [
                        id, nodeUpdates[id] ? { ...node, ...nodeUpdates[id] } : node
                    ])
                );
                const eventParams = { ...params, nodes: updatedNodes };
                await updateBackendParams(eventParams);
                params = eventParams;
                const ids = Object.keys(nodeUpdates);
                console.log(`[multi-run] run ${run}: mid-run event at ${delayMs}ms — nodes [${ids}] updated`);
                io.emit('multirun_progress', { run, total: numRuns, phase: 'midrun_event', nodeIds: ids, delayMs });
            }, delayMs)
        );

        await new Promise(resolve => setTimeout(resolve, runDuration));
        eventTimers.forEach(t => clearTimeout(t));

        const stopParams = { ...params, trigger: false };
        await updateBackendParams(stopParams);
        params = stopParams;

        await collectRunData(dirPath, backendFilename, runNodes);
        console.log(`[multi-run] run ${run}/${numRuns} saved`);
        io.emit('multirun_progress', { run, total: numRuns, phase: 'saved', filename: backendFilename });

        if (run < numRuns && !multiRunState.abort) {
            io.emit('multirun_progress', { run, total: numRuns, phase: 'pause' });
            await new Promise(resolve => setTimeout(resolve, runPause));
        }
    }

    const phase = multiRunState.abort ? 'aborted' : 'done';
    console.log(`[multi-run] ${phase} (${multiRunState.run}/${numRuns} runs completed)`);
    io.emit('multirun_progress', { run: multiRunState.run, total: numRuns, phase });
    multiRunState.active = false;
}

// ─── Backend param helpers ────────────────────────────────────────────────────

function generateBackendParams(updatedParams, id) {
    const neighbors = updatedParams.nodes[id].neighbors;
    return {
        trigger:            updatedParams.trigger,
        filename:           updatedParams.filename,
        node:               id,
        address:            NODE_ADDRESSES[id],
        neighborAddresses:  Object.fromEntries(neighbors.map(id => [id, NODE_ADDRESSES[id]])),
        ...updatedParams.nodes[id],
        neighborTypes:      Object.fromEntries(neighbors.map(id => [id, NODES[id].type])),
    };
}

// Push params to all backends concurrently. Uses allSettled so a single
// unreachable node does not abort the rest.
async function updateBackendParams(updatedParams) {
    const results = await Promise.allSettled(
        BACKEND_IDS.map(id =>
            axios.post(
                `${BACKEND_ADDRESSES[id]}/updateParams`,
                generateBackendParams(updatedParams, id)
            )
        )
    );
    const failed = results
        .map((r, i) => ({ r, id: BACKEND_IDS[i] }))
        .filter(({ r }) => r.status === 'rejected');
    if (failed.length > 0) {
        console.error(`Hub-Server: ${failed.length}/${BACKEND_IDS.length} backends failed to update:`,
            failed.map(({ id }) => id).join(', '));
    } else {
        console.log('Hub-Server: all backends updated successfully');
    }
}

updateBackendParams(params);

// ─── Socket.IO clients ────────────────────────────────────────────────────────

function startIoClients() {
    const sockets = BACKEND_IDS.reduce((acc, id) => {
        acc[id] = socketIoClient(BACKEND_ADDRESSES[id], {
            reconnection:        true,
            reconnectionDelay:   1000,
            reconnectionAttempts: Infinity,
        });
        return acc;
    }, {});

    for (const id of BACKEND_IDS) {
        sockets[id].on('state', (state) => {
            // Relay to browser
            io.emit(`state${id}`, state);
            // Buffer for incremental save
            if (params.trigger && experimentBuffer[id]) {
                experimentBuffer[id].push(state);
            }
            console.log(`[hub] Rx (IO-Server-${id}): x=${state.state}, z=${state.vstate}, ϑ=${state.vartheta}`);
        });

        sockets[id].on('disconnect', () =>
            console.warn(`Hub-Server: IO-Server-${id} disconnected, reconnecting...`)
        );
        sockets[id].on('reconnect', () =>
            console.log(`Hub-Server: IO-Server-${id} reconnected`)
        );
    }
}

startIoClients();

// ─── Pre-flight health check ──────────────────────────────────────────────────
// Polls every backend's /getVState. Returns which nodes are online/offline.
// Called by the browser before starting an experiment via GET /healthCheck.

async function healthCheck() {
    const results = await Promise.allSettled(
        BACKEND_IDS.map(id =>
            axios.get(`${NODE_ADDRESSES[id]}/getVState`, { timeout: 2000 })
        )
    );
    const offline = BACKEND_IDS.filter((_, i) => results[i].status === 'rejected');
    return { online: BACKEND_IDS.length - offline.length, total: BACKEND_IDS.length, offline };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

io.on('connection', (_socket) => {
    console.log('Hub-Server socket connected to Browser-Client');
});

app.get('/getDataTree',   (_req, res) => res.json(dataGetTree()));
app.get('/getBackendIds', (_req, res) => res.json(BACKEND_IDS));
app.get('/getParams',     (_req, res) => res.json(params));

app.get('/healthCheck', async (_req, res) => {
    const status = await healthCheck();
    res.json(status);
});

app.post('/updateParams', async (req, res) => {
    if (multiRunState.active)
        return res.status(409).json({ message: 'A multi-run sequence is active. Use /stopMultiRun first.' });

    const updatedParams = req.body;
    try {
        await updateBackendParams(updatedParams);

        if (updatedParams.trigger && !params.trigger) {
            startExperimentBuffer(updatedParams.filename, updatedParams.filename, updatedParams.nodes);
        } else if (!updatedParams.trigger && params.trigger) {
            await collectRunData(updatedParams.filename, updatedParams.filename, updatedParams.nodes);
        }

        params = updatedParams;
        console.log('Hub-Server params updated successfully.');
        res.status(200).json({ message: 'Hub-Server params updated successfully.', params });
    } catch (error) {
        console.error('Hub-Server error:', error.message);
        res.status(500).json({ message: 'Hub-Server error updating params.' });
    }
});

// ─── Multi-run routes ─────────────────────────────────────────────────────────

app.post('/startMultiRun', async (req, res) => {
    if (multiRunState.active)
        return res.status(409).json({ message: 'A multi-run sequence is already active.' });
    if (params.trigger)
        return res.status(409).json({ message: 'A single run is active. Stop it first.' });

    const { numRuns = 1, runDuration = 10000, runPause = 2000, midRunEvents = [], ...overrides } = req.body;
    // Merge overrides on top of current params so callers don't need to resend the full topology.
    const baseParams = { ...params, ...overrides, trigger: false };

    if (!Number.isInteger(numRuns) || numRuns < 1)
        return res.status(400).json({ message: 'numRuns must be a positive integer.' });
    if (runDuration < 1000)
        return res.status(400).json({ message: 'runDuration must be >= 1000 ms.' });
    if (runPause < 2000)
        return res.status(400).json({ message: 'runPause must be >= 2000 ms (Nordic BLE cleanup).' });
    if (!Array.isArray(midRunEvents))
        return res.status(400).json({ message: 'midRunEvents must be an array.' });
    for (const ev of midRunEvents) {
        if (typeof ev.delayMs !== 'number' || ev.delayMs <= 0 || ev.delayMs >= runDuration)
            return res.status(400).json({ message: 'Each midRunEvent.delayMs must be > 0 and < runDuration.' });
        if (typeof ev.nodeUpdates !== 'object' || ev.nodeUpdates === null)
            return res.status(400).json({ message: 'Each midRunEvent must have a nodeUpdates object.' });
    }

    res.status(202).json({ message: `Multi-run queued: ${numRuns} × ${runDuration} ms, pause ${runPause} ms, ${midRunEvents.length} mid-run event(s).` });

    executeMultiRun(baseParams, numRuns, runDuration, runPause, midRunEvents).catch(err => {
        console.error('[multi-run] fatal error:', err.message);
        multiRunState.active = false;
        io.emit('multirun_progress', { phase: 'error', error: err.message });
    });
});

app.post('/stopMultiRun', (_req, res) => {
    if (!multiRunState.active)
        return res.status(400).json({ message: 'No multi-run is active.' });
    multiRunState.abort = true;
    res.json({ message: 'Abort requested. Current run will finish before stopping.' });
});

app.get('/multiRunStatus', (_req, res) => res.json(multiRunState));

// ─── Shutdown ─────────────────────────────────────────────────────────────────

async function shutdown(signal) {
    console.log(`[hub] received ${signal}, cleaning up...`);
    try {
        if (multiRunState.active) multiRunState.abort = true;
        stopExperimentBuffer();
        if (params.trigger) await saveSnapshot();
    } finally {
        process.exit(0);
    }
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// ─── Start ────────────────────────────────────────────────────────────────────

server.listen(HUB_PORT, '0.0.0.0', () => {
    console.log(`Hub-Server running at http://${IP_ADDRESS}:${HUB_PORT}`);
});
