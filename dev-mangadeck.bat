@echo off
cd /d "%~dp0"
echo Starting Suwayomi (Docker) and the Mangadeck dev server with live reload...
docker compose up -d suwayomi
if errorlevel 1 (
  echo.
  echo Docker failed to start Suwayomi. Is Docker Desktop running?
  pause
  exit /b 1
)
if not exist node_modules call npm install
start "" http://localhost:5173
npm run dev
