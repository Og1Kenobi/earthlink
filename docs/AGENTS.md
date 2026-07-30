# Earthlink agents (multi-OS)

Earthlink can show traffic from **Linux, macOS, and Windows**.

| Mode | When | How |
| --- | --- | --- |
| **Hub** | Globe + collector on one machine | `npm run build && npm start` |
| **Edge agent** | Other machines push into that hub | `npm run agent` / `node agents/earthlink-agent.mjs` |

Server install (systemd, firewall, env): **[INSTALL.md](../INSTALL.md)**

---

## Built-in OS collectors

| OS | Source | Process names |
| --- | --- | --- |
| **Linux** | `/proc/net/tcp` · UDP · `ss` · `conntrack` | `ss -p` |
| **macOS** | `netstat -an -p tcp/udp` | `lsof` (best-effort) |
| **Windows** | `netstat -ano` (PowerShell fallback) | `tasklist` |

Every connection is tagged with `hostId` + `os` (`linux` | `macos` | `windows`).

---

## 1. Hub (Linux recommended)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
npm install
npm run build

export EARTHLINK_AGENT_TOKEN=change-me   # recommended if agents will connect
export EARTHLINK_HOST_ID=hub-linux
HOST=0.0.0.0 PORT=8080 npm start
```

Check:

```bash
curl -s http://127.0.0.1:8080/api/traffic/health
curl -s http://127.0.0.1:8080/api/traffic/agents
```

---

## 2. Edge agent on a remote Linux server

No production build needed.

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink

export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=edge-linux-1
export EARTHLINK_AGENT_TOKEN=change-me

npm run agent
```

Expected log:

```text
[earthlink-agent] Linux → http://HUB_IP:8080/api/traffic/ingest as edge-linux-1
[earthlink-agent] pushed N sockets · agents=2
```

Hub UI → **Traffic → Agents** should list both hosts.

### systemd (Linux agent)

```bash
sudo tee /etc/systemd/system/earthlink-agent.service >/dev/null <<'EOF'
[Unit]
Description=Earthlink edge agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/earthlink
Environment=EARTHLINK_HUB=http://HUB_IP:8080
Environment=EARTHLINK_HOST_ID=edge-linux-1
Environment=EARTHLINK_AGENT_TOKEN=change-me
Environment=EARTHLINK_POLL_MS=2000
ExecStart=/usr/bin/node agents/earthlink-agent.mjs
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now earthlink-agent
```

---

## macOS agent

```bash
export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=macbook
export EARTHLINK_AGENT_TOKEN=change-me
npm run agent
```

---

## Windows agent (PowerShell)

```powershell
$env:EARTHLINK_HUB="http://HUB_IP:8080"
$env:EARTHLINK_HOST_ID="desktop-win"
$env:EARTHLINK_AGENT_TOKEN="change-me"
npm run agent
```

---

## API

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

Hub + remote agents (last seen, OS, socket counts, stale flag).

---

## Minimal files for agent-only hosts

If you don’t want a full clone on the edge:

- `agents/earthlink-agent.mjs`
- `server/traffic/` (connections, platforms, process, …)

Then:

```bash
node agents/earthlink-agent.mjs
```

---

## Notes

- Agents **push sockets**; the **hub** does GeoIP and serves the globe UI
- Without `EARTHLINK_AGENT_TOKEN`, ingest is open — use only on trusted LANs/VPN
- Linux DNS/ping: install `conntrack` + sudoers (see INSTALL.md)
- Windows process names may need elevation; sockets still work without them
- macOS process names need `lsof` permission; sockets still work without them
