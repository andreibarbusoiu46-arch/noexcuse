@echo off
setlocal
cd /d "%~dp0"
rem Cache-ul npm si fisierele temporare stau pe acelasi disc cu proiectul (nu umplem C:).
set "CACHEROOT=%~d0\noexcuse-cache"
if exist "D:\" set "CACHEROOT=D:\noexcuse-cache"
set "npm_config_cache=%CACHEROOT%\npm"
set "TEMP=%CACHEROOT%\tmp"
set "TMP=%CACHEROOT%\tmp"
echo Spatiu liber pe discuri (GB):
powershell -NoProfile -Command "Get-PSDrive -PSProvider FileSystem | Where-Object {$_.Free -ne $null} | ForEach-Object { '  ' + $_.Name + ': ' + [math]::Round($_.Free/1GB,1) + ' GB liberi' }"
echo Cache si fisiere temporare: %CACHEROOT%
if not exist "%TEMP%" mkdir "%TEMP%"
echo === NoExcuse demo ===
where node >nul 2>nul || (echo Node.js nu este instalat. Instaleaza versiunea LTS de pe https://nodejs.org si ruleaza din nou. & pause & exit /b 1)
node -v > setup-log.txt 2>&1
call npm -v >> setup-log.txt 2>&1
if not exist "node_modules\.bin\expo.cmd" (
  echo Instalez dependintele. Dureaza 2-5 minute, nu inchide fereastra...
  if exist node_modules rd /s /q node_modules
  call npm install --no-audit --no-fund >> setup-log.txt 2>&1
  if not exist "node_modules\.bin\expo.cmd" (
    echo.
    echo Instalarea a esuat. Detaliile sunt in setup-log.txt. Spune-i lui Claude.
    pause
    exit /b 1
  )
)
set EXPO_PUBLIC_DEMO=1
echo Pornesc NoExcuse in modul demo. Se deschide in browser la http://localhost:8081
call node_modules\.bin\expo.cmd start --web --clear
echo.
echo Serverul s-a oprit. Fa o captura a acestei ferestre si trimite-o lui Claude.
pause
