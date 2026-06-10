#!/usr/bin/env bash
# Pull run data from all (or selected) Raspberry Pis into results/raw/.
# SSH user and IP are resolved from ~/.ssh/config — no hardcoding needed.
#
# Usage:
#   ./scripts/pull_from_rpi.sh <folder> [pi1 pi2 ...]
#
#   <folder>     — folder inside ~/Finite-Time-Adaptive-Coordination/raspberry/
#                  on each Pi  (e.g. data-ring, data-clusters)
#   [pi1 pi2 …]  — optional subset; omit to pull from all 10
#
# Examples:
#   ./scripts/pull_from_rpi.sh data-ring
#   ./scripts/pull_from_rpi.sh data-ring pi3 pi7

set -euo pipefail

# ── Configuration ─────────────────────────────────────────────────────────────
PI_BASE_ROOT="~/Finite-Time-Adaptive-Coordination/raspberry"
ALL_PIS=(pi1 pi2 pi3 pi4 pi5 pi6 pi7 pi8 pi9 pi10)
SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=5"
# ─────────────────────────────────────────────────────────────────────────────

if [ $# -eq 0 ]; then
    echo "Usage: $0 <folder> [pi1 pi2 ...]" >&2
    echo "  e.g: $0 data-ring" >&2
    echo "  e.g: $0 data-ring pi3 pi7" >&2
    exit 1
fi

FOLDER="$1"
shift

REMOTE_PATH="${PI_BASE_ROOT}/${FOLDER}"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOCAL_DATA="$REPO_ROOT/results/raw"

# ── Target Pis ────────────────────────────────────────────────────────────────
if [ $# -eq 0 ]; then
    TARGETS=("${ALL_PIS[@]}")
else
    TARGETS=()
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

echo "Pulling '${FOLDER}' from: ${TARGETS[*]}"
echo ""

# ── Pull sequentially ─────────────────────────────────────────────────────────
failed=()

for pi in "${TARGETS[@]}"; do
    dst="$LOCAL_DATA/$pi/$FOLDER"

    if ! ssh $SSH_OPTS "$pi" "test -d ${REMOTE_PATH}" 2>/dev/null; then
        echo "[$pi] not reachable or path not found — skipping"
        continue
    fi

    mkdir -p "$dst"
    echo "[$pi] pulling..."
    rsync -az \
        -e "ssh $SSH_OPTS" \
        "${pi}:${REMOTE_PATH}/" \
        "$dst/"

    count=$(find "$dst" -name "*.json" 2>/dev/null | wc -l | tr -d ' ')
    echo "[$pi] done  ($count JSON files) → results/raw/$pi/$FOLDER/"
    echo ""
done

echo "Pull complete → $LOCAL_DATA/"
