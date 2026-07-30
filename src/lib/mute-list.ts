/** Persist which peer IPs are muted (hidden from globe + feed). */

export type MutedPeer = {
  ip: string;
  /** When true, hide this IP from globe/list/events/sound */
  enabled: boolean;
  label?: string;
  note?: string;
  addedAt: number;
};

const STORAGE_KEY = "earthlink-muted-peers-v1";

export function loadMutedPeers(): MutedPeer[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as MutedPeer[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((p) => p && typeof p.ip === "string" && p.ip.length > 0)
      .map((p) => ({
        ip: p.ip.trim(),
        enabled: p.enabled !== false,
        label: p.label,
        note: p.note,
        addedAt: p.addedAt ?? Date.now(),
      }));
  } catch {
    return [];
  }
}

export function saveMutedPeers(peers: MutedPeer[]) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(peers));
  } catch {
    // quota / private mode
  }
}

export function isIpMuted(ip: string, peers: MutedPeer[]): boolean {
  const hit = peers.find((p) => p.ip === ip);
  return Boolean(hit?.enabled);
}

/** Normalize user input — trim, strip brackets/CIDR for simple single IPs */
export function normalizeIpInput(raw: string): string | null {
  let s = raw.trim();
  if (!s) return null;
  if (s.startsWith("[") && s.includes("]")) {
    s = s.slice(1, s.indexOf("]"));
  }
  // strip /cidr if present
  if (s.includes("/")) s = s.split("/")[0]!;
  // basic IPv4 or IPv6-ish
  if (!/^[\da-fA-F:.]+$/.test(s)) return null;
  if (s.includes(".") && !/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) return null;
  return s;
}
