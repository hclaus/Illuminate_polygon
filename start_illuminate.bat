@echo off
title Illuminate Local (Polygon Support)
echo ===================================================
echo        ILLUMINATE LOCAL - POLYGON FOOTPRINT SUPPORT                     
echo ===================================================
echo.

:: Refresh PATH from registry to pick up newly installed node/pnpm/uv
for /f "tokens=2*" %%A in ('reg query "HKLM\System\CurrentControlSet\Control\Session Manager\Environment" /v Path 2^>nul') do set "SYS_PATH=%%B"
for /f "tokens=2*" %%A in ('reg query "HKCU\Environment" /v Path 2^>nul') do set "USER_PATH=%%B"
set "PATH=%SYS_PATH%;%USER_PATH%;%PATH%"

:: Ensure user Python scripts directory is in PATH for uv
set "PATH=%APPDATA%\Python\Python312\Scripts;%APPDATA%\Python\Python313\Scripts;%APPDATA%\Python\Scripts;%PATH%"

echo Starting backend API server...
start "Illuminate Backend" /min cmd /c "cd /d %~dp0api && python -m uv run uvicorn app.main:app --reload --port 8000"

echo Starting frontend UI server...
start "Illuminate Frontend" /min cmd /c "cd /d %~dp0ui && pnpm dev"

echo Waiting for servers to initialize (5 seconds)...
timeout /t 5 /nobreak >nul

echo Opening browser at http://localhost:5173...
start http://localhost:5173

echo.
echo Illuminate Local is now running!
echo.
echo To stop the servers:
echo 1. Close the "Illuminate Backend" and "Illuminate Frontend" windows
echo    (you can find them minimized in your taskbar).
echo 2. Press any key in this window to exit.
echo.
pause
