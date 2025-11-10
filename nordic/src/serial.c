#include <stdlib.h>
#include <string.h> 
#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <zephyr/drivers/uart.h>
#include <zephyr/device.h>
#include <zephyr/devicetree.h>
#include "consensus.h"
#include "serial.h" 

// Register the logger for this module
LOG_MODULE_REGISTER(Module_Serial, LOG_LEVEL_INF);

static bool available_neighbors[N_MAX_NEIGHBORS] = {false};
static bool neighbor_enabled[N_MAX_NEIGHBORS] = {false};
static uint8_t neighbors[N_MAX_NEIGHBORS] = {1};
static int32_t neighbor_vstates[N_MAX_NEIGHBORS] = {50};

// Consensus parameters structure (using global scope for access in all functions)
consensus_params consensus = {
    false,                  // running
    false,                  // enabled  
    true,                   // first_time_running
    false,                  // all_neighbors_observed
    available_neighbors,    // avaliable_neighbors
    0,                      // node
    neighbors,              // neigbors
    1e6f,                   // scale_factor
    1e-6f,                  // inv_scale_factor
    1,                      // number of neighbors = N
    0,                      // time0 (internal clock time)
    1000,                   // period of the consensus task
    1000,                   // "dt": integration step 
    100,                    // initial state
    50,                     // initial vstate
    0,                      // initial vartheta
    0,                      // eta
    100,                    // state 
    50,                     // vstate
    1,                      // vartheta
    0,                      // active boolean
    0.050f,                 // epsilonON
    0.010f,                 // epsilonOFF
    neighbor_enabled,       // neighbor enabled
    neighbor_vstates,       // neighbor vstates
    {false, 0, 0, 0, 0, 0, 0, 0, 0}  // disturbance parameters
};  

/**
 * Device pointer to the UART hardware
 */
const struct device *uart = DEVICE_DT_GET(DT_NODELABEL(uart0)); 

// Buffers for TX and RX data
static uint8_t tx_buf[TX_BUFF_SIZE];
static uint8_t rx_buf[RX_BUFF_SIZE];

/**
 * Function to send the logged data over serial:
 */
void serial_log_consensus() {
    if (!consensus.running) {
        return; // Only log when the algorithm is active
    }
    
    // Prepare the string format: "dtime,state,vstate,vartheta,neighbor_vstate1,neighbor_vstate2,...neighbor_vstateN\n\r"
    int64_t timestamp = k_uptime_get() - consensus.time0; 
    int len = snprintf(
        (char *)tx_buf, sizeof(tx_buf), 
        "d%lld,%d,%d,%d", 
        timestamp, 
        consensus.state, 
        consensus.vstate, 
        consensus.vartheta
    );

    // Append neighbor states to the buffer making sure we do not exceed de Tx buffer size
    for (int i = 0; i < consensus.N; i++) {
        len += snprintf((char *)tx_buf + len, sizeof(tx_buf) - len, ",%d", consensus.neighbor_vstates[i]); 
    }

    len += snprintf((char *)tx_buf + len, sizeof(tx_buf) - len, "\n\r"); 

    // Send data asynchronously using uart_tx
    uart_tx(uart, tx_buf, len, SYS_FOREVER_US); 
}

/**
 * Callback function to handle UART events
 */
static void uart_cb(const struct device *dev, struct uart_event *evt, void *user_data) {
    switch (evt->type) {

        case UART_RX_RDY: {
            
            // Temporary buffer to safely copy the received message for strtok parsing.
            char msg_buffer[RX_BUFF_SIZE];
            size_t rx_len = evt->data.rx.offset + evt->data.rx.len;
            
            // Check for line ending within the new received data
            for (int i=evt->data.rx.offset; i < rx_len; i++) {
                uint8_t c = evt->data.rx.buf[i];

                if (c == '\r' || c == '\n') {
                    
                    // --- SAFETY COPY AND NULL TERMINATION ---
                    // Copy data from rx_buf (which is re-used by the driver) into local msg_buffer.
                    size_t full_msg_len = (i < rx_len) ? i + 1 : rx_len;
                    full_msg_len = (full_msg_len < RX_BUFF_SIZE) ? full_msg_len : RX_BUFF_SIZE - 1;
                    strncpy(msg_buffer, (char *)evt->data.rx.buf, full_msg_len);
                    msg_buffer[full_msg_len] = '\0';
                    // ---------------------------------------

                    // The actual start of the message is the first byte of the copied buffer
                    uint8_t type = msg_buffer[0]; 
                    char *pt;
                    uint8_t cnt; 

                    switch (type) {

                        // When receiving network configuration type: 'n'
                        case 'n':
                            // Start parsing after the message type (at index 1)
                            pt = strtok(msg_buffer + 1, ",");
                            cnt = 0;

                            while (pt != NULL) {
                                uint8_t id = atoi(pt); 

                                if (cnt == 0) {
                                    consensus.enabled = (id == 1); 
                                } else if (cnt == 1) {
                                    consensus.node = id; 
                                } else {
                                    consensus.neighbors[cnt-2] = id; 
                                }

                                cnt++; 
                                pt = strtok(NULL, ",");
                            }

                            consensus.N = cnt - 2; 
                            LOG_INF("Network parameters updated over serial");
                            LOG_INF("Node ID: %d, Enabled: %d, Neighbors: ", consensus.node, consensus.enabled);
                            for (int k = 0; k < consensus.N; k++) {
                                LOG_INF("%d ", consensus.neighbors[k]);
                            }
                            break; 

                        // When receiving consensus trigger type: 't'
                        case 't': 
                            if (msg_buffer[1] != '0') {
                                consensus.running = true; 
                                consensus.first_time_running = true; 
                                consensus.all_neighbors_observed = false;
                                consensus.disturbance.counter = 0;
                                consensus.time0 = k_uptime_get();
                                consensus.state = consensus.state0;
                                consensus.vstate = consensus.vstate0;
                                consensus.vartheta = consensus.vartheta0;
                                
                                for (int k = 0; k < N_MAX_NEIGHBORS; k++) {
                                    consensus.available_neighbors[k] = false;
                                    consensus.neighbor_vstates[k] = consensus.vstate0;
                                    consensus.neighbor_enabled[k] = false;
                                }
                                LOG_INF("Received 't1' (trigger). Consensus running"); 
                            } else {
                                consensus.running = false;
                                consensus.first_time_running = false;
                                LOG_INF("Received 't0' (stop). Consensus stopped");
                            }
                            break;

                        // When receiving core algorithm parameters: 'a' (6 parameters)
                        case 'a': 
                            pt = strtok(msg_buffer + 1, ","); 
                            cnt = 0; 
                            
                            while (pt != NULL) {
                                int32_t value = atoi(pt); 
                                switch (cnt) {
                                    case 0:  consensus.Ts           = value;        break;
                                    case 1:  consensus.dt           = value;        break; 
                                    case 2:  consensus.state0       = value;        break; 
                                    case 3:  consensus.vstate0      = value;        break; 
                                    case 4:  consensus.vartheta0    = value;        break; 
                                    case 5:  consensus.eta          = value;        break; 
                                    default: break;
                                }
                                cnt++; 
                                pt = strtok(NULL, ",");
                            }
                            LOG_INF("Algorithm parameters updated over serial.");
                            LOG_INF("Ts: %d, dt: %d, state0: %d, vstate0: %d, vartheta0: %d, eta: %d", 
                                consensus.Ts, consensus.dt, consensus.state0, consensus.vstate0, consensus.vartheta0, consensus.eta);
                            break;
                        
                        // When receiving disturbance related type: 'p' (8 parameters)
                        case 'p': 
                            pt = strtok(msg_buffer + 1, ","); 
                            cnt = 0; 
                            
                            while (pt != NULL) {
                                int32_t value = atoi(pt); 
                                switch (cnt) {
                                    case 0: consensus.disturbance.disturbance_on = (value == 1); break;
                                    case 1: consensus.disturbance.amplitude      = value;        break; 
                                    case 2: consensus.disturbance.offset         = value;        break; 
                                    case 3: consensus.disturbance.beta           = value;        break;
                                    case 4: consensus.disturbance.A              = value;        break;
                                    case 5: consensus.disturbance.frequency      = value;        break;
                                    case 6: consensus.disturbance.phase          = value;        break;
                                    case 7: consensus.disturbance.samples        = value;        break; 
                                    default: break;
                                }
                                cnt++; 
                                pt = strtok(NULL, ",");
                            }
                            LOG_INF("Disturbance parameters updated over serial.");
                            LOG_INF("Disturbance - on: %d, amplitude: %d, offset: %d, beta: %d, A: %d, frequency: %d, phase: %d, samples: %d", 
                                consensus.disturbance.disturbance_on, consensus.disturbance.amplitude, consensus.disturbance.offset, consensus.disturbance.beta,    
                                consensus.disturbance.A, consensus.disturbance.frequency, consensus.disturbance.phase, consensus.disturbance.samples);
                            break;
     
                        default: 
                            LOG_ERR("The received message has unknown type: %c.", type); 
                            break; 
                    }
                    
                    // Disable Rx to reset the offset of the Rx Buffer
                    uart_rx_disable(dev); 
                    break; 
                }
            }
            break; 
        } 
        
        case UART_RX_DISABLED: 
            // Re-enable RX after processing the message
            uart_rx_enable(dev, rx_buf, sizeof(rx_buf), RX_TIMEOUT); 
        
        default: 
            break; 
    }
}

/**
 * Function to start serial:
 */
void serial_init() {

    if (!device_is_ready(uart)) {
        LOG_ERR("Serial not ready!"); 
        return; 
    }

    int err = uart_callback_set(uart, uart_cb, NULL); 
    if (err) {
        LOG_ERR("Serial failed to set callback (err %d)\n", err);
        return;
    }

    err = uart_rx_enable(uart, rx_buf, sizeof rx_buf, RX_TIMEOUT);
    if (err) {
        LOG_ERR("Serial failed to enable read (err %d)\n", err);
        return;
    }
    
    // DEBUG: Log initialization success
    LOG_INF("Serial successfully initialized and RX is enabled.");
    return;
}
