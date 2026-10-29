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
echo === NoExcuse site (date reale, Supabase) ===
where node >nul 2>nul || (echo Node.js nu este instalat. Instaleaza versiunea LTS de pe https://nodejs.org si ruleaza din nou. & pause & exit /b 1)
if not exist "node_modules\.bin\expo.cmd" (
  echo Instalez dependintele. Dureaza 2-5 minute, nu inchide fereastra...
  if exist node_modules rd /s /q node_modules
  call npm install --no-audit --no-fund > setup-log.txt 2>&1
  if not exist "node_modules\.bin\expo.cmd" (
    echo.
    echo Instalarea a esuat. Detaliile sunt in setup-log.txt. Spune-i lui Claude.
    pause
    exit /b 1
  )
)
if not exist "node_modules\@expo-google-fonts\bodoni-moda" (
  echo Actualizez dependintele (o singura data)...
  call npm install --no-audit --no-fund > setup-log.txt 2>&1
)
rem Valori publice ale proiectului Supabase "noexcuse" (sigure in aplicatie; secretele stau doar pe server).
set EXPO_PUBLIC_DEMO=0
set EXPO_PUBLIC_SUPABASE_URL=https://ibsrtuyrflvprmjuuoqb.supabase.co
set EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imlic3J0dXlyZmx2cHJtanV1b3FiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTMxNzc3OTYsImV4cCI6MjEwODc1Mzc5Nn0.W-qQ0pGJXTsaM0DZhYkaU_tT6nBEzI894lqW8XYZwdo
echo Pornesc NoExcuse. Se deschide in browser la http://localhost:8081
call node_modules\.bin\expo.cmd start --web --clear --port 8081
echo.
echo Serverul s-a oprit. Fa o captura a acestei ferestre si trimite-o lui Claude.
pause
