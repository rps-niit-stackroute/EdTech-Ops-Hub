@echo off
REM =====================================================================
REM SonarQube Scanner Docker Runner for EdTech Ops Hub (Windows)
REM =====================================================================

set "PROJECT_ROOT=%~dp0.."
set "SONAR_HOST_URL=http://host.docker.internal:9000"
set "SONAR_LOCAL_URL=http://localhost:9000"
set "SONAR_LOGIN=admin"

echo =================================================================
echo  Starting SonarQube Static Code Analysis for EdTech Ops Hub
echo =================================================================
echo  Project Directory : %PROJECT_ROOT%
echo  Target Sonar Server: %SONAR_LOCAL_URL%
echo =================================================================

IF "%SONAR_TOKEN%"=="" (
    echo 🔑 Obtaining authentication token from SonarQube API...
    
    IF NOT "%SONAR_PASSWORD%"=="" (
        FOR /F "tokens=*" %%g IN ('curl -s -X POST -u %SONAR_LOGIN%:%SONAR_PASSWORD% "%SONAR_LOCAL_URL%/api/user_tokens/generate?name=win-auto-token" ^| findstr /C:"token"') DO set "SONAR_TOKEN=%%g"
    )
    IF "%SONAR_TOKEN%"=="" (
        FOR /F "tokens=*" %%g IN ('curl -s -X POST -u %SONAR_LOGIN%:Admin@123456 "%SONAR_LOCAL_URL%/api/user_tokens/generate?name=win-auto-token" ^| findstr /C:"token"') DO set "SONAR_TOKEN=%%g"
    )
    IF "%SONAR_TOKEN%"=="" (
        FOR /F "tokens=*" %%g IN ('curl -s -X POST -u %SONAR_LOGIN%:admin "%SONAR_LOCAL_URL%/api/user_tokens/generate?name=win-auto-token" ^| findstr /C:"token"') DO set "SONAR_TOKEN=%%g"
    )
)

IF "%SONAR_TOKEN%"=="" (
    echo.
    echo ⚠️ SonarQube default admin password was changed on first login.
    set /p "SONAR_PASSWORD=👉 Enter your updated SonarQube admin password: "
    FOR /F "tokens=*" %%g IN ('curl -s -X POST -u %SONAR_LOGIN%:%SONAR_PASSWORD% "%SONAR_LOCAL_URL%/api/user_tokens/generate?name=win-auto-token" ^| findstr /C:"token"') DO set "SONAR_TOKEN=%%g"
)

IF "%SONAR_TOKEN%"=="" (
    echo ❌ Authentication failed. Please pass your User Token or Password.
    echo    Example: set SONAR_PASSWORD=YourPassword && .\sonarqube\run_scan.bat
    pause
    exit /b 1
)

docker run --rm ^
    --add-host=host.docker.internal:host-gateway ^
    -v "%PROJECT_ROOT%:/usr/src" ^
    sonarsource/sonar-scanner-cli ^
    -Dsonar.host.url="%SONAR_HOST_URL%" ^
    -Dsonar.token="%SONAR_TOKEN%" ^
    -Dsonar.projectKey="EdTech-Ops-Hub" ^
    -Dsonar.projectName="EdTech Ops Hub" ^
    -Dsonar.sources="/usr/src/backend,/usr/src/frontend/src" ^
    -Dsonar.tests="/usr/src/backend/tests" ^
    -Dsonar.exclusions="**/node_modules/**,**/build/**,**/dist/**,**/__pycache__/**,**/venv/**,**/docs/**,**/*.pdf,backend/tests/**"

echo.
echo =================================================================
echo  Analysis Completed Successfully!
echo  Access Dashboard: http://localhost:9000
echo =================================================================
pause
