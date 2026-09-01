@echo off
setlocal EnableDelayedExpansion
title KovaaK's stats
cd /d "%~dp0"

echo.
echo   KovaaK's stats
echo   ----------------------------------------
echo.

if not exist "server.py" (
  echo   [X] server.py is missing.
  echo       Keep start.bat in the same folder as server.py and the app folder.
  echo.
  pause
  exit /b 1
)

rem Find a working Python 3.7+. Each candidate is actually run before being
rem accepted, which also filters out the Microsoft Store placeholder that ships
rem on Windows and does nothing except open the Store.
set "PY="
set "VERCHECK=import sys; sys.exit(0 if sys.version_info>=(3,7) else 1)"

py -3 -c "%VERCHECK%" >nul 2>&1 && set "PY=py -3"

if not defined PY (
  python -c "%VERCHECK%" >nul 2>&1 && set "PY=python"
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
)

rem Last resort: any Python3* install directory we can find.
if not defined PY (
  for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*" "%ProgramFiles%\Python3*" "%ProgramFiles(x86)%\Python3*" "C:\Python3*") do (
    if not defined PY if exist "%%D\python.exe" (
      "%%D\python.exe" -c "%VERCHECK%" >nul 2>&1 && set PY="%%D\python.exe"
    )
  )
)

if not defined PY (
  echo   [X] Could not find Python 3.7 or newer on this PC.
  echo.
  echo       Install it once from:  https://www.python.org/downloads/
  echo       On the first screen, tick "Add Python to PATH", then run this again.
  echo.
  echo       Nothing else is needed - no extra packages to install.
  echo.
  pause
  exit /b 1
)

echo   Starting the server. Your browser should open on its own.
echo   Leave this window open while you use the app.
echo   Press Ctrl+C (or close this window) to stop.
echo.

!PY! server.py
set "CODE=%ERRORLEVEL%"

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
