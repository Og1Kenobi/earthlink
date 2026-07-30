# Earthlink edge agents

Push live sockets from **Linux**, **macOS**, or **Windows** into an Earthlink hub.

**Full instructions (all OS):** [docs/AGENTS.md](../docs/AGENTS.md)

## Quick start

```bash
export EARTHLINK_HUB=http://HUB_IP:8080
export EARTHLINK_HOST_ID=my-machine
export EARTHLINK_AGENT_TOKEN=change-me   # if hub requires it
```

| OS | Command |
| --- | --- |
| Linux | `bash agents/run-linux.sh` |
| macOS | `bash agents/run-macos.sh` |
| Windows (PowerShell) | `.\agents\run-windows.ps1` |
| Windows (CMD) | `agents\run-windows.cmd` |
| Any | `npm run agent` / `node agents/earthlink-agent.mjs` |

Always-on: systemd (Linux), launchd (macOS), Task Scheduler / NSSM (Windows) — see [docs/AGENTS.md](../docs/AGENTS.md).
