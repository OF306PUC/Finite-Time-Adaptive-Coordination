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

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SESSION="labctrl"

# Kill any existing session
tmux kill-session -t "$SESSION" 2>/dev/null || true

cd "$DIR"
tmux new-session -d -s "$SESSION" -n ble    "node back.js ble;    echo '[ble stopped] press enter'; read"
tmux new-window     -t "$SESSION" -n wifi   "node back.js wifi;   echo '[wifi stopped] press enter'; read"
tmux new-window     -t "$SESSION" -n bridge "node back.js bridge; echo '[bridge stopped] press enter'; read"
tmux select-window  -t "$SESSION:ble"
tmux attach-session -t "$SESSION"
