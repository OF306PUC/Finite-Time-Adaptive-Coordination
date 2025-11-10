#include <zephyr/kernel.h>
#include <zephyr/logging/log.h>
#include <dk_buttons_and_leds.h>
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/gap.h>
#include <string.h> 

#include "consensus.h"
#include "common.h"
#include "observer.h"
#include "broadcaster.h"
#include "serial.h"

// Register the logger for this module
LOG_MODULE_REGISTER(Module_Main, LOG_LEVEL_INF);

/**
 * Led status
 */
#define LED_STATUS                     DK_LED1
/**
 * Thread stack size and priority
 */
#define APP_STACK_SIZE                 3072
#define THREAD_SLOW_NETWORK_PRIORITY   7
#define THREAD_FAST_DYNAMICS_PRIORITY  5

// --- TIMER, SEMAPHORE AND MUTEX structs ---
static struct k_timer dynamics_timer;
static struct k_mutex consensus_mutex;
static struct k_sem dynamics_sem; // Semaphore for 1ms clocking

/**
 * Function declarations: --------------------------------------------------------------
 */
static void leds_init(void);                          // Auxiliary function for starting LEDs
static void bt_init(void);                            // Auxiliary function for starting Bluetooth
static void fast_dynamics_thread(void);               // Dedicated thread for 1ms dynamics
static void slow_network_thread(void);                // Slow network/logging thread (body of original thread_consensus)
static void dynamics_timer_cb(struct k_timer *dummy); // High-frequency dynamics timer callback
/*
 * -------------------------------------------------------------------------------------
 */

/**
 * --- THREAD DEFINITIONS ---
 * The fast thread (P=5) handles the 1ms dynamics via a semaphore clock.
 * The slow thread (P=7) handles network I/O and logging.
 */
K_THREAD_DEFINE(fast_dynamics_thread_id, APP_STACK_SIZE,
                fast_dynamics_thread, NULL, NULL, NULL,
                THREAD_FAST_DYNAMICS_PRIORITY, 0, 0);

// Assuming thread_consensus_app should execute the thread_slow_network logic
K_THREAD_DEFINE(thread_consensus_id, APP_STACK_SIZE, slow_network_thread,
                NULL, NULL, NULL, THREAD_SLOW_NETWORK_PRIORITY, 0, 0);

/**
 * Main thread (entry point of the program):
 */
int main(void) {
    int blink_status = 0;

    leds_init();
    bt_init();
    serial_init();

    // Original k_work_init and k_timer_init are replaced/modified:
    k_mutex_init(&consensus_mutex);
    k_sem_init(&dynamics_sem, 0, 1);
    k_timer_init(&dynamics_timer, dynamics_timer_cb, NULL);

    while (1) {
        dk_set_led(LED_STATUS, (++blink_status) % 2);
        k_sleep(K_MSEC(1000)); // Simple blink, non-critical
    }
}

/**
 * Function definitions:
 */
static void leds_init(void) {
    int err = dk_leds_init();
    if (err) {
        LOG_ERR("Status LED failed to start (err %d)\n", err);
        return;
    }
    LOG_INF("Status LED successfully started\n");
}

static void bt_init(void) {
    int err = bt_enable(NULL);
    if (err) {
        LOG_ERR("Bluetooth failed to start (err %d)\n", err);
        return;
    }
    LOG_INF("Bluetooth successfully started\n");
}

/**
 * --- FAST SIMULATION LOOP (Timer Handler) ---
 * Runs every 'consensus.dt' (e.g., 1ms) in an ISR context.
 */
static void dynamics_timer_cb(struct k_timer *dummy) {
    ARG_UNUSED(dummy);
    k_sem_give(&dynamics_sem);
}

/**
 * --- DEDICATED FAST AGENT DYNAMICS THREAD ---
 * Runs when signaled by the timer semaphore (P=5).
 */
static void fast_dynamics_thread(void) {
    while (1) {
        k_sem_take(&dynamics_sem, K_FOREVER);

        k_mutex_lock(&consensus_mutex, K_FOREVER);
        if (consensus.running && consensus.enabled) {
            update_consensus(&consensus);
            custom_data_type custom_data = {
                MANUFACTURER_ID,
                consensus.enabled ? NETID_ENABLED : NETID_DISABLED,
                consensus.node,
                consensus.vstate
            };
            broadcaster_update_scan_response_custom_data(&custom_data);
        }
        k_mutex_unlock(&consensus_mutex);
    }
}

/**
 * --- SLOW NETWORK/LOGGING LOOP (Thread) ---
 * Runs periodically/blocking for network I/O and serial logging (P=7).
 */
static void slow_network_thread(void) {
    static consensus_params log_data_copy;
    static neighbor_info_type neighbor_info;

    while (1) {
        if (consensus.running) {
            if (consensus.first_time_running) {
                custom_data_type initial_data = {
                    MANUFACTURER_ID,
                    consensus.enabled ? NETID_ENABLED : NETID_DISABLED,
                    consensus.node,
                    consensus.vstate
                };
                broadcaster_init(&initial_data);
                observer_init();
                k_timer_start(&dynamics_timer, K_MSEC(0), K_MSEC(consensus.dt));
                consensus.first_time_running = false;
            }

            // --- SLOW BLOCKING NETWORK I/O (Receiving neighbor data) ---
            if (consensus.all_neighbors_observed) {
                // Blocks until a new network message is available
                if (!k_msgq_get(&custom_observer_msg_queue, &neighbor_info, K_FOREVER)) {

                    k_mutex_lock(&consensus_mutex, K_FOREVER);
                    if (consensus.enabled) {
                        memcpy(consensus.neighbor_vstates, neighbor_info.vstates, sizeof(neighbor_info.vstates));
                        memcpy(consensus.neighbor_enabled, neighbor_info.enabled, sizeof(neighbor_info.enabled));
                    }
                    memcpy(&log_data_copy, &consensus, sizeof(consensus_params));
                    k_mutex_unlock(&consensus_mutex);
                    serial_log_consensus(&log_data_copy);
                }
            }
            k_sleep(K_MSEC(consensus.Ts));
        } else {
            k_timer_stop(&dynamics_timer);
            k_sleep(K_MSEC(1000));
        }
    }
}
