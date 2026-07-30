# Earthlink

**Live remote connections on a rotating political globe.**

Self-host on your server: every public TCP / UDP / DNS / ping peer lights up as a pin and arc to your home location, hangs around, then fades. Inbound is green, outbound is amber.

<p align="center">
  <img src="docs/screenshots/desktop-globe.png" alt="Earthlink desktop — live globe with connections" width="100%" />
</p>

| Desktop | Mobile |
| --- | --- |
| <img src="docs/screenshots/desktop-filtered.png" alt="Connections panel and filter" /> | <img src="docs/screenshots/mobile.png" alt="Earthlink on mobile" /> |

---

## Features

- **Real host traffic** — reads live sockets on the machine (`/proc/net/tcp`, UDP, conntrack for DNS/ping)
- **Inbound + outbound** — green in, amber out
- **Tech political map** — country/state boundaries, random fills, neon NOC chrome
- **Impact rings, heat blooms, pulse packets** along great-circle arcs
- **Connections panel** — filter by live / direction / protocol (DNS, HTTPS, SSH…)
- **Mute IPs** — hide noisy peers (e.g. DNS forwarders `8.8.8.8` / `8.8.4.4`) and toggle them back on
- **Event feed + activity sparkline + sound blips**
- **Click a row** to focus the arc on the globe
- **Self-contained server** — static UI + `/api/traffic` agent in one process

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

> Nested clone path is fine: if you see `…/earthlink/earthlink`, `cd` into the folder that has `package.json`.

Full install notes (permissions, systemd, conntrack): **[INSTALL.md](./INSTALL.md)**

### DNS / ping visibility

Short-lived flows need **conntrack**:

```bash
sudo apt install -y conntrack
# passwordless for the app user (replace YOUR_USER):
echo 'YOUR_USER ALL=(root) NOPASSWD: /usr/sbin/conntrack' | sudo tee /etc/sudoers.d/earthlink-conntrack
sudo chmod 440 /etc/sudoers.d/earthlink-conntrack
```

### Mute DNS forwarders (optional)

**In the UI:** ban icon on a connection, or Muted IPs panel → add `8.8.8.8` / `8.8.4.4`.

**On the server:**

```bash
export EARTHLINK_MUTE_IPS=8.8.8.8,8.8.4.4
HOST=0.0.0.0 PORT=8080 npm start
```

Or:

```bash
curl -X POST http://127.0.0.1:8080/api/traffic/mute \
  -H 'content-type: application/json' \
  -d '{"mute":["8.8.8.8","8.8.4.4"]}'
```

---

## What traffic is shown?

| Shown | Not shown |
| --- | --- |
| Established TCP (and short-lived TCP states) | UDP without a tracked peer (unless conntrack) |
| UDP / DNS / NTP / QUIC when conntrack is available | Private/LAN IPs by default |
| ICMP ping via conntrack | Packet payloads / HTTP paths |
| Public remotes with a geo hit | Other hosts (this machine only) |

Set `EARTHLINK_INCLUDE_PRIVATE=1` to include private remotes (often won’t map well).

---

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `HOST` / `PORT` | `0.0.0.0` / `8080` | Bind address |
| `EARTHLINK_HOME_LAT` / `LON` | auto (public IP) | Pin home on the globe |
| `EARTHLINK_HOME_LABEL` | — | Home label |
| `EARTHLINK_MUTE_IPS` | — | Comma-separated IPs to hide |
| `EARTHLINK_POLL_MS` | `1000–1500` | Socket poll interval |
| `EARTHLINK_LINGER_MS` | `4500–6000` | Fade after close |
| `EARTHLINK_INCLUDE_PRIVATE` | off | Set `1` for LAN peers |
| `EARTHLINK_DIRECTIONS` | `both` | `both`, `inbound`, or `outbound` |

---

## Dev

```bash
npm install
npm run dev      # http://0.0.0.0:8080
npm run build
npm start        # production: UI + traffic agent
npm run typecheck
```

Stack: React 19, Vite, TanStack Start, Three.js / R3F, Tailwind v4.

---

## API

| Path | Description |
| --- | --- |
| `GET /api/traffic` | Snapshot of live connections + home |
| `GET /api/traffic/health` | Health + counts |
| `GET /api/traffic/mute` | List server muted IPs |
| `POST /api/traffic/mute` | `{ "mute": ["1.2.3.4"] }` / `{ "unmute": [...] }` |
| `GET /api/traffic/stream` | SSE of traffic snapshots |

---

## License

Private project unless you add a license. Screenshots in [`docs/screenshots/`](./docs/screenshots/).
