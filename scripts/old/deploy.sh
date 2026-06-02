#!/usr/bin/env bash
# Deploy raspberry/ to all 10 Raspberry Pis in parallel.
#
# Prerequisites (one-time):
#   1. SSH key copied to each Pi:  ssh-copy-id -i ~/.ssh/id_rsa pi@<ip>
#   2. One-time Pi setup already done via setup-pi.sh
#
# Usage:
#   ./scripts/deploy.sh              # deploy to all Pis
#   ./scripts/deploy.sh 192.168.0.136  # deploy to a single Pi

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
SSH_USER="pi"
SSH_KEY="$HOME/.ssh/id_rsa"
PI_DEST="~/Finite-Time-Adaptive-Coordination/raspberry"

# All 10 physical nodes (unique IPs from net.js)
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
# ───────────────────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SRC="$REPO_ROOT/raspberry/"

SSH_OPTS="-i $SSH_KEY -o StrictHostKeyChecking=no -o ConnectTimeout=5"

# Use a specific IP if passed as argument, otherwise deploy to all
if [ $# -eq 1 ]; then
    TARGETS=("$1")
else
    TARGETS=("${ALL_IPS[@]}")
fi

# ── Per-node deploy function (runs in background) ──────────────────────────────
deploy_pi() {
    local ip=$1
    local log_prefix="[deploy $ip]"

    echo "$log_prefix syncing files..."
    rsync -az --delete \
        --exclude='node_modules/' \
        --exclude='package-lock.json' \
        --exclude='data/' \
        --exclude='logs/' \
        -e "ssh $SSH_OPTS" \
        "$SRC" "$SSH_USER@$ip:$PI_DEST"

    echo "$log_prefix installing dependencies..."
    # shellcheck disable=SC2029
    ssh $SSH_OPTS "$SSH_USER@$ip" \
        "cd $PI_DEST && npm install --omit=dev --silent"

    echo "$log_prefix reloading pm2 processes..."
    # 'reload' does a zero-downtime restart; falls back to 'start' if not yet registered
    # shellcheck disable=SC2029
    ssh $SSH_OPTS "$SSH_USER@$ip" \
        "cd $PI_DEST && pm2 reload ecosystem.config.js --update-env || pm2 start ecosystem.config.js"

    echo "$log_prefix done."
}

# ── Launch all in parallel ─────────────────────────────────────────────────────
declare -A pids
for ip in "${TARGETS[@]}"; do
    deploy_pi "$ip" &
    pids["$ip"]=$!
done

# ── Collect results ────────────────────────────────────────────────────────────
failed=()
for ip in "${!pids[@]}"; do
    if ! wait "${pids[$ip]}"; then
        failed+=("$ip")
    fi
done

echo ""
if [ ${#failed[@]} -gt 0 ]; then
    echo "FAILED on: ${failed[*]}"
    exit 1
fi
echo "All ${#TARGETS[@]} node(s) deployed successfully."
