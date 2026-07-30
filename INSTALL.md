# Earthlink — install on your server

Shows **real** established TCP connections (inbound + outbound) on the host as dots + arcs on a live Earth globe.

- **Green arcs** = inbound (remote → your server)
- **Amber arcs** = outbound (your server → remote)

## Requirements

- Linux (uses `/proc/net/tcp`; falls back to `ss` / `netstat`)
- Node.js **20+** (22 recommended)
- Outbound HTTP for IP geolocation
- Port **8080** free (or set `PORT`)

## Quick install

```bash
cd /opt/earthlink   # after cloning this project onto the server
npm install
npm run build
HOST=0.0.0.0 PORT=8080 npm start
```

Open: `http://YOUR_SERVER_IP:8080` — badge should read **LIVE** / **REAL**.

## systemd

```bash
sudo tee /etc/systemd/system/earthlink.service >/dev/null <<'EOF'
[Unit]
Description=Earthlink real-time connection globe
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/earthlink
Environment=NODE_ENV=production
Environment=HOST=0.0.0.0
Environment=PORT=8080
# Optional home pin
# Environment=EARTHLINK_HOME_LAT=40.7128
# Environment=EARTHLINK_HOME_LON=-74.0060
# Environment=EARTHLINK_HOME_LABEL=My server
# Environment=EARTHLINK_INCLUDE_PRIVATE=1
# Environment=EARTHLINK_DIRECTIONS=both
# Environment=EARTHLINK_MUTE_IPS=8.8.8.8,8.8.4.4
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
```

## Environment

| Variable | Default | Meaning |
|---|---|---|
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Bind |
| `EARTHLINK_HOME_LAT` / `LON` | auto | Force home pin |
| `EARTHLINK_HOME_LABEL` | — | Home label |
| `EARTHLINK_POLL_MS` | `1500` | Socket poll interval |
| `EARTHLINK_LINGER_MS` | `4500` | Fade after close |
| `EARTHLINK_INCLUDE_PRIVATE` | off | Set `1` to show LAN peers |
| `EARTHLINK_DIRECTIONS` | `both` | `both`, `inbound`, or `outbound` |
| `EARTHLINK_MUTE_IPS` | — | Comma-separated IPs to hide |

## Direction detection

- **Inbound**: local port is listening / well-known service (SSH, HTTP, …) — client is remote
- **Outbound**: remote port is the service (443, 80, …) — you initiated the connection

## Health checks

```bash
curl -s http://127.0.0.1:8080/api/traffic/health
curl -s http://127.0.0.1:8080/api/traffic | jq '{in:.inboundCount,out:.outboundCount,active:.activeCount}'
```

## Conntrack (DNS / ping)

```bash
sudo apt install -y conntrack
# replace YOUR_USER with the account that runs npm start
echo 'YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/conntrack' | sudo tee /etc/sudoers.d/earthlink-conntrack
sudo chmod 440 /etc/sudoers.d/earthlink-conntrack
sudo -n /usr/sbin/conntrack -L | head
```
