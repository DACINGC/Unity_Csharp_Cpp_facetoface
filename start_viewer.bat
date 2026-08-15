@echo off
rem ==================================================
rem  Interview Notes MD Viewer - launcher
rem  Double-click to start. Requires Python 3.
rem ==================================================
chcp 65001 >nul
cd /d "%~dp0"

where python >nul 2>nul
if errorlevel 1 goto trypy
python mdviewer.py %*
goto end

:trypy
where py >nul 2>nul
if errorlevel 1 goto nopy
py -3 mdviewer.py %*
goto end

:nopy
echo [ERROR] Python 3 not found. Please install Python 3
echo and check "Add to PATH" during installation.
pause
exit /b 1

:end
pause
