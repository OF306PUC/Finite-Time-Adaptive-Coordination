#!/usr/bin/env bash
# Query pm2 status on every Pi.
# Usage: ./scripts/status.sh

set -euo pipefail

SSH_USER="pi"
SSH_KEY="$HOME/.ssh/id_rsa"

ALL_IPS=(
    "192.168.0.136"
    "192.168.0.168"
    "192.168.0.134"
    "192.168.0.191"
    "192.168.0.166"
    "192.168.0.130"
    "192.168.0.126"
    "192.168.0.122"
    "192.168.0.146"
    "192.168.0.135"
)

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5"

for ip in "${ALL_IPS[@]}"; do
    echo "────────────────── $ip ──────────────────"
    ssh $SSH_OPTS "$SSH_USER@$ip" "pm2 list --no-color 2>/dev/null || echo 'pm2 not running'" &
done
wait
