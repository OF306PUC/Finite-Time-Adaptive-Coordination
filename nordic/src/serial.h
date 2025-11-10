#ifndef SERIAL_H 
#define SERIAL_H

#include <zephyr/drivers/uart.h>
#include "common.h"

// Definitions
#define TX_BUFF_SIZE    64
#define RX_BUFF_SIZE    64
#define RX_TIMEOUT      50000   //50000us = 50ms = 0.05s. If this is too small, then we will not receive a full string from application

// Declare public functions
void serial_init(void);
void serial_log_consensus();

#endif // SERIAL_H