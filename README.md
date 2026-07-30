# Earthlink

**Live remote connections on a rotating political globe — NOC-grade.**

Self-host on your server: every public TCP / UDP / DNS / ping peer lights up as a pin and arc to your home location, hangs around, then fades. Inbound is green, outbound is amber.

**Agents for Linux, macOS, and Windows** — run a hub on one machine and optional edge agents on others.

<p align="center">
  <img src="docs/screenshots/desktop-globe.png" alt="Earthlink desktop — NOC globe with live traffic" width="100%" />
</p>

| Desktop | Mobile |
| --- | --- |
| <img src="docs/screenshots/desktop-filtered.png" alt="Earthlink with spin presets and panels" /> | <img src="docs/screenshots/mobile.png" alt="Earthlink on mobile" /> |

---

## Deploy on a remote Linux server

**Full guide:** **[INSTALL.md](./INSTALL.md)** · **Agents:** **[docs/AGENTS.md](./docs/AGENTS.md)**

### Hub (globe + this machine’s traffic)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
npm install
npm run build

export EARTHLINK_AGENT_TOKEN=change-me
export EARTHLINK_HOST_ID=hub-linux
HOST=0.0.0.0 PORT=8080 npm start
```

Open `http://YOUR_SERVER:8080` — badge should read **LIVE**.

### Edge agent (another Linux box)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
# no build needed for agent-only

export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=edge-linux-1
export EARTHLINK_AGENT_TOKEN=change-me
npm run agent
```

| OS | Local hub collector | Edge agent |
| --- | --- | --- |
| **Linux** | `/proc` · `ss` · `conntrack` | `npm run agent` |
| **macOS** | `netstat` · `lsof` | `npm run agent` |
| **Windows** | `netstat -ano` · `tasklist` | `npm run agent` |

---

## Layout

| Zone | Content |
| --- | --- |
| **Top-left** | Brand, LIVE, sparkline, security presets, **globe spin** (Off→Turbo) |
| **Top-right** | Kiosk · replay · LAN · alerts · mute · sound · tools |
| **Left stack** | Traffic (+ Internal IPs + **Agents**) · Talkers · Alerts · Home · Muted |
| **Right** | Connections + filter |
| **Bottom** | Auto-scrolling feed marquee |

---

## Features

- **Real host traffic** — OS-native collectors (Linux / macOS / Windows)
- **Remote agents** — push sockets into one hub (`POST /api/traffic/ingest`)
- **Inbound + outbound** — green in, amber out
- **Process names** · **ASN / org** · bandwidth arcs · heat trails
- **Security presets** · **spin speed** · **mute** · **LAN toggle**
- **Replay** · **alerts** · **kiosk** · **tooltips** · marquee feed

---

## Optional hub env

```bash
export EARTHLINK_MUTE_IPS=8.8.8.8,8.8.4.4
export EARTHLINK_INCLUDE_PRIVATE=1
export EARTHLINK_AGENT_TOKEN=change-me
export EARTHLINK_ACCESS_LOG=/var/log/nginx/access.log
export EARTHLINK_IFACES=eth0,wg0
export EARTHLINK_HOST_ID=hub-linux
HOST=0.0.0.0 PORT=8080 npm start
```

### DNS / ping (Linux)

```bash
sudo apt install -y conntrack
echo 'YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/conntrack' | sudo tee /etc/sudoers.d/earthlink-conntrack
sudo chmod 440 /etc/sudoers.d/earthlink-conntrack
```

---

## API

| Path | Description |
| --- | --- |
| `GET /api/traffic` | Live snapshot (incl. `agents[]`, `os`) |
| `POST /api/traffic/ingest` | Edge agent push |
| `GET /api/traffic/agents` | Hub + remote agents |
| `GET /api/traffic/history` | Replay events |
| `GET/POST /api/traffic/mute` | Mute list |
| `GET/POST /api/traffic/settings` | `{ includePrivate }` |
| `GET /api/traffic/stream` | SSE |

---

## Dev

```bash
npm install && npm run dev
npm run build && npm start
npm run agent          # needs EARTHLINK_HUB
npm run typecheck
```

Stack: React 19, Vite, TanStack Start, Three.js / R3F, Tailwind v4.

Screenshots: [`docs/screenshots/`](./docs/screenshots/).
