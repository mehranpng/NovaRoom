#!/usr/bin/env bash

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$PROJECT_ROOT"

GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${BLUE}==============================================${NC}"
echo -e "${BLUE}       NovaRoom Development Server Launcher   ${NC}"
echo -e "${BLUE}==============================================${NC}"

if [ ! -f "$PROJECT_ROOT/.env" ]; then
    echo -e "${RED}[!] Error: .env file not found in root directory.${NC}"
    exit 1
fi

cleanup() {
    echo -e "\n${YELLOW}[*] Shutting down NovaRoom dev servers...${NC}"
    if [ -n "$BACKEND_PID" ]; then
        kill "$BACKEND_PID" 2>/dev/null || true
    fi
    if [ -n "$FRONTEND_PID" ]; then
        kill "$FRONTEND_PID" 2>/dev/null || true
    fi
    wait "$BACKEND_PID" 2>/dev/null || true
    wait "$FRONTEND_PID" 2>/dev/null || true
    echo -e "${GREEN}[✓] Dev servers stopped successfully.${NC}"
    exit 0
}

trap cleanup INT TERM

echo -e "\n${GREEN}[1/2] Starting Backend (FastAPI)...${NC}"
cd "$PROJECT_ROOT/back-end"

if [ ! -d ".venv" ]; then
    echo -e "${YELLOW}[*] Creating Python virtual environment in back-end/.venv...${NC}"
    python3 -m venv .venv
fi

if [ ! -f ".venv/.installed_requirements" ] || [ "requirements.txt" -nt ".venv/.installed_requirements" ]; then
    echo -e "${YELLOW}[*] Installing/updating backend dependencies...${NC}"
    .venv/bin/pip install -r requirements.txt
    touch .venv/.installed_requirements
fi

.venv/bin/python3 -m uvicorn api:app --reload --host 0.0.0.0 --port 8000 &
BACKEND_PID=$!

echo -n "[*] Waiting for backend startup to complete..."
while ! curl -s http://127.0.0.1:8000/health >/dev/null 2>&1; do
    sleep 0.5
    echo -n "."
done
echo -e " ${GREEN}[Ready]${NC}"
echo -e "${GREEN}[✓] Backend running at http://localhost:8000 (PID: $BACKEND_PID)${NC}"

echo -e "\n${GREEN}[2/2] Starting Frontend (Vite)...${NC}"
cd "$PROJECT_ROOT/front-end"

if [ ! -d "node_modules" ] || [ ! -f "node_modules/.installed_packages" ] || [ "package.json" -nt "node_modules/.installed_packages" ]; then
    echo -e "${YELLOW}[*] Installing/updating frontend npm dependencies...${NC}"
    npm install
    touch node_modules/.installed_packages
fi

npm run dev &
FRONTEND_PID=$!
echo -e "${GREEN}[✓] Frontend starting with Vite (PID: $FRONTEND_PID)${NC}"

echo -e "\n${BLUE}==============================================${NC}"
echo -e "${GREEN} NovaRoom is running in development mode!${NC}"
echo -e " - Frontend: ${BLUE}http://localhost:5173${NC}"
echo -e " - Backend API: ${BLUE}http://localhost:8000${NC}"
echo -e " - Press ${YELLOW}Ctrl+C${NC} to stop both servers."
echo -e "${BLUE}==============================================\n${NC}"

wait
