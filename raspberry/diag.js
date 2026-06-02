'use strict';

/**
 * Diagnostic instrumentation for the bridge edge process.
 *
 * Logs JSON-line snapshots to /tmp/diag-bridge-<node>.log every
 * `intervalMs` ms, plus on each trigger-on / trigger-off transition,
 * plus a final aggregated summary on process shutdown.
 *
 * Metrics per snapshot:
 *   - rssMB         Node process resident memory
 *   - heapMB        V8 heap used
 *   - fdCount       /proc/self/fd entries (proxy for D-Bus subscriptions)
 *   - btDevices     Devices in BlueZ's adapter cache (all BLE addresses ever seen)
 *   - btLabctrl     LABCTRL-named devices specifically (testbed signal vs RF noise)
 *   - btctlProcs    Live bluetoothctl processes
 *   - bleadvProcs   Live bleadv.sh processes
 *   - lastGetDevMs  Duration of the last bleGetDevices() call (ms)
 *   - lastGetDevN   Number of neighbors actually found in that call
 *   - cycle         Trigger-on count since process start
 *
 * Per-cycle deltas (only on cycle_end snapshots):
 *   - deltaRssMB      RSS growth since the start of this cycle
 *   - deltaBtDevices  BlueZ device cache growth since cycle start
 *   - deltaFdCount    fd count growth since cycle start
 *
 * Usage from edge.js (bridge branch):
 *
 *     const diag = require('./diag');
 *     diag.start(params.node);
 *
 *     // wrap bleGetDevices:
 *     const t0 = Date.now();
 *     nordicNeighbors = await bleGetDevices(neighborsRequired);
 *     diag.recordGetDevices(Date.now() - t0, Object.keys(nordicNeighbors).length);
 *
 *     // mark trigger transitions:
 *     diag.recordCycleStart();   // when trigger goes false -> true
 *     diag.recordCycleEnd();     // when trigger goes true  -> false
 *
 * Analyze later with jq:
 *
 *     grep cycle_end /tmp/diag-bridge-*.log | jq -c \
 *         '{cycle, rssMB, btDevices, btLabctrl, fdCount, lastGetDevMs, lastGetDevN, deltaRssMB, deltaBtDevices}'
 *
 *     grep '"tag":"final"' /tmp/diag-bridge-*.log | jq .
 */

const fs = require('fs');
const { execSync } = require('child_process');

const _state = {
    nodeId:           null,
    logPath:          null,
    intervalId:       null,
    cycleCount:       0,
    lastGetDevMs:     null,
    lastGetDevN:      null,
    started:          false,

    // Per-cycle anchors, captured at cycle_start
    cycleStartRssMB:      null,
    cycleStartBtDevices:  null,
    cycleStartFdCount:    null,

    // Running aggregates for the final summary
    minRssMB:            Infinity,
    maxRssMB:            -Infinity,
    minBtDevices:        Infinity,
    maxBtDevices:        -Infinity,
    maxFdCount:          -Infinity,
    maxLastGetDevMs:     -Infinity,
    cyclesWithZeroFound: 0,
    cyclesWithFound:     0,
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

function _btLabctrlCount() {
    // Distinguish LABCTRL-named devices (testbed peers we care about) from
    // RF noise (phones, headphones, neighboring lab equipment) BlueZ caches.
    // If btDevices grows but btLabctrl is constant, the growth is noise.
    const out = _runQuick(
        'bluetoothctl devices 2>/dev/null | grep -c LABCTRL || true',
        '0'
    );
    return parseInt(out, 10) || 0;
}

function _btctlProcs()  { return parseInt(_runQuick('pgrep -c bluetoothctl 2>/dev/null', '0'),  10) || 0; }
function _bleadvProcs() { return parseInt(_runQuick('pgrep -c -f bleadv.sh 2>/dev/null', '0'), 10) || 0; }

function _gatherMetrics() {
    const mem = _memMB();
    return {
        rssMB:        mem.rssMB,
        heapMB:       mem.heapMB,
        fdCount:      _fdCount(),
        btDevices:    _btDeviceCount(),
        btLabctrl:    _btLabctrlCount(),
        btctlProcs:   _btctlProcs(),
        bleadvProcs:  _bleadvProcs(),
    };
}

function _updateAggregates(m) {
    if (m.rssMB     >= 0) { _state.minRssMB     = Math.min(_state.minRssMB,     m.rssMB);     _state.maxRssMB     = Math.max(_state.maxRssMB,     m.rssMB); }
    if (m.btDevices >= 0) { _state.minBtDevices = Math.min(_state.minBtDevices, m.btDevices); _state.maxBtDevices = Math.max(_state.maxBtDevices, m.btDevices); }
    if (m.fdCount   >= 0) { _state.maxFdCount   = Math.max(_state.maxFdCount,   m.fdCount); }
}

function _writeLine(obj) {
    if (!_state.started) return;
    try {
        fs.appendFileSync(_state.logPath, JSON.stringify(obj) + '\n');
    } catch (err) {
        process.stderr.write(`[diag] log write failed: ${err.message}\n`);
    }
}

function _snapshot(tag) {
    if (!_state.started) return null;
    const m = _gatherMetrics();
    _updateAggregates(m);

    const snap = {
        ts:           new Date().toISOString(),
        tag:          tag || 'periodic',
        cycle:        _state.cycleCount,
        ...m,
        lastGetDevMs: _state.lastGetDevMs,
        lastGetDevN:  _state.lastGetDevN,
    };

    if (tag === 'cycle_end' && _state.cycleStartRssMB !== null) {
        snap.deltaRssMB      = Math.round((m.rssMB     - _state.cycleStartRssMB)     * 10) / 10;
        snap.deltaBtDevices  =             m.btDevices - _state.cycleStartBtDevices;
        snap.deltaFdCount    =             m.fdCount   - _state.cycleStartFdCount;
    }

    _writeLine(snap);
    return snap;
}

function _writeFinal() {
    if (!_state.started) return;
    const m = _gatherMetrics();
    const summary = {
        ts:                  new Date().toISOString(),
        tag:                 'final',
        totalCycles:         _state.cycleCount,
        cyclesWithFound:     _state.cyclesWithFound,
        cyclesWithZeroFound: _state.cyclesWithZeroFound,
        rssMB_final:         m.rssMB,
        rssMB_min:           _state.minRssMB     === Infinity  ? null : _state.minRssMB,
        rssMB_max:           _state.maxRssMB     === -Infinity ? null : _state.maxRssMB,
        rssMB_growth:        (_state.maxRssMB !== -Infinity && _state.minRssMB !== Infinity)
                                 ? Math.round((_state.maxRssMB - _state.minRssMB) * 10) / 10
                                 : null,
        btDevices_max:       _state.maxBtDevices    === -Infinity ? null : _state.maxBtDevices,
        fdCount_max:         _state.maxFdCount      === -Infinity ? null : _state.maxFdCount,
        lastGetDevMs_max:    _state.maxLastGetDevMs === -Infinity ? null : _state.maxLastGetDevMs,
        btctl_alive_now:     m.btctlProcs,
        bleadv_alive_now:    m.bleadvProcs,
    };
    _writeLine(summary);
}

/**
 * Begin instrumentation. Idempotent.
 *
 * @param {number|string} nodeId       used only in the log filename
 * @param {number}        intervalMs   periodic snapshot interval (default 60s)
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

    process.on('exit',    () => _writeFinal());
    process.on('SIGTERM', () => _writeFinal());
    process.on('SIGINT',  () => _writeFinal());

    process.stdout.write(`[diag] logging to ${_state.logPath} every ${intervalMs}ms\n`);
}

function stop() {
    if (_state.intervalId) clearInterval(_state.intervalId);
    _state.intervalId = null;
    _writeFinal();
    _state.started    = false;
}

function recordGetDevices(durationMs, foundCount) {
    _state.lastGetDevMs = durationMs;
    _state.lastGetDevN  = foundCount;
    if (durationMs > _state.maxLastGetDevMs) _state.maxLastGetDevMs = durationMs;
    if (foundCount === 0) _state.cyclesWithZeroFound += 1;
    else                  _state.cyclesWithFound     += 1;
}

function recordCycleStart() {
    _state.cycleCount += 1;
    const snap = _snapshot('cycle_start');
    if (snap) {
        _state.cycleStartRssMB     = snap.rssMB;
        _state.cycleStartBtDevices = snap.btDevices;
        _state.cycleStartFdCount   = snap.fdCount;
    }
}

function recordCycleEnd() {
    _snapshot('cycle_end');
}

module.exports = { start, stop, recordGetDevices, recordCycleStart, recordCycleEnd };