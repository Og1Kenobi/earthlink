# Earthlink edge agents

Push live sockets from **Linux**, **macOS**, or **Windows** into an Earthlink hub.

**Full instructions (all OS):** [docs/AGENTS.md](../docs/AGENTS.md)

## Quick start (same LAN as hub)

Use the hub’s **internal** IP (example `10.11.12.62`):

```bash
export EARTHLINK_HUB=http://10.11.12.62:8080
export EARTHLINK_HOST_ID=my-machine
# export EARTHLINK_AGENT_TOKEN=change-me
```

| OS | Command |
| --- | --- |
| Linux | `bash agents/run-linux.sh` |
| macOS | `bash agents/run-macos.sh` |
| Windows (PowerShell) | `.\agents\run-windows.ps1` |
| Windows (CMD) | `agents\run-windows.cmd` |
| Any | `npm run agent` / `node agents/earthlink-agent.mjs` |

Success:

```text
[earthlink-agent] … → http://10.11.12.62:8080/api/traffic/ingest as my-machine
[earthlink-agent] pushed N sockets · agents=…
```

Always-on: systemd (Linux), launchd (macOS), Task Scheduler (Windows) — see [docs/AGENTS.md](../docs/AGENTS.md).
