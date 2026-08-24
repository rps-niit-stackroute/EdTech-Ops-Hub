#!/bin/bash
# =====================================================================
# SonarQube Scanner Docker Runner for EdTech Ops Hub (macOS / Linux)
# =====================================================================

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

SONAR_URL="${SONAR_URL:-http://host.docker.internal:9000}"
SONAR_LOCAL_URL="${SONAR_LOCAL_URL:-http://localhost:9000}"
SONAR_LOGIN="${SONAR_LOGIN:-a1b2c3d4e5@07A}"

echo "================================================================="
echo " Starting SonarQube Static Code Analysis for EdTech Ops Hub"
echo "================================================================="
echo " Project Directory : $PROJECT_ROOT"
echo " Target Sonar Server: $SONAR_LOCAL_URL"
echo "================================================================="

# Function to attempt token generation via API
try_generate_token() {
    local user="$1"
    local pass="$2"
    local token_name="auto-scanner-$(date +%s)"
    
    local resp=$(curl -s -X POST -u "${user}:${pass}" "$SONAR_LOCAL_URL/api/user_tokens/generate?name=$token_name" 2>/dev/null || true)
    local token=$(echo "$resp" | python3 -c "import sys, json; print(json.load(sys.stdin).get('token', ''))" 2>/dev/null || true)
    echo "$token"
}

# Automatic Token Resolution
if [ -z "$SONAR_TOKEN" ]; then
    echo "🔑 Obtaining analysis authentication token from SonarQube API..."
    
    # 1. Try default password 'admin'
    SONAR_TOKEN=$(try_generate_token "$SONAR_LOGIN" "admin")
    
    # 2. Try configured SONAR_PASSWORD env var or common setup password
    if [ -z "$SONAR_TOKEN" ] && [ -n "$SONAR_PASSWORD" ]; then
        SONAR_TOKEN=$(try_generate_token "$SONAR_LOGIN" "$SONAR_PASSWORD")
    fi
    if [ -z "$SONAR_TOKEN" ]; then
        SONAR_TOKEN=$(try_generate_token "$SONAR_LOGIN" "a1b2c3d4e5@07A")
    fi

    # 3. Interactive prompt if running in interactive terminal
    if [ -z "$SONAR_TOKEN" ] && [ -t 0 ]; then
        echo ""
        echo "⚠️  SonarQube password was changed on first login."
        read -sp "👉 Enter your new SonarQube password for user 'admin': " INPUT_PASS
        echo ""
        if [ -n "$INPUT_PASS" ]; then
            SONAR_TOKEN=$(try_generate_token "$SONAR_LOGIN" "$INPUT_PASS")
        fi
    fi

    if [ -n "$SONAR_TOKEN" ]; then
        echo "✅ Analysis authentication token obtained successfully."
    else
        echo ""
        echo "❌ Authentication failed. First-time SonarQube login requires password change."
        echo "💡 Solutions for Beginners:"
        echo "   1) Pass your updated password:  SONAR_PASSWORD=\"YourNewPassword\" ./sonarqube/run_scan.sh"
        echo "   2) Pass a User Token from UI:   SONAR_TOKEN=\"squ_your_token\" ./sonarqube/run_scan.sh"
        echo "   (To generate a token: http://localhost:9000 -> My Account -> Security -> Generate Token)"
        exit 1
    fi
fi

# Execute SonarScanner official Docker container
docker run --rm \
    --add-host=host.docker.internal:host-gateway \
    -v "$PROJECT_ROOT:/usr/src" \
    sonarsource/sonar-scanner-cli \
    -Dsonar.host.url="http://localhost:9000" \
    -Dsonar.token="sqp_27b8a04a4c828dee82d0bf0c5ebe884da430e6f4" \
    -Dsonar.projectKey="EdTech-Ops-Hub" \
    -Dsonar.projectName="EdTech Ops Hub" \
    -Dsonar.sources="/usr/src/backend,/usr/src/frontend/src" \
    -Dsonar.tests="/usr/src/backend/tests" \
    -Dsonar.exclusions="**/node_modules/**,**/build/**,**/dist/**,**/__pycache__/**,**/venv/**,**/docs/**,**/*.pdf,backend/tests/**"

echo ""
echo "================================================================="
echo " ✅ Analysis Completed Successfully!"
echo " 📊 Access Dashboard: http://localhost:9000"
echo "================================================================="
