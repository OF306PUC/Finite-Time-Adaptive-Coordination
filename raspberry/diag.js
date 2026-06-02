'use strict';

/**
 * Diagnostic instrumentation for the bridge edge process.
 *
 * Logs JSON-line snapshots to /tmp/diag-bridge-<node>.log every
 * `intervalMs` ms, plus on each trigger-on / trigger-off transition.
 * Captures metrics that grow when state leaks across consensus cycles:
 *
 *   - rssMB         Node process resident memory
 *   - heapMB        V8 heap used
 *   - fdCount       /proc/self/fd entries — proxy for D-Bus subscriptions
 *                   (each match rule subscription typically adds an fd)
 *   - btDevices     Devices in BlueZ's adapter cache (`bluetoothctl devices`)
 *   - btctlProcs    Live bluetoothctl processes
 *   - bleadvProcs   Live bleadv.sh processes
 *   - lastGetDevMs  Duration of the last bleGetDevices() call (ms)
 *   - lastGetDevN   Number of neighbors actually found in that call
 *   - cycle         Trigger-on count since process start
 *
 * Usage from edge.js (bridge branch):
 *
 *     const diag = require('./diag');
 *     diag.start(params.node);   // node id, used in log filename
 *
 *     // Wrap the bleGetDevices call:
 *     const t0 = Date.now();
 *     bleNeighbors = await bleGetDevices(neighborsRequired);
 *     diag.recordGetDevices(Date.now() - t0, Object.keys(bleNeighbors).length);
 *
 *     // On trigger transitions:
 *     diag.recordCycleStart();   // when trigger goes false -> true
 *     diag.recordCycleEnd();     // when trigger goes true  -> false
 *
 * Analyzing the log later (on the test Pi or after scp'ing back):
 *
 *     cat /tmp/diag-bridge-3.log | jq -c \
 *         '{cycle, rssMB, fdCount, btDevices, btctlProcs, lastGetDevMs}'
 *
 * Each metric should be approximately flat across cycles when state is
 * properly released. If anything trends up monotonically, that's the leak.
 */

const fs = require('fs');
const { execSync } = require('child_process');

const _state = {
    nodeId:       null,
    logPath:      null,
    intervalId:   null,
    cycleCount:   0,
    lastGetDevMs: null,
    lastGetDevN:  null,
    started:      false,
};

function _fdCount() {
    try {
        return fs.readdirSync('/proc/self/fd').length;
    } catch (_) {
        return -1;
    }
}

function _memMB() {
    const m = process.memoryUsage();
    return {
        rssMB:  Math.round(m.rss      / 1024 / 1024 * 10) / 10,
        heapMB: Math.round(m.heapUsed / 1024 / 1024 * 10) / 10,
    };
}

function _runQuick(cmd, fallback) {
    try {
        return execSync(cmd, { timeout: 1500, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString().trim();
    } catch (_) {
        return fallback;
    }
}

function _btDeviceCount() {
    const out = _runQuick('bluetoothctl devices 2>/dev/null', null);
    if (out === null) return -1;
    if (out === '')   return 0;
    return out.split('\n').length;
}

function _btctlProcs()  { return parseInt(_runQuick('pgrep -c bluetoothctl 2>/dev/null', '0'),  10) || 0; }
function _bleadvProcs() { return parseInt(_runQuick('pgrep -c -f bleadv.sh 2>/dev/null', '0'), 10) || 0; }

function _snapshot(tag) {
    if (!_state.started) return;
    const mem = _memMB();
    const snap = {
        ts:           new Date().toISOString(),
        tag:          tag || 'periodic',
        cycle:        _state.cycleCount,
        rssMB:        mem.rssMB,
        heapMB:       mem.heapMB,
        fdCount:      _fdCount(),
        btDevices:    _btDeviceCount(),
        btctlProcs:   _btctlProcs(),
        bleadvProcs:  _bleadvProcs(),
        lastGetDevMs: _state.lastGetDevMs,
        lastGetDevN:  _state.lastGetDevN,
    };
    try {
        fs.appendFileSync(_state.logPath, JSON.stringify(snap) + '\n');
    } catch (err) {
        // Don't crash the bridge over a logging failure
        process.stderr.write(`[diag] log write failed: ${err.message}\n`);
    }
}

/**
 * Begin instrumentation. Idempotent — safe to call multiple times.
 *
 * @param {number|string} nodeId       Node ID, used only in the log filename
 * @param {number}        intervalMs   Periodic snapshot interval (default 60s)
 */
function start(nodeId, intervalMs = 60000) {
    if (_state.started) return;
    _state.nodeId  = nodeId ?? 'unknown';
    _state.logPath = `/tmp/diag-bridge-${_state.nodeId}.log`;
    _state.started = true;

    const header = `# diag start: ${new Date().toISOString()} pid=${process.pid} node=${_state.nodeId}\n`;
    try { fs.appendFileSync(_state.logPath, header); } catch (_) {}

    _snapshot('start');
    _state.intervalId = setInterval(() => _snapshot('periodic'), intervalMs);
    if (_state.intervalId.unref) _state.intervalId.unref();

    process.stdout.write(`[diag] logging to ${_state.logPath} every ${intervalMs}ms\n`);
}

function stop() {
    if (_state.intervalId) clearInterval(_state.intervalId);
    _state.intervalId = null;
    _state.started    = false;
}

function recordGetDevices(durationMs, foundCount) {
    _state.lastGetDevMs = durationMs;
    _state.lastGetDevN  = foundCount;
}

function recordCycleStart() {
    _state.cycleCount += 1;
    _snapshot('cycle_start');
}

function recordCycleEnd() {
    _snapshot('cycle_end');
}

module.exports = { start, stop, recordGetDevices, recordCycleStart, recordCycleEnd };
