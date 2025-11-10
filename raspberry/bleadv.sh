#!/usr/bin/expect -f

# Check if the correct number of arguments is passed
if { $argc != 1 } {
    send_user "Usage: %s <manufacturer_data>\n" $argv0
    exit 1
}

# Get the manufacturer data from the command-line argument
set manufacturer_data [lindex $argv 0]

# Start bluetoothctl
spawn bluetoothctl

# Interact with bluetoothctl
expect "bluetooth" { send "power on\r" }
expect "bluetooth" { send "menu advertise\r" }

# Send the manufacturer data passed as an argument
expect "advertise" { send "manufacturer 0x0059 0x7$manufacturer_data\r" }

# Continue with the rest of the script
expect "advertise" { send "name LABCTRL\r" }
expect "advertise" { send "back\r" }
expect "bluetooth" { send "advertise on\r" }
expect "bluetooth" { send "menu advertise\r" }

# End the script
interact
