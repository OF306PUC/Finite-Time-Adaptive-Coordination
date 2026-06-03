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

# Kill any existing session
tmux kill-session -t "$SESSION" 2>/dev/null || true

cd "$DIR"
# Single window split into 3 vertical panes
tmux new-session  -d -s "$SESSION" "node back.js ble;    echo '[ble stopped]';    read"
tmux split-window -t "$SESSION"    "node back.js wifi;   echo '[wifi stopped]';   read"
tmux split-window -t "$SESSION"    "node back.js bridge; echo '[bridge stopped]'; read"
tmux select-layout -t "$SESSION" even-vertical   # equal height panes
tmux attach-session -t "$SESSION"
