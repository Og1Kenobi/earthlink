import { useEffect, useRef } from "react";
import { useConnectionStore } from "@/lib/connection-store";

const INTERVALS: Record<"calm" | "normal" | "busy", [number, number]> = {
  calm: [1800, 4200],
  normal: [600, 1800],
  busy: [180, 700],
};

/** Streams simulated remote connections while the app is open. */
export function ConnectionSimulator() {
  const paused = useConnectionStore((s) => s.paused);
  const intensity = useConnectionStore((s) => s.intensity);
  const spawnConnection = useConnectionStore((s) => s.spawnConnection);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    // Seed a few connections so the globe isn't empty on first paint
    const seed = window.setTimeout(() => {
      for (let i = 0; i < 4; i++) {
        window.setTimeout(() => spawnConnection(), i * 280);
      }
    }, 600);
    return () => window.clearTimeout(seed);
  }, [spawnConnection]);

  useEffect(() => {
    if (paused) {
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = null;
      return;
    }

    const schedule = () => {
      const [min, max] = INTERVALS[intensity];
      const delay = min + Math.random() * (max - min);
      timer.current = window.setTimeout(() => {
        spawnConnection();
        // Occasional burst
        if (Math.random() < 0.12) {
          const burst = 1 + Math.floor(Math.random() * 3);
          for (let i = 0; i < burst; i++) {
            window.setTimeout(() => spawnConnection(), 80 + i * 120);
          }
        }
        schedule();
      }, delay);
    };

    schedule();
    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [paused, intensity, spawnConnection]);

  return null;
}
