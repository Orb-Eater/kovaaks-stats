@echo off
setlocal EnableDelayedExpansion
title KovaaK's stats
cd /d "%~dp0"

call :log "start.bat launched"

echo.
echo   KovaaK's stats
echo   ----------------------------------------
echo.

if not exist "internal\server.py" (
  echo   [X] internal\server.py is missing.
  echo       Keep start.bat next to the internal folder it came with.
  echo.
  call :log "internal\server.py missing - aborting"
  pause
  exit /b 1
)

rem Find a working Python 3.7+. Each candidate is actually run before being
rem accepted, which also filters out the Microsoft Store placeholder that ships
rem on Windows and does nothing except open the Store.
set "PY="
set "VERCHECK=import sys; sys.exit(0 if sys.version_info>=(3,7) else 1)"

py -3 -c "%VERCHECK%" >nul 2>&1 && set "PY=py -3"
if defined PY (call :log "python detect (py -3): found") else (call :log "python detect (py -3): not usable")

if not defined PY (
  python -c "%VERCHECK%" >nul 2>&1 && set "PY=python"
  if defined PY (call :log "python detect (python): found") else (call :log "python detect (python): not usable")
)

if not defined PY (
  for %%P in (
    "%LOCALAPPDATA%\Programs\Python\Python313\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python312\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python311\python.exe"
    "%LOCALAPPDATA%\Programs\Python\Python310\python.exe"
    "%APPDATA%\Smoothie\bin\python.exe"
    "C:\Python313\python.exe"
    "C:\Python312\python.exe"
    "C:\Python311\python.exe"
    "C:\Python310\python.exe"
  ) do (
    if not defined PY if exist %%P (
      %%P -c "%VERCHECK%" >nul 2>&1 && set PY=%%P
    )
  )
  if defined PY (call :log "python detect (hardcoded paths): found") else (call :log "python detect (hardcoded paths): none usable")
)

rem Last resort: any Python3* install directory we can find.
if not defined PY (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*" "%ProgramFiles(x86)%\Python3*" "C:\Python3*") do (
    if not defined PY if exist "%%D\python.exe" (
      "%%D\python.exe" -c "%VERCHECK%" >nul 2>&1 && set PY="%%D\python.exe"
    )
  )
  if defined PY (call :log "python detect (directory scan): found") else (call :log "python detect (directory scan): nothing found")
)

if not defined PY (
  echo   [X] Could not find Python 3.7 or newer on this PC.
  echo.
  echo       Install it once from:  https://www.python.org/downloads/
  echo       On the first screen, tick "Add Python to PATH", then run this again.
  echo.
  echo       Nothing else is needed - no extra packages to install.
  echo.
  call :log "no usable python found - aborting"
  pause
  exit /b 1
)

call :log "using python: !PY!"

echo   Checking for updates...
!PY! internal\updater.py
call :log "updater.py exit code %ERRORLEVEL%"

echo   Starting the server. Your browser should open on its own.
echo   Leave this window open while you use the app.
echo   Press Ctrl+C (or close this window) to stop.
echo.

!PY! internal\server.py
set "CODE=%ERRORLEVEL%"
call :log "server.py exit code !CODE!"

echo.
if not "%CODE%"=="0" (
  echo   The server stopped with an error ^(code %CODE%^).
  echo   The messages above usually say why.
  echo.
  rem Only hold the window open when there is an error to read.
  pause
) else (
  echo   Server stopped.
)
exit /b %CODE%

:log
rem Appends a timestamped line to internal\logs\start.log. Created here rather
rem than relying on server.py to have made the folder first, since a broken
rem python/server.py run is exactly the case this needs to still capture.
set "LOGDIR=%~dp0internal\logs"
if not exist "%LOGDIR%" mkdir "%LOGDIR%" >nul 2>&1
>>"%LOGDIR%\start.log" echo %DATE% %TIME%  %~1
exit /b 0
