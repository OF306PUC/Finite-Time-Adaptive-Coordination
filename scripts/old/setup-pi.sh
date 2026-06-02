#!/usr/bin/env bash
# One-time setup for each Raspberry Pi.
#
# Run remotely from your laptop for every Pi:
#   for ip in 192.168.0.136 192.168.0.168 ...; do
#       ssh pi@$ip 'bash -s' < scripts/setup-pi.sh
#   done
#
# Or run directly on the Pi:
#   bash setup-pi.sh

set -euo pipefail

PI_DEST="$HOME/Finite-Time-Adaptive-Coordination/raspberry"

echo "=== [1/5] System packages ==="
sudo apt-get update -qq
sudo apt-get install -y --no-install-recommends expect bluez

# serial port access (for /dev/ttyACM0 — Nordic nRF52840)
sudo usermod -aG dialout "$USER"
# bluetooth socket access (for bluetoothctl / BlueZ D-Bus)
sudo usermod -aG bluetooth "$USER"

echo "=== [2/5] Node.js dependencies ==="
cd "$PI_DEST"
npm install --omit=dev

echo "=== [3/5] Permissions ==="
chmod +x "$PI_DEST/bleadv.sh"
mkdir -p "$PI_DEST/logs"
mkdir -p "$PI_DEST/data"

echo "=== [4/5] pm2 ==="
npm install -g pm2

pm2 start "$PI_DEST/ecosystem.config.js" 2>/dev/null || true
pm2 save

echo "=== [5/5] pm2 boot hook ==="
# pm2 prints a sudo command that must be run once to enable startup on reboot.
# Copy-paste and run the line it prints below.
pm2 startup systemd -u "$USER" --hp "$HOME"

echo ""
echo ">>> Copy and run the 'sudo env PATH=...' command printed above <<<"
echo ">>> Then reboot and verify with: pm2 list                       <<<"
