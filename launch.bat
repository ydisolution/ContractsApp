@echo off
REM Contracts App launcher
REM   - If the server is already running on :3100, just open the browser.
REM   - Otherwise, start the server in a minimised window and open the browser once it's up.

setlocal
set PORT=3100
set URL=http://localhost:%PORT%

REM Always run from the script's own folder
cd /d "%~dp0"

REM Is the server already listening on :3100?
netstat -ano -p tcp 2>nul | findstr ":%PORT% " | findstr LISTENING >nul
if %ERRORLEVEL%==0 (
    echo [Contracts App] Server already running — opening browser.
    start "" "%URL%"
    exit /b
)

echo [Contracts App] Starting server...
REM Launch the node process in its own minimised window so it keeps running
start "Contracts App" /MIN cmd /c "node server.js"

REM Wait for the port to actually start listening (max ~15s)
set /a WAIT=0
:waitloop
timeout /t 1 /nobreak >nul
netstat -ano -p tcp 2>nul | findstr ":%PORT% " | findstr LISTENING >nul
if %ERRORLEVEL%==0 goto ready
set /a WAIT+=1
if %WAIT% lss 15 goto waitloop
echo [Contracts App] Server did not come up within 15 seconds. Check the minimised window for errors.
pause
exit /b 1

:ready
echo [Contracts App] Ready. Opening %URL%
start "" "%URL%"
exit /b
