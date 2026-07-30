# Earthlink agents (multi-OS)

Earthlink can show traffic from **Linux, macOS, and Windows**.

There are two modes:

| Mode | When | How |
| --- | --- | --- |
| **Hub (local)** | Globe + collector on the same machine | `npm start` auto-picks the OS reader |
| **Edge agent** | Extra laptops/servers push into one hub | `node agents/earthlink-agent.mjs` |

## Built-in OS collectors

| OS | Source | Process names |
| --- | --- | --- |
| **Linux** | `/proc/net/tcp` · UDP · `ss` · `conntrack` | `ss -p` |
| **macOS** | `netstat -an -p tcp/udp` | `lsof` (best-effort) |
| **Windows** | `netstat -ano` (PowerShell fallback) | `tasklist` |

The hub tags every connection with `hostId` + `os` (`linux` / `macos` / `windows`).

---

## Run the hub (any OS with Node 20+)

```bash
npm install
npm run build
HOST=0.0.0.0 PORT=8080 npm start
```

Optional shared secret for remote agents:

```bash
export EARTHLINK_AGENT_TOKEN=change-me
HOST=0.0.0.0 PORT=8080 npm start
```

---

## Run an edge agent on another machine

Copy the repo (or at least `agents/` + `server/traffic/`) and install Node 20+.

### Linux / macOS

```bash
export EARTHLINK_HUB=http://10.11.12.62:8080
export EARTHLINK_HOST_ID=macbook
export EARTHLINK_AGENT_TOKEN=change-me   # if hub requires it
# export EARTHLINK_INCLUDE_PRIVATE=1    # optional LAN peers
node agents/earthlink-agent.mjs
```

### Windows (PowerShell)

```powershell
$env:EARTHLINK_HUB="http://10.11.12.62:8080"
$env:EARTHLINK_HOST_ID="desktop-win"
$env:EARTHLINK_AGENT_TOKEN="change-me"
node agents/earthlink-agent.mjs
```

### npm script

```bash
EARTHLINK_HUB=http://HUB:8080 npm run agent
```

---

## API

### `POST /api/traffic/ingest`

Body:

```json
{
  "hostId": "macbook",
  "os": "macos",
  "token": "optional-shared-secret",
  "sockets": [
    {
      "remoteIp": "1.2.3.4",
      "remotePort": 443,
      "localIp": "192.168.1.10",
      "localPort": 54321,
      "transport": "tcp",
      "direction": "outbound",
      "protocol": "HTTPS",
      "process": "Chrome"
    }
  ]
}
```

Header alternative: `X-Earthlink-Token: secret`

### `GET /api/traffic/agents`

Lists hub + remote agents (last seen, OS, socket counts).

### Snapshot fields

Each connection may include:

- `hostId` — which machine
- `os` — `linux` | `macos` | `windows`

---

## systemd (Linux agent)

```ini
[Unit]
Description=Earthlink edge agent
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/earthlink
Environment=EARTHLINK_HUB=http://10.11.12.62:8080
Environment=EARTHLINK_HOST_ID=edge-linux
Environment=EARTHLINK_AGENT_TOKEN=change-me
ExecStart=/usr/bin/node agents/earthlink-agent.mjs
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Windows Task Scheduler

Create a task that runs at logon:

```
node C:\earthlink\agents\earthlink-agent.mjs
```

with the env vars above set in the task or a wrapper `.cmd`.

## macOS launchd

`~/Library/LaunchAgents/com.earthlink.agent.plist` with `ProgramArguments` → node + agent path, and `EnvironmentVariables` for hub / host id / token.

---

## Notes

- Edge agents only **push sockets**; the **hub** does GeoIP and serves the globe.
- Without `EARTHLINK_AGENT_TOKEN`, ingest is open — use only on trusted LANs.
- Windows may need to run as a user that can call `netstat`; some process names need elevation.
- macOS process names need `lsof` permission; sockets still work without them.
