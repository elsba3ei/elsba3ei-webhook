@echo off
title 🌐 elsba3ei Webhook + Cloudflare Tunnel [Port 4000]
color 0e
cd /d "%~dp0"

:: Open Browser Dashboard
start "" "http://localhost:4000"

:: Run interactive Node.js server with tunnel (shows live logs in this CMD window, press 'q' to quit)
node server.js --tunnel

:: Cleanup any lingering child processes on exit
taskkill /f /im cloudflared.exe >nul 2>&1

