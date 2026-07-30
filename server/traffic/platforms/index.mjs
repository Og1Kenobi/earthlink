/**
 * OS agent registry — pick the right socket/process reader for this host.
 */
import { platformId, readAllConnections } from "../connections.mjs";
import { loadProcessMap as loadLinuxProcessMap } from "../process.mjs";
import { loadDarwinProcessMap } from "./darwin.mjs";
import { loadWin32ProcessMap } from "./win32.mjs";

export { platformId, readAllConnections };

export function osLabel(id = platformId()) {
  if (id === "macos" || id === "darwin") return "macOS";
  if (id === "windows" || id === "win32") return "Windows";
  if (id === "linux") return "Linux";
  return id;
}

export async function loadProcessMapForPlatform() {
  const p = process.platform;
  if (p === "darwin") {
    try {
      return await loadDarwinProcessMap();
    } catch {
      return new Map();
    }
  }
  if (p === "win32") {
    try {
      return await loadWin32ProcessMap();
    } catch {
      return new Map();
    }
  }
  return loadLinuxProcessMap();
}

export function agentMeta() {
  return {
    os: platformId(),
    osLabel: osLabel(),
    platform: process.platform,
    arch: process.arch,
    node: process.version,
    hostname: process.env.EARTHLINK_HOSTNAME || process.env.COMPUTERNAME || process.env.HOSTNAME || undefined,
  };
}
