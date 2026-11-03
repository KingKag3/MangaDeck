@echo off
cd /d "%~dp0"
echo Starting Suwayomi + Mangadeck (first run builds the UI, give it a minute)...
docker compose up -d --build
if errorlevel 1 (
  echo.
  echo Docker failed to start the containers. Is Docker Desktop running?
  pause
  exit /b 1
)
start "" http://localhost:8080
echo.
echo Mangadeck:  http://localhost:8080
echo Suwayomi:   http://localhost:4567
pause
