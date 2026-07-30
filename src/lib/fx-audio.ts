/** Tiny WebAudio stingers for new connections — no asset files. */

let ctx: AudioContext | null = null;
let enabled = true;

export function setFxAudioEnabled(on: boolean) {
  enabled = on;
}

function getCtx(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
  }
  return ctx;
}

export function resumeFxAudio() {
  const c = getCtx();
  if (c?.state === "suspended") void c.resume();
}

/** Soft blip — inbound = higher, outbound = lower, special protos tweak. */
export function playConnectionBlip(
  direction: "inbound" | "outbound",
  protocol?: string,
) {
  if (!enabled) return;
  const c = getCtx();
  if (!c) return;
  if (c.state === "suspended") void c.resume();

  const t0 = c.currentTime;
  const osc = c.createOscillator();
  const gain = c.createGain();
  const filt = c.createBiquadFilter();
  filt.type = "lowpass";
  filt.frequency.value = 2400;

  const p = (protocol || "").toUpperCase();
  let f = direction === "inbound" ? 660 : 420;
  if (p.includes("DNS")) f = 880;
  else if (p.includes("PING") || p.includes("ICMP")) f = 520;
  else if (p.includes("SSH")) f = 300;
  else if (p.includes("HTTPS") || p.includes("HTTP")) f = direction === "inbound" ? 540 : 360;

  osc.type = "triangle";
  osc.frequency.setValueAtTime(f, t0);
  osc.frequency.exponentialRampToValueAtTime(f * 0.55, t0 + 0.12);

  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(0.045, t0 + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.16);

  osc.connect(filt);
  filt.connect(gain);
  gain.connect(c.destination);
  osc.start(t0);
  osc.stop(t0 + 0.18);
}
