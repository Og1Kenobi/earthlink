# Earthlink

**Live remote connections on a rotating political globe — NOC-grade.**

Self-host on your server: every public TCP / UDP / DNS / ping peer lights up as a pin and arc to your home location, hangs around, then fades. Inbound is green, outbound is amber.

<p align="center">
  <img src="docs/screenshots/desktop-globe.png" alt="Earthlink desktop — denser HUD around the globe" width="100%" />
</p>

| Desktop (talkers / filters) | Mobile |
| --- | --- |
| <img src="docs/screenshots/desktop-filtered.png" alt="Earthlink desktop with talkers tab" /> | <img src="docs/screenshots/mobile.png" alt="Earthlink on mobile" /> |

---

## Layout

HUD is corner-docked so the **globe stays center stage**:

| Zone | Content |
| --- | --- |
| **Top** | Brand, LIVE badge, sparkline, presets, tools |
| **Upper-left** | Tabbed **Stats · Talkers · Alerts** (one panel) |
| **Right** | Full-height **Connections** list + filter |
| **Lower-left** | **Home** + **Mute** drawer |
| **Bottom** | **Feed** ticker (+ replay scrubber when open) |
| **Bottom-center** | **Focus** card when a connection is selected |

Kiosk mode strips chrome for wall / TV use.

---

## Features

- **Real host traffic** — `/proc/net/tcp`, UDP, conntrack (DNS / ping)
- **Inbound + outbound** — green in, amber out
- **Process names** — `ss -p` / inode map
- **ASN / org** on focus + talkers
- **Bandwidth-weighted arcs** + **heat trails**
- **Presets** — All · Sec · Web · Quiet
- **Mute IPs** — hide DNS forwarders; toggle back on
- **Replay scrubber** — recent open/close events
- **Alerts** — new country, SSH from new /24
- **Top talkers** · **access-log correlate** · **iface filter**

---

## Quick start

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
npm install
npm run build
HOST=0.0.0.0 PORT=8080 npm start
```

Open `http://YOUR_SERVER:8080` — badge should read **LIVE**.

Full install: **[INSTALL.md](./INSTALL.md)**

### Optional power-ups

```bash
export EARTHLINK_MUTE_IPS=8.8.8.8,8.8.4.4
export EARTHLINK_ACCESS_LOG=/var/log/nginx/access.log
export EARTHLINK_IFACES=eth0,wg0
export EARTHLINK_HOST_ID=edge-1
HOST=0.0.0.0 PORT=8080 npm start
```

### DNS / ping

```bash
sudo apt install -y conntrack
echo 'YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/conntrack' | sudo tee /etc/sudoers.d/earthlink-conntrack
sudo chmod 440 /etc/sudoers.d/earthlink-conntrack
```

---

## API

| Path | Description |
| --- | --- |
| `GET /api/traffic` | Live snapshot |
| `GET /api/traffic/history` | Replay events |
| `GET /api/traffic/health` | Health |
| `GET/POST /api/traffic/mute` | Mute list |
| `GET /api/traffic/stream` | SSE |

---

## Dev

```bash
npm install && npm run dev
npm run build && npm start
npm run typecheck
```

Stack: React 19, Vite, TanStack Start, Three.js / R3F, Tailwind v4.

Screenshots: [`docs/screenshots/`](./docs/screenshots/).
