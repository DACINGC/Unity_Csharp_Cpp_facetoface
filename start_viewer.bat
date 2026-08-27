@echo off
rem ==================================================
rem  Interview Notes MD Viewer - launcher
rem  Double-click to start. Requires Python 3.
rem
rem  The service now runs as a detached background process:
rem  this window can be closed right away — closing it will
rem  NOT stop the notes service. Manage the service (status /
rem  restart / shutdown) from the power button in the page.
rem ==================================================
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto trypy
python mdviewer.py --daemon %*
if errorlevel 1 goto fail
goto started

:trypy
where py >nul 2>nul
if errorlevel 1 goto nopy
py -3 mdviewer.py --daemon %*
if errorlevel 1 goto fail
goto started

:nopy
echo [ERROR] Python 3 not found. Please install Python 3
echo and check "Add to PATH" during installation.
pause
exit /b 1

:fail
echo.
echo [ERROR] Failed to start the background service.
pause
exit /b 1

:started
echo.
echo The service is running in the background.
echo You can close this window — the service will keep running.
echo Use the power button (top-right of the page) to restart or stop it.
timeout /t 5 >nul
exit /b 0
