@echo off
REM Creates a Desktop shortcut that launches the Contracts App with one click.
REM Icon: a built-in Windows "document" icon from imageres.dll.
REM Re-run safely — overwrites the existing shortcut.

setlocal
set APP_NAME=Contracts App
set APP_DIR=%~dp0
if "%APP_DIR:~-1%"=="\" set APP_DIR=%APP_DIR:~0,-1%
set SHORTCUT_PATH=%USERPROFILE%\Desktop\%APP_NAME%.lnk
set TARGET_PATH=%APP_DIR%\launch-silent.vbs
set ICON_PATH=%SystemRoot%\System32\imageres.dll,68

powershell -NoProfile -Command "$s=(New-Object -ComObject WScript.Shell).CreateShortcut($env:SHORTCUT_PATH); $s.TargetPath=$env:TARGET_PATH; $s.WorkingDirectory=$env:APP_DIR; $s.IconLocation=$env:ICON_PATH; $s.Description='Open Contracts App in the browser'; $s.Save()"

if %ERRORLEVEL%==0 (
    echo.
    echo [OK] Shortcut created: %SHORTCUT_PATH%
    echo     Double-click the icon on your desktop to launch the app.
    echo.
) else (
    echo.
    echo [FAILED] Error code: %ERRORLEVEL%
    echo.
)
pause
