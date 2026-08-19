# elsba3ei Webhook & SSRF Inspector Launcher
Write-Host "========================================================" -ForegroundColor Cyan
Write-Host "  🎯 Starting elsba3ei Webhook & SSRF Inspector..." -ForegroundColor Green
Write-Host "========================================================" -ForegroundColor Cyan

Start-Process "http://localhost:4000"
node server.js
