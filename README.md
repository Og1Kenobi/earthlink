# Earthlink

**Live remote connections on a rotating political globe — NOC-grade.**

Self-host on your server: every public TCP / UDP / DNS / ping peer lights up as a pin and arc to your home location, hangs around, then fades. Inbound is green, outbound is amber.

<p align="center">
  <img src="docs/screenshots/desktop-globe.png" alt="Earthlink desktop — live globe with connections" width="100%" />
</p>

| Desktop | Mobile |
| --- | --- |
| <img src="docs/screenshots/desktop-filtered.png" alt="Connections panel and filter" /> | <img src="docs/screenshots/mobile.png" alt="Earthlink on mobile" /> |

---

## Features

- **Real host traffic** — `/proc/net/tcp`, UDP, conntrack (DNS / ping)
- **Inbound + outbound** — green in, amber out
- **Process names** — `ss -p` / inode map (`nginx`, `sshd`, …)
- **ASN / org** — Cloudflare, Google, etc. on focus + feed
- **Bandwidth-weighted arcs** + **heat trails**
- **Security presets** — All · Security · Web · Noise off
- **Mute IPs** — hide DNS forwarders; toggle back on
- **Replay scrubber** — scrub recent open/close events
- **Alerts** — new country, SSH from new /24 (browser notify)
- **Kiosk / NOC mode** — big globe + ticker
- **Top talkers** — by rate / bytes
- **Access-log correlate** — optional nginx path on focus
- **Interface filter** — `EARTHLINK_IFACES=eth0,wg0`
- **Event feed + sound blips**

---

## Quick start (server)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
npm install
npm run build
HOST=0.0.0.0 PORT=8080 npm start
```

Open `http://YOUR_SERVER:8080` — badge should read **LIVE**.

Full install notes: **[INSTALL.md](./INSTALL.md)**

### Super-awesome env (optional)

```bash
export EARTHLINK_MUTE_IPS=8.8.8.8,8.8.4.4
export EARTHLINK_ACCESS_LOG=/var/log/nginx/access.log
export EARTHLINK_IFACES=eth0,wg0          # only these NICs
export EARTHLINK_HOST_ID=edge-1
export EARTHLINK_HOME_LAT=… EARTHLINK_HOME_LON=…
HOST=0.0.0.0 PORT=8080 npm start
```

### DNS / ping

```bash
sudo apt install -y conntrack
echo 'YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/conntrack' | sudo tee /etc/sudoers.d/earthlink-conntrack
sudo chmod 440 /etc/sudoers.d/earthlink-conntrack
```

---

## What traffic is shown?

| Shown | Not shown |
| --- | --- |
| Established TCP (+ short-lived states) | Private/LAN by default |
| UDP / DNS / NTP / QUIC via conntrack | Packet payloads |
| ICMP ping via conntrack | Other hosts (unless multi-agent later) |
| Public remotes with geo + ASN | |

---

## Environment

| Variable | Meaning |
| --- | --- |
| `HOST` / `PORT` | Bind (`0.0.0.0:8080`) |
| `EARTHLINK_HOME_LAT` / `LON` | Pin home |
| `EARTHLINK_MUTE_IPS` | Comma-separated IPs to hide |
| `EARTHLINK_IFACES` | Only sockets on these interfaces |
| `EARTHLINK_ACCESS_LOG` | Nginx/Caddy access log path |
| `EARTHLINK_HOST_ID` | Label this agent |
| `EARTHLINK_POLL_MS` / `LINGER_MS` | Poll / fade timing |
| `EARTHLINK_INCLUDE_PRIVATE` | `1` = include LAN peers |
| `EARTHLINK_DIRECTIONS` | `both` / `inbound` / `outbound` |

---

## API

| Path | Description |
| --- | --- |
| `GET /api/traffic` | Live snapshot (+ process, ASN, top talkers) |
| `GET /api/traffic/history` | Replay event ring |
| `GET /api/traffic/health` | Health |
| `GET/POST /api/traffic/mute` | Mute list |
| `GET /api/traffic/stream` | SSE |

---

## Dev

```bash
npm install
npm run dev
npm run build && npm start
npm run typecheck
```

Stack: React 19, Vite, TanStack Start, Three.js / R3F, Tailwind v4.

Screenshots: [`docs/screenshots/`](./docs/screenshots/).
