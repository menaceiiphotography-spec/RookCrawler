#!/data/data/com.termux/files/usr/bin/bash
cd "$(dirname "$0")" || exit 1

if ! command -v node >/dev/null 2>&1; then
    echo "[SETUP] Installing Node.js via pkg..."
    pkg install -y nodejs || { echo "[ERROR] Failed to install nodejs."; exit 1; }
fi
if [ ! -d "node_modules" ]; then
    echo "Installing packages..."
    npm install || { echo "[ERROR] npm install failed."; exit 1; }
fi
echo "Starting Rook Crawler...  Open http://localhost:8010 in your browser."
npm start
