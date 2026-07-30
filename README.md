# Earthlink

**Live remote connections on a rotating political globe — NOC-grade.**

Self-host on your server: every public TCP / UDP / DNS / ping peer lights up as a pin and arc to your home location, hangs around, then fades. Inbound is green, outbound is amber.

**Agents for Linux, macOS, and Windows** — run a hub on one machine and optional edge agents on others. Same LAN? Point agents at the hub’s **private IP**. Off-site? Use the public IP or VPN.

<p align="center">
  <img src="docs/screenshots/desktop-globe.png" alt="Earthlink desktop — NOC globe with live traffic" width="100%" />
</p>

| Desktop | Mobile |
| --- | --- |
| <img src="docs/screenshots/desktop-filtered.png" alt="Earthlink wider Connections panel, spin, agents" /> | <img src="docs/screenshots/mobile.png" alt="Earthlink on mobile" /> |

---

## Deploy

| Doc | Contents |
| --- | --- |
| **[INSTALL.md](./INSTALL.md)** | Linux hub, systemd, firewall, env, conntrack |
| **[docs/AGENTS.md](./docs/AGENTS.md)** | Edge agents on **Linux · macOS · Windows** (scripts, boot, LAN tips) |
| **[agents/](./agents/)** | Helper runners (`run-linux.sh`, `run-macos.sh`, `run-windows.ps1`) |

### Hub (globe + this machine’s traffic)

```bash
git clone https://github.com/Og1Kenobi/earthlink.git
cd earthlink
npm install
npm run build

export EARTHLINK_HOST_ID=hub-linux
# export EARTHLINK_AGENT_TOKEN=change-me   # recommended if agents join
HOST=0.0.0.0 PORT=8080 npm start
```

Open `http://YOUR_SERVER:8080` — badge should read **LIVE**.

### Edge agents (no build)

**Important:** from another machine on the **same LAN**, use the hub’s **internal** address  
(e.g. `http://10.11.12.62:8080`). The public WAN IP often times out or hairpins.

| OS | Quick start |
| --- | --- |
| **Linux** | `export EARTHLINK_HUB=http://10.11.12.62:8080` · `bash agents/run-linux.sh` · systemd |
| **macOS** | same env · `bash agents/run-macos.sh` · launchd |
| **Windows** | `$env:EARTHLINK_HUB="http://10.11.12.62:8080"` · `.\agents\run-windows.ps1` · Task Scheduler |

Success looks like:

```text
[earthlink-agent] Windows → http://10.11.12.62:8080/api/traffic/ingest as desktop-win
[earthlink-agent] pushed 60 sockets · agents=3
```

Globe → **Traffic → Agents** lists each host (hub + remotes).

---

## Layout

| Zone | Content |
| --- | --- |
| **Top-left** | Brand, LIVE, sparkline, security presets, **globe spin** (Off→Turbo) |
| **Top-right** | Kiosk · replay · LAN · alerts · mute · sound · tools |
| **Left stack** | Traffic (+ Internal IPs + **Agents**) · Talkers · Alerts · Home · Muted |
| **Right** | **Connections** (wide panel) + filter |
| **Bottom** | Auto-scrolling feed marquee |

---

## Features

- **Real host traffic** — OS-native collectors (Linux / macOS / Windows)
- **Remote multi-OS agents** — push into one hub (`POST /api/traffic/ingest`)
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

Or skip sudo probes entirely:

```bash
export EARTHLINK_SKIP_CONNTRACK_SUDO=1
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

Screenshots: [`docs/screenshots/`](./docs/screenshots/) (refreshed with current UI).
