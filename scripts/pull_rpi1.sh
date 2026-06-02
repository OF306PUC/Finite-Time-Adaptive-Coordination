#!/usr/bin/env bash
# Pull organized CSV data from rpi1 into test/30nodes-dring/ locally.
#
# Usage:
#   ./scripts/pull_rpi1.sh            # pull all available network types
#   ./scripts/pull_rpi1.sh ble        # pull a single network type
#   ./scripts/pull_rpi1.sh ble wifi   # pull specific types
#
# Output mirrors the Pi layout:
#   test/30nodes-dring/{ble,wifi,bridge}/30nodes-dring_run{NN}-{type}.csv

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
SSH_USER="plant123"
SSH_HOST="192.168.0.190"
PI_BASE="~/Desktop/Finite-Time-Adaptive-Coordination/python-sims/30nodes-dring"
TOPOLOGY="30nodes-dring"
NET_TYPES=("ble" "wifi" "bridge")
# ───────────────────────────────────────────────────────────────────────────────

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_BASE="$REPO_ROOT/test/$TOPOLOGY"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5"

# Use specific network type(s) if passed as arguments, otherwise pull all
if [ $# -gt 0 ]; then
    TARGETS=("$@")
else
    TARGETS=("${NET_TYPES[@]}")
fi

# Validate requested types
for t in "${TARGETS[@]}"; do
    valid=0
    for nt in "${NET_TYPES[@]}"; do
        [ "$t" == "$nt" ] && valid=1 && break
    done
    if [ "$valid" -eq 0 ]; then
        echo "Error: '$t' is not a valid network type. Choose from: ${NET_TYPES[*]}" >&2
        exit 1
    fi
done

mkdir -p "$LOCAL_BASE"
echo "Pulling from ${SSH_USER}@${SSH_HOST}:${PI_BASE}/"
echo "Targets: ${TARGETS[*]}"
echo ""

# ── Pull: one rsync per requested type, skip gracefully if remote dir absent ──
for net in "${TARGETS[@]}"; do
    echo "[$net] checking remote..."

    # Test whether the remote directory exists before rsyncing
    if ! ssh $SSH_OPTS "${SSH_USER}@${SSH_HOST}" "test -d ${PI_BASE}/${net}"; then
        echo "[$net] not found on Pi — skipping"
        continue
    fi

    mkdir -p "$LOCAL_BASE/$net"
    echo "[$net] pulling..."
    rsync -az --progress \
        -e "ssh $SSH_OPTS" \
        "${SSH_USER}@${SSH_HOST}:${PI_BASE}/${net}/" \
        "$LOCAL_BASE/$net/"

    count=$(find "$LOCAL_BASE/$net" -name "*.csv" 2>/dev/null | wc -l | tr -d ' ')
    echo "[$net] done  ($count CSV files) → test/$TOPOLOGY/$net/"
done

echo ""
echo "Pull complete → test/$TOPOLOGY/"
