# Earthlink — install on a remote Linux server

Shows **real** host traffic on a live political globe: TCP, UDP, DNS, and ping
(when conntrack is available). Peers appear as dots + arcs to your home pin.

- **Green arcs** = inbound (remote → this host)
- **Amber arcs** = outbound (this host → remote)

You can run:

1. **Hub only** — globe + collector on one Linux box (simplest)
2. **Hub + edge agents** — other Linux / macOS / Windows machines push sockets into the hub

Agents guide: **[docs/AGENTS.md](./docs/AGENTS.md)**

> **LAN tip:** machines on the same network should set `EARTHLINK_HUB=http://HUB_LAN_IP:8080` (not the public WAN IP). See docs/AGENTS.md → *LAN vs public IP*.

---

## Requirements (hub)

- Linux (recommended) — also runs on macOS / Windows as hub
- Node.js **20+** (22 recommended)
- Outbound HTTP for IP geolocation
- Port **8080** free (or set `PORT`)
- Firewall allows clients to reach `:8080` if agents or browsers are remote

---

## A. Deploy the hub (remote Linux)

```bash
# on the server
sudo mkdir -p /opt/earthlink
sudo chown "$USER":"$USER" /opt/earthlink
cd /opt/earthlink

git clone https://github.com/Og1Kenobi/earthlink.git .
# or: git pull origin main   if already cloned

npm install
npm run build

# optional shared secret for remote agents
export EARTHLINK_AGENT_TOKEN=change-me
export EARTHLINK_HOST_ID=hub-linux

HOST=0.0.0.0 PORT=8080 npm start
```

Open: `http://YOUR_SERVER_IP:8080` — badge should read **LIVE**.

Health:

```bash
curl -s http://127.0.0.1:8080/api/traffic/health | jq .
curl -s http://127.0.0.1:8080/api/traffic/agents | jq .
```

### Nested clone note

If `git clone` created a subfolder (`.../earthlink/earthlink`), run npm from the
directory that contains `package.json`.

### systemd (hub)

```bash
sudo tee /etc/systemd/system/earthlink.service >/dev/null <<'EOF'
[Unit]
Description=Earthlink hub (globe + traffic collector)
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/earthlink
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=8080
Environment=EARTHLINK_HOST_ID=hub-linux
# Environment=EARTHLINK_AGENT_TOKEN=change-me
# Environment=EARTHLINK_HOME_LAT=40.7128
# Environment=EARTHLINK_HOME_LON=-74.0060
# Environment=EARTHLINK_HOME_LABEL=My server
# Environment=EARTHLINK_INCLUDE_PRIVATE=1
# Environment=EARTHLINK_MUTE_IPS=8.8.8.8,8.8.4.4
# Environment=EARTHLINK_ACCESS_LOG=/var/log/nginx/access.log
# Environment=EARTHLINK_IFACES=eth0
ExecStart=/usr/bin/node server/traffic-server.mjs
Restart=on-failure
RestartSec=3
User=earthlink
Group=earthlink

[Install]
WantedBy=multi-user.target
EOF

sudo useradd -r -s /usr/sbin/nologin earthlink 2>/dev/null || true
sudo chown -R earthlink:earthlink /opt/earthlink
sudo systemctl daemon-reload
sudo systemctl enable --now earthlink
sudo systemctl status earthlink --no-pager
```

---

## B. Edge agent on another Linux host

The agent only needs Node + the repo (or `agents/` + `server/traffic/`). It does
**not** need `npm run build`.

```bash
# on the remote agent machine
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
# no build required for agent-only

export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=edge-linux-1
export EARTHLINK_AGENT_TOKEN=change-me   # must match hub if hub set a token
# export EARTHLINK_INCLUDE_PRIVATE=1    # optional: send LAN peers too

npm run agent
# same as: node agents/earthlink-agent.mjs
```

You should see lines like:

```text
[earthlink-agent] Linux → http://HUB_IP:8080/api/traffic/ingest as edge-linux-1
[earthlink-agent] pushed N sockets · agents=2
```

On the hub UI, **Traffic → Agents** lists `hub-linux` and `edge-linux-1`.

### systemd (edge agent)

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

All OS agent deploy (Linux · macOS · Windows · helpers · launchd · Task Scheduler):
**[docs/AGENTS.md](./docs/AGENTS.md)** · scripts in [`agents/`](./agents/)

---

## Environment (hub)

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Bind |
| `EARTHLINK_HOST_ID` | hostname | Label for this machine’s sockets |
| `EARTHLINK_AGENT_TOKEN` | — | Shared secret for `POST /api/traffic/ingest` |
| `EARTHLINK_HOME_LAT` / `LON` | auto | Force home pin |
| `EARTHLINK_HOME_LABEL` | — | Home label |
| `EARTHLINK_POLL_MS` | `1500` | Socket poll interval |
| `EARTHLINK_LINGER_MS` | `4500` | Fade after close |
| `EARTHLINK_INCLUDE_PRIVATE` | off | `1` = show LAN peers (or UI toggle) |
| `EARTHLINK_DIRECTIONS` | `both` | `both`, `inbound`, or `outbound` |
| `EARTHLINK_MUTE_IPS` | — | Comma-separated IPs to hide |
| `EARTHLINK_ACCESS_LOG` | — | Nginx/Caddy access log path |
| `EARTHLINK_IFACES` | — | Restrict to interfaces (`eth0,wg0`) |

### Environment (edge agent)

| Variable | Required | Meaning |
|---|---|---|
| `EARTHLINK_HUB` | yes | Hub base URL, e.g. `http://10.11.12.62:8080` |
| `EARTHLINK_HOST_ID` | recommended | Unique name for this agent |
| `EARTHLINK_AGENT_TOKEN` | if hub set one | Same token as hub |
| `EARTHLINK_POLL_MS` | no | Push interval (default `2000`) |
| `EARTHLINK_INCLUDE_PRIVATE` | no | `1` to include private/LAN remotes |

---

## Conntrack (DNS / ping on Linux hub or agent host)

```bash
sudo apt install -y conntrack
# replace YOUR_USER with the account that runs node
echo 'YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/conntrack' | sudo tee /etc/sudoers.d/earthlink-conntrack
sudo chmod 440 /etc/sudoers.d/earthlink-conntrack
sudo -n /usr/sbin/conntrack -L | head
```

---

## Direction detection

- **Inbound**: local port is listening / well-known service (SSH, HTTP, …)
- **Outbound**: remote port is the service (443, 80, …)

---

## UI tips

| Control | Purpose |
|---|---|
| **Agents** (Traffic panel) | Hub + remote agents (os, socket counts) |
| **Internal IPs** | Show private/LAN peers near home |
| **Mute** | Hide noisy IPs (DNS forwarders, etc.) |
| **Spin** Off → Turbo | Globe rotation (default Med) |
| **Feed** | Auto-scrolls; hover to pause |

---

## Updating the hub

```bash
cd /opt/earthlink
git pull origin main
npm install
npm run build
sudo systemctl restart earthlink
```

## Updating an edge agent

```bash
cd /opt/earthlink   # agent checkout
git pull origin main
sudo systemctl restart earthlink-agent
# no build required
```

---

## Firewall checklist

- Hub: allow **TCP 8080** from browsers and from agent hosts
- Agents: only need **outbound** HTTP to the hub
- Do **not** expose an unauthenticated hub to the public internet without a reverse-proxy login or VPN; set `EARTHLINK_AGENT_TOKEN` for agent ingest
