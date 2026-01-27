#include "broadcaster.h"

// Register the logger for this module
LOG_MODULE_REGISTER(Module_Broadcaster, LOG_LEVEL_INF);

/**
 * Type variable to control many aspects of the advertising 
 * --> it could replace the default advertising parameters given by BT_LE_ADV_NCONN
 */
static const struct bt_le_adv_param *adv_param =
	BT_LE_ADV_PARAM(BT_LE_ADV_OPT_NONE, /* No options specified */
	64, /* Min Advertising Interval 40ms (64*0.625ms) */
	80, /* Max Advertising Interval 50ms (80*0.625ms) */
	NULL /* Set to NULL for undirected advertising */
); /* Set to NULL for undirected advertising */
            

/** 
 * Function that initialize the broadcaster with scan response
 */
int broadcaster_init(custom_data_type* custom_data)
{
	struct bt_data ad[] = {
		BT_DATA(BT_DATA_NAME_COMPLETE, DEVICE_NAME, DEVICE_NAME_LEN),
		BT_DATA(BT_DATA_MANUFACTURER_DATA, (unsigned char *)custom_data, sizeof(custom_data_type))
	};
	// Min adv time is 100ms, max is 150ms for BT_LE_ADV_NCONN
    int err = bt_le_adv_start(adv_param, ad, ARRAY_SIZE(ad), ad, ARRAY_SIZE(ad));
	if (err) {
		LOG_ERR("Advertising failed to start (err %d)\n", err);
		return err;
	}
	LOG_INF("Advertising successfully started\n");
	return 0;
}

/**
 * Function that updates the broadcaster with scan response
 */
int broadcaster_update_scan_response_custom_data(custom_data_type* custom_data)
{
	struct bt_data ad[] = {
		BT_DATA(BT_DATA_NAME_COMPLETE, DEVICE_NAME, DEVICE_NAME_LEN),
		BT_DATA(BT_DATA_MANUFACTURER_DATA, (unsigned char *)custom_data, sizeof(custom_data_type))
	};
	int err = bt_le_adv_update_data(ad, ARRAY_SIZE(ad), ad, ARRAY_SIZE(ad));
	if (err) {
		LOG_ERR("Advertising failed to update (err %d)\n", err);
		return err;
	}

	return 0;
	
}

/**
 * TODO: Add function to stop the broadcaster --> shut down adv. socket
 */
