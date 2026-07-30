# Earthlink agents — deploy on every OS

Run a **hub** (globe UI + collector) on one machine, then run **edge agents** on
Linux, macOS, and/or Windows. Each agent pushes that host’s live sockets to the hub.

```text
  [ Linux laptop ]──┐
  [ Windows PC   ]──┼──► POST /api/traffic/ingest ──► [ Hub :8080 ] ──► browser globe
  [ macOS        ]──┘
  [ Linux server ]── (hub can also collect its own traffic)
```

| Mode | What it does | Command |
| --- | --- | --- |
| **Hub** | Serves UI + reads local sockets + accepts agents | `npm run build && npm start` |
| **Edge agent** | Reads local sockets only; pushes to hub | `npm run agent` |

Hub install / systemd / firewall: **[INSTALL.md](../INSTALL.md)**

---

## Prerequisites (all agents)

| Requirement | Notes |
| --- | --- |
| **Node.js 20+** | 22 recommended ([nodejs.org](https://nodejs.org/)) |
| Network path to hub | Agent must reach `http://HUB_IP:8080` (or HTTPS via reverse proxy) |
| Repo checkout | Full clone **or** `agents/` + `server/traffic/` |
| **No `npm run build`** | Agents do not need the web UI build |

Install Node quickly:

```bash
# Linux (Ubuntu/Debian example)
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs

# macOS (Homebrew)
brew install node@22

# Windows
# Install from https://nodejs.org  OR:  winget install OpenJS.NodeJS.LTS
```

---

## LAN vs public IP (read this)

Agents must reach the hub over a path that works from *that* machine:

| Where the agent is | Set `EARTHLINK_HUB` to |
| --- | --- |
| Same LAN as hub | **Internal IP** — e.g. `http://10.11.12.62:8080` |
| Off-site / remote internet | Public IP or DNS — e.g. `http://75.x.x.x:8080` (firewall open) |
| Anywhere via VPN | VPN address of the hub |

**Symptom:** `push failed: … timeout` while `curl` to the public IP is slow or hangs  
**Fix:** switch to the hub’s LAN IP when you are on the same network.

```powershell
# Windows on the LAN
$env:EARTHLINK_HUB = "http://10.11.12.62:8080"
$env:EARTHLINK_HOST_ID = "desktop-win"
.\agents\run-windows.ps1
```

```bash
# Linux on the LAN
export EARTHLINK_HUB=http://10.11.12.62:8080
export EARTHLINK_HOST_ID=ubuntuopti001
bash agents/run-linux.sh
```

Find the hub LAN IP on the hub host:

```bash
hostname -I
# or: ip -4 addr
```


---

## Shared environment variables

Set these on **every edge agent**:

| Variable | Required | Example | Meaning |
| --- | --- | --- | --- |
| `EARTHLINK_HUB` | **yes** | `http://10.11.12.62:8080` | Hub base URL (no trailing slash required) |
| `EARTHLINK_HOST_ID` | recommended | `edge-linux-1` | Unique name shown in UI Agents list |
| `EARTHLINK_AGENT_TOKEN` | if hub set one | `change-me` | Must match hub `EARTHLINK_AGENT_TOKEN` |
| `EARTHLINK_POLL_MS` | no | `2000` | How often to push (ms) |
| `EARTHLINK_INCLUDE_PRIVATE` | no | `1` | Include LAN/private remotes |

On the **hub** (recommended when agents connect):

```bash
export EARTHLINK_AGENT_TOKEN=change-me
export EARTHLINK_HOST_ID=hub-linux
HOST=0.0.0.0 PORT=8080 npm start
```

---

## Hub (any OS with Node; Linux recommended)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
npm install
npm run build

export EARTHLINK_AGENT_TOKEN=change-me
export EARTHLINK_HOST_ID=hub-main
HOST=0.0.0.0 PORT=8080 npm start
```

Verify:

```bash
curl -s http://127.0.0.1:8080/api/traffic/health
curl -s http://127.0.0.1:8080/api/traffic/agents
```

Open the globe: `http://HUB_IP:8080` — badge **LIVE**.

---

# Linux agent

### What it reads

`/proc/net/tcp` · UDP · `ss` · optional `conntrack` (DNS / ping) · process via `ss -p`

### One-shot (foreground)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink

export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=edge-linux-1
export EARTHLINK_AGENT_TOKEN=change-me
# export EARTHLINK_INCLUDE_PRIVATE=1

npm run agent
# same as:  node agents/earthlink-agent.mjs
# or:       bash agents/run-linux.sh
```

Expected log:

```text
[earthlink-agent] Linux → http://HUB_IP:8080/api/traffic/ingest as edge-linux-1
[earthlink-agent] pushed 12 sockets · agents=2
```

### Helper script

```bash
export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=edge-linux-1
export EARTHLINK_AGENT_TOKEN=change-me
bash agents/run-linux.sh
```

### systemd (always-on)

```bash
sudo mkdir -p /opt/earthlink
sudo git clone https://github.com/Og1Kenobi/earthlink.git /opt/earthlink
# or rsync your checkout to /opt/earthlink

sudo tee /etc/systemd/system/earthlink-agent.service >/dev/null <<'EOF'
[Unit]
Description=Earthlink edge agent (Linux)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/earthlink
Environment=EARTHLINK_HUB=http://HUB_IP:8080
Environment=EARTHLINK_HOST_ID=edge-linux-1
Environment=EARTHLINK_AGENT_TOKEN=change-me
Environment=EARTHLINK_POLL_MS=2000
# Environment=EARTHLINK_INCLUDE_PRIVATE=1
ExecStart=/usr/bin/node agents/earthlink-agent.mjs
Restart=on-failure
RestartSec=3
User=nobody
# If you need conntrack sudo, run as a real user with the sudoers rule below

[Install]
WantedBy=multi-user.target
EOF

# Point User= and WorkingDirectory at a user that can read sockets (usually fine as normal user)
sudo systemctl daemon-reload
sudo systemctl enable --now earthlink-agent
sudo journalctl -u earthlink-agent -f
```

### Optional: DNS / ping via conntrack

```bash
sudo apt install -y conntrack
# user that runs the agent:
echo 'YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/conntrack' | sudo tee /etc/sudoers.d/earthlink-conntrack
sudo chmod 440 /etc/sudoers.d/earthlink-conntrack
sudo -n /usr/sbin/conntrack -L | head
```

---

# macOS agent

### What it reads

`netstat -an -p tcp/udp` · process names via `lsof` (best-effort)

### One-shot (Terminal)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink

export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=macbook
export EARTHLINK_AGENT_TOKEN=change-me

npm run agent
# or:  bash agents/run-macos.sh
```

### Helper script

```bash
export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=macbook
export EARTHLINK_AGENT_TOKEN=change-me
bash agents/run-macos.sh
```

### launchd (start at login)

1. Put the repo somewhere stable, e.g. `~/earthlink`
2. Create `~/Library/LaunchAgents/com.earthlink.agent.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.earthlink.agent</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>
    <!-- or: /opt/homebrew/bin/node -->
    <string>/Users/YOUR_USER/earthlink/agents/earthlink-agent.mjs</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>EARTHLINK_HUB</key>
    <string>http://HUB_IP:8080</string>
    <key>EARTHLINK_HOST_ID</key>
    <string>macbook</string>
    <key>EARTHLINK_AGENT_TOKEN</key>
    <string>change-me</string>
    <key>EARTHLINK_POLL_MS</key>
    <string>2000</string>
  </dict>
  <key>WorkingDirectory</key>
  <string>/Users/YOUR_USER/earthlink</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>/Users/YOUR_USER/Library/Logs/earthlink-agent.log</string>
  <key>StandardErrorPath</key>
  <string>/Users/YOUR_USER/Library/Logs/earthlink-agent.err</string>
</dict>
</plist>
```

```bash
# find node path
which node

launchctl load ~/Library/LaunchAgents/com.earthlink.agent.plist
launchctl start com.earthlink.agent
# logs:
tail -f ~/Library/Logs/earthlink-agent.log
```

Unload:

```bash
launchctl unload ~/Library/LaunchAgents/com.earthlink.agent.plist
```

**Note:** Full Disk Access is rarely needed. `lsof` process names may be empty for other users’ processes; sockets still report.

---

# Windows agent

### What it reads

`netstat -ano` (PowerShell `Get-NetTCPConnection` fallback) · process names via `tasklist`

### One-shot (PowerShell)

```powershell
# Node 20+ required (node -v)
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink

$env:EARTHLINK_HUB = "http://HUB_IP:8080"
$env:EARTHLINK_HOST_ID = "desktop-win"
$env:EARTHLINK_AGENT_TOKEN = "change-me"
# $env:EARTHLINK_INCLUDE_PRIVATE = "1"

npm run agent
# same as:  node .\agents\earthlink-agent.mjs
# or:       .\agents\run-windows.ps1
```

### Helper scripts

```powershell
$env:EARTHLINK_HUB = "http://HUB_IP:8080"
$env:EARTHLINK_HOST_ID = "desktop-win"
$env:EARTHLINK_AGENT_TOKEN = "change-me"
.\agents\run-windows.ps1
```

CMD:

```cmd
set EARTHLINK_HUB=http://HUB_IP:8080
set EARTHLINK_HOST_ID=desktop-win
set EARTHLINK_AGENT_TOKEN=change-me
agents\run-windows.cmd
```

### Task Scheduler (start at logon)

1. Open **Task Scheduler** → Create Task  
2. **General**: Run whether user is logged on or not (optional) · Run with highest privileges (optional, for richer process names)  
3. **Triggers**: At log on  
4. **Actions**: Start a program  

| Field | Value |
| --- | --- |
| Program | `C:\Program Files\nodejs\node.exe` (or `where node`) |
| Arguments | `C:\earthlink\agents\earthlink-agent.mjs` |
| Start in | `C:\earthlink` |

5. **Environment** (Task Scheduler → Actions doesn’t set env easily). Prefer a wrapper:

`C:\earthlink\agents\run-windows.cmd` contents (edit hub/token first):

```cmd
@echo off
set EARTHLINK_HUB=http://HUB_IP:8080
set EARTHLINK_HOST_ID=desktop-win
set EARTHLINK_AGENT_TOKEN=change-me
set EARTHLINK_POLL_MS=2000
cd /d C:\earthlink
node agents\earthlink-agent.mjs
```

Then schedule:

| Field | Value |
| --- | --- |
| Program | `C:\earthlink\agents\run-windows.cmd` |
| Start in | `C:\earthlink` |

### Optional: Windows service (NSSM)

```powershell
# install NSSM, then:
nssm install EarthlinkAgent "C:\Program Files\nodejs\node.exe" "C:\earthlink\agents\earthlink-agent.mjs"
nssm set EarthlinkAgent AppDirectory C:\earthlink
nssm set EarthlinkAgent AppEnvironmentExtra EARTHLINK_HUB=http://HUB_IP:8080 EARTHLINK_HOST_ID=desktop-win EARTHLINK_AGENT_TOKEN=change-me
nssm start EarthlinkAgent
```

**Firewall:** agents only need **outbound** HTTP to the hub. No inbound ports on the agent host.

---

## Verify from any OS

On the agent host:

```text
[earthlink-agent] Linux|macOS|Windows → http://HUB_IP:8080/api/traffic/ingest as YOUR_ID
[earthlink-agent] pushed N sockets · agents=M
```

On the hub:

```bash
curl -s http://127.0.0.1:8080/api/traffic/agents | jq .
```

In the browser globe: **Traffic → Agents** lists each `hostId` with OS and socket count.  
Connections from remote agents show `hostId` / `os` when more than one agent is online.

---

## Minimal agent-only install

You only need:

```text
agents/earthlink-agent.mjs
agents/run-linux.sh
agents/run-macos.sh
agents/run-windows.ps1
agents/run-windows.cmd
server/traffic/          # entire folder (connections, platforms, process, …)
```

Then:

```bash
# Linux / macOS
export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=edge-1
export EARTHLINK_AGENT_TOKEN=change-me
node agents/earthlink-agent.mjs
```

```powershell
# Windows
$env:EARTHLINK_HUB="http://HUB_IP:8080"
$env:EARTHLINK_HOST_ID="edge-1"
$env:EARTHLINK_AGENT_TOKEN="change-me"
node .\agents\earthlink-agent.mjs
```

---

## API (hub)

### `POST /api/traffic/ingest`

```json
{
  "hostId": "edge-linux-1",
  "os": "linux",
  "token": "change-me",
  "sockets": [
    {
      "remoteIp": "1.2.3.4",
      "remotePort": 443,
      "localIp": "10.0.0.5",
      "localPort": 54321,
      "transport": "tcp",
      "direction": "outbound",
      "protocol": "HTTPS",
      "process": "curl"
    }
  ]
}
```

Header alternative: `X-Earthlink-Token: change-me`

### `GET /api/traffic/agents`

Lists hub + remotes (`hostId`, `os`, `osLabel`, `socketCount`, `stale`, `lastSeen`).

---

## Troubleshooting

| Symptom | Fix |
| --- | --- |
| `set EARTHLINK_HUB=...` then exit | Hub URL missing or empty |
| `push failed` / `ECONNREFUSED` | Hub down, wrong IP/port, or firewall blocking 8080 |
| `invalid agent token` | Token must match hub `EARTHLINK_AGENT_TOKEN` |
| Agent online, no arcs | Peers are private — enable Internal IPs / `EARTHLINK_INCLUDE_PRIVATE=1` or wait for public IPs |
| Windows: few process names | Run elevated or accept `netstat` without names |
| macOS: empty process | Normal without `lsof` rights; sockets still work |
| Linux: no DNS/ping | Install `conntrack` + sudoers (above) |
| Linux: `sudo` auth spam in journal | `export EARTHLINK_SKIP_CONNTRACK_SUDO=1` or NOPASSWD conntrack |
| `push failed` timeout on LAN | Use hub **LAN** IP, not public WAN IP |
| Duplicate host in UI | Give each agent a unique `EARTHLINK_HOST_ID` |

---

## Security notes

- Prefer **VPN / private LAN** between agents and hub  
- Set **`EARTHLINK_AGENT_TOKEN`** whenever agents are on a shared network  
- Do not expose hub `:8080` to the open internet without reverse-proxy auth  
- Agents only **send** connection metadata (IPs, ports, process names) — not packet payloads  
