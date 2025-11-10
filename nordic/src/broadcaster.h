#ifndef BROADCASTER_H_
#define BROADCASTER_H_

// Include modules
#include <zephyr/bluetooth/bluetooth.h>
#include <zephyr/bluetooth/gap.h>
#include "common.h"

// Declare public functions
int broadcaster_init(custom_data_type* custom_data);
int broadcaster_update_scan_response_custom_data(custom_data_type* custom_data);

#endif // BROADCASTER_H_
