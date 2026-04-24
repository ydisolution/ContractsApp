@echo off
REM Registers .contract.json files so double-click opens them in Contracts-App.
REM
REM Per-user install (HKCU) — no admin needed. Run once.
REM First double-click Windows will prompt to pick an app → choose "WA Contract Draft".

setlocal
set APP_URL=http://localhost:3100

reg add "HKCU\Software\Classes\.contract.json" /ve /d "WAContract" /f >nul
reg add "HKCU\Software\Classes\WAContract" /ve /d "WA Contract Draft" /f >nul
reg add "HKCU\Software\Classes\WAContract\shell" /ve /d "open" /f >nul
reg add "HKCU\Software\Classes\WAContract\shell\open\command" /ve /d "cmd /c start %APP_URL%/?openDraft=\"%%1\"" /f >nul

echo.
echo [OK] .contract.json files are now associated with Contracts-App.
echo     Double-click any such file in Explorer and the app will open on it.
echo.
pause
