@echo off
REM Sync your current work to the LabPaaS-deployed server branch (publish-to-server).
REM Double-click this, or run it from cmd/PowerShell. Pass --continue as an
REM argument to resume after manually resolving a merge conflict.
setlocal
cd /d "%~dp0.."

REM Check Git Bash's known install locations first -- a plain "where bash" can
REM resolve to the WSL launcher stub instead (C:\Windows\System32\bash.exe),
REM which fails if no WSL distribution is installed.
if exist "C:\Program Files\Git\bin\bash.exe" (
    set "BASH_EXE=C:\Program Files\Git\bin\bash.exe"
) else if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" (
    set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"
) else if exist "%LocalAppData%\Programs\Git\bin\bash.exe" (
    set "BASH_EXE=%LocalAppData%\Programs\Git\bin\bash.exe"
) else (
    echo Could not find Git Bash. Install Git for Windows or adjust this script.
    pause
    exit /b 1
)

"%BASH_EXE%" scripts/sync-to-server.sh %*
set "EXIT_CODE=%errorlevel%"

echo.
pause
exit /b %EXIT_CODE%
