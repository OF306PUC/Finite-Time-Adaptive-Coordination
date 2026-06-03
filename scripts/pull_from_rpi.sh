#!/usr/bin/env bash
# Pull organized CSV data from all Raspberry Pis into data/{pi1..pi10}/.
# SSH user and IP are resolved from ~/.ssh/config — no hardcoding needed.
#
# Usage:
#   ./scripts/pull_from_rpi.sh <topology> [pi1 pi2 ...]
#
#   <topology>   — experiment folder name on the Pi (e.g. 30nodes-dring)
#   [pi1 pi2 …]  — optional subset of Pis; omit to pull from all 10
#
# Examples:
#   ./scripts/pull_from_rpi.sh 30nodes-dring
#   ./scripts/pull_from_rpi.sh 18nodes-ring pi3 pi7
#
# Output:
#   data/pi1/<topology>/{ble,wifi,bridge}/
#   data/pi2/<topology>/{ble,wifi,bridge}/
#   ...

set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────────────
PI_BASE_ROOT="~/Finite-Time-Adaptive-Coordination/scripts"
ALL_PIS=(pi1 pi2 pi3 pi4 pi5 pi6 pi7 pi8 pi9 pi10)
# ───────────────────────────────────────────────────────────────────────────────

if [ $# -eq 0 ]; then
    echo "Usage: $0 <topology> [pi1 pi2 ...]" >&2
    echo "  e.g: $0 30nodes-dring" >&2
    echo "  e.g: $0 18nodes-ring pi3 pi7" >&2
    exit 1
fi

TOPOLOGY="$1"
shift

PI_BASE="${PI_BASE_ROOT}/${TOPOLOGY}"

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DATA="$REPO_ROOT/experimental_analysis"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5"

# ── Argument parsing ───────────────────────────────────────────────────────────
declare -a TARGETS

if [ $# -eq 0 ]; then
    TARGETS=("${ALL_PIS[@]}")
else
    for arg in "$@"; do
        valid=0
        for pi in "${ALL_PIS[@]}"; do [ "$arg" == "$pi" ] && valid=1 && break; done
        if [ "$valid" -eq 0 ]; then
            echo "Error: '$arg' unknown. Valid: ${ALL_PIS[*]}" >&2
            exit 1
        fi
        TARGETS+=("$arg")
    done
fi

# ── Per-Pi pull ────────────────────────────────────────────────────────────────
pull_pi() {
    local name=$1
    local dst="$LOCAL_DATA/$name/$TOPOLOGY"
    local tag="[$name]"

    # Check if remote path exists (uses ~/.ssh/config for user+host resolution)
    if ! ssh $SSH_OPTS "$name" "test -d ${PI_BASE}" 2>/dev/null; then
        echo "$tag remote path not found — skipping"
        return 0
    fi

    mkdir -p "$dst"
    echo "$tag pulling..."
    rsync -az \
        -e "ssh $SSH_OPTS" \
        "${name}:${PI_BASE}/" \
        "$dst/"

    count=$(find "$dst" -name "*.csv" 2>/dev/null | wc -l | tr -d ' ')
    echo "$tag done  ($count CSV files) → data/$name/$TOPOLOGY/"
}

# ── Launch in parallel ─────────────────────────────────────────────────────────
echo "Pulling from: ${TARGETS[*]}"
echo ""

declare -A pids
for name in "${TARGETS[@]}"; do
    pull_pi "$name" &
    pids["$name"]=$!
done

# ── Collect results ────────────────────────────────────────────────────────────
failed=()
for name in "${!pids[@]}"; do
    if ! wait "${pids[$name]}"; then
        failed+=("$name")
    fi
done

echo ""
if [ ${#failed[@]} -gt 0 ]; then
    echo "FAILED: ${failed[*]}"
    exit 1
fi
echo "Pull complete → $LOCAL_DATA/"
