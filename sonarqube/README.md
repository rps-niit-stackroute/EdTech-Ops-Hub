# SonarQube Code Quality & Security Audit Setup

This folder contains a self-contained, containerized **SonarQube** environment and automated scanner tooling for performing static code analysis (SAST) on the **EdTech Ops Hub** repository.

---

## 🚀 Beginner Quick-Start Guide (Step-by-Step)

### Prerequisites
* **Docker & Docker Compose** installed and running on your computer.

---

### Step 1: Start the SonarQube Server Container
Open a terminal in the project root directory and run:
```bash
docker compose -f sonarqube/docker-compose.yml up -d
```
* This starts **SonarQube Community Edition** on port `9000` backed by a **PostgreSQL 15** database container.
* Wait ~30 to 45 seconds for SonarQube services to finish initializing.

---

### 🔑 Step 2: First-Time Login & Password Change (Important for Beginners!)

1. Open your browser and navigate to: 👉 **[http://localhost:9000](http://localhost:9000)**
2. Log in with the default credentials:
   * **Login**: `admin`
   * **Password**: `admin`
3. **Password Change Prompt**: SonarQube will immediately force you to set a new custom password (e.g. `Admin@123456` or your choice).

---

### Step 3: Run the Code Analysis Scanner

The provided runner script is smart and automatically handles authentication for you:

#### On macOS / Linux:
```bash
./sonarqube/run_scan.sh
```

#### On Windows (Command Prompt / PowerShell):
```cmd
.\sonarqube\run_scan.bat
```

#### 💡 How Authentication Works for Beginners:
* **Automatic Detection**: The script attempts to connect using your updated password.
* **Interactive Prompt**: If you changed your password from the default `admin` on first login, the terminal will prompt you to enter your updated password.
* **Environment Variable Override**: You can also pass your password or token directly:
  ```bash
  SONAR_PASSWORD="YourUpdatedPassword" ./sonarqube/run_scan.sh
  ```
* **User Token Option (Alternative)**:
  1. In SonarQube UI (`http://localhost:9000`), click your **User Avatar (Top Right)** -> **My Account** -> **Security**.
  2. Under **Generate Token**, enter name `my-token` and click **Generate**.
  3. Run:
     ```bash
     SONAR_TOKEN="squ_your_generated_token_here" ./sonarqube/run_scan.sh
     ```

---

### Step 4: View Your Code Audit Report
Once the scan finishes, refresh your browser at:
👉 **[http://localhost:9000/dashboard?id=EdTech-Ops-Hub](http://localhost:9000/dashboard?id=EdTech-Ops-Hub)**

You will see complete metrics for:
* 🐛 **Bugs & Reliability**
* 🔒 **Vulnerabilities & Security Risks**
* 🔥 **Security Hotspots (OWASP Top 10)**
* 🧹 **Code Smells & Maintainability Technical Debt**
* 📑 **Code Duplication Percentages**

---

### Step 5: Shutdown & Clean Up
When analysis is complete, stop the container stack:
```bash
docker compose -f sonarqube/docker-compose.yml down
```
*(To erase persistent SonarQube database volumes, add `-v`: `docker compose -f sonarqube/docker-compose.yml down -v`)*
