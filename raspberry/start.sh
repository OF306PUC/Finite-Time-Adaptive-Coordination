#!/usr/bin/env bash
# Start all three backend processes in a tmux session.
# Run this from the VS Code SSH terminal on any Pi:
#
#   cd ~/Desktop/Finite-Time-Adaptive-Coordination/raspberry
#   ./start.sh
#
# Tmux controls once attached:
#   Ctrl+B  0   → ble window
#   Ctrl+B  1   → wifi window
#   Ctrl+B  2   → bridge window
#   Ctrl+B  d   → detach (processes keep running)
#   Ctrl+C      → kill process in current window

set -euo pipefail

# Ensure all scripts in this directory are executable
chmod +x "$(dirname "${BASH_SOURCE[0]}")"/*.sh

if ! command -v tmux &>/dev/null; then
    echo "tmux not found — installing..."
    sudo apt-get install -y --no-install-recommends tmux
fi

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="labctrl"
LOGS="$DIR/logs"
mkdir -p "$LOGS"

# Kill any existing session
tmux kill-session -t "$SESSION" 2>/dev/null || true

cd "$DIR"
# Single window split into 3 vertical panes, stdout+stderr tee'd to log files
tmux new-session  -d -s "$SESSION" "node back.js ble    |& tee $LOGS/ble.log;    echo '[ble stopped]';    read"
tmux split-window -t "$SESSION"    "node back.js wifi   |& tee $LOGS/wifi.log;   echo '[wifi stopped]';   read"
tmux split-window -t "$SESSION"    "node back.js bridge |& tee $LOGS/bridge.log; echo '[bridge stopped]'; read"
tmux select-layout -t "$SESSION" even-vertical
tmux attach-session -t "$SESSION"
