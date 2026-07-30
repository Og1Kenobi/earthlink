/** Best-effort sync of mute list with the traffic agent. */

export async function syncMuteToServer(
  action: "mute" | "unmute",
  ip: string,
): Promise<void> {
  try {
    await fetch("/api/traffic/mute", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(
        action === "mute" ? { mute: [ip] } : { unmute: [ip] },
      ),
    });
  } catch {
    // UI mute still works client-side
  }
}

export async function pullServerMutes(): Promise<string[]> {
  try {
    const r = await fetch("/api/traffic/mute");
    if (!r.ok) return [];
    const j = (await r.json()) as { mutedIps?: string[] };
    return j.mutedIps ?? [];
  } catch {
    return [];
  }
}
