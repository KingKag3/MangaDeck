@echo off
rem Opens Mangadeck in its own app window (no tabs or address bar) using Edge or Chrome.
rem Change the address if you run it somewhere else.
set URL=http://localhost:8080
start "" msedge --app=%URL% 2>nul || start "" chrome --app=%URL%
