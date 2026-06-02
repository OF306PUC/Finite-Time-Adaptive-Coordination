/**
 * pm2 ecosystem file — runs on each Raspberry Pi.
 *
 * Usage:
 *   pm2 start   ecosystem.config.js     # first run
 *   pm2 reload  ecosystem.config.js     # zero-downtime reload after deploy
 *   pm2 stop    ecosystem.config.js     # stop all three agents
 *   pm2 delete  ecosystem.config.js     # remove from pm2 registry
 */

'use strict';

const path = require('path');
const LOGS = path.join(__dirname, 'logs');

const COMMON = {
    script:       'back.js',
    cwd:          __dirname,
    watch:        false,
    autorestart:  true,
    // Exponential back-off on repeated crashes: 100 ms → 200 → 400 → … → 8 s max.
    // Prevents a missing serial port or bluetoothctl failure from hammering restarts.
    exp_backoff_restart_delay: 100,
    max_restarts:  20,
    max_memory_restart: '256M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
};

module.exports = {
    apps: [
        {
            ...COMMON,
            name:     'ble',
            args:     'ble',
            out_file: path.join(LOGS, 'ble-out.log'),
            err_file: path.join(LOGS, 'ble-err.log'),
        },
        {
            ...COMMON,
            name:     'wifi',
            args:     'wifi',
            out_file: path.join(LOGS, 'wifi-out.log'),
            err_file: path.join(LOGS, 'wifi-err.log'),
        },
        {
            ...COMMON,
            name:     'bridge',
            args:     'bridge',
            out_file: path.join(LOGS, 'bridge-out.log'),
            err_file: path.join(LOGS, 'bridge-err.log'),
        },
    ],
};
