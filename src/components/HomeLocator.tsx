import { useEffect } from "react";
import { useConnectionStore } from "@/lib/connection-store";
import {
  resolveHomeLocation,
  saveCachedHome,
  type ResolvedHome,
} from "@/lib/home-location";
import { DEFAULT_HOME } from "@/lib/locations";

/** Resolves browser/client home when not in real-server mode. */
export function HomeLocator() {
  const setHome = useConnectionStore((s) => s.setHome);
  const setHomeReady = useConnectionStore((s) => s.setHomeReady);

  useEffect(() => {
    let cancelled = false;

    const apply = (home: ResolvedHome) => {
      if (cancelled) return;
      // Don't clobber the server pin once real traffic agent owns home
      const mode = useConnectionStore.getState().mode;
      if (mode === "real") return;
      setHome({
        lat: home.lat,
        lon: home.lon,
        label: home.label,
        source: home.source,
        city: home.city,
        region: home.region,
        country: home.country,
        ip: home.ip,
        accuracyM: home.accuracyM,
      });
    };

    (async () => {
      try {
        // Brief wait so the traffic agent can claim home first if available
        await new Promise((r) => setTimeout(r, 400));
        if (cancelled) return;
        if (useConnectionStore.getState().mode === "real") return;

        const result = await resolveHomeLocation({
          preferGps: true,
          onUpdate: apply,
        });
        if (cancelled) return;
        if (useConnectionStore.getState().mode === "real") return;
        if (!result) {
          setHome({
            lat: DEFAULT_HOME.lat,
            lon: DEFAULT_HOME.lon,
            label: "San Francisco (fallback)",
            source: "default",
          });
          setHomeReady(true);
        }
      } catch {
        if (cancelled) return;
        if (useConnectionStore.getState().mode === "real") return;
        setHome({
          lat: DEFAULT_HOME.lat,
          lon: DEFAULT_HOME.lon,
          label: "San Francisco (fallback)",
          source: "default",
        });
        setHomeReady(true);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [setHome, setHomeReady]);

  return null;
}

export async function refreshHomeLocation(
  setHome: (h: {
    lat: number;
    lon: number;
    label?: string;
    source?: ResolvedHome["source"];
    city?: string;
    region?: string;
    country?: string;
    ip?: string;
    accuracyM?: number;
  }) => void,
  opts?: { gpsOnly?: boolean },
): Promise<void> {
  if (opts?.gpsOnly) {
    const { resolveHomeFromGps } = await import("@/lib/home-location");
    const gps = await resolveHomeFromGps();
    if (gps) {
      setHome({
        lat: gps.lat,
        lon: gps.lon,
        label: gps.label,
        source: "geo",
        accuracyM: gps.accuracyM,
      });
      saveCachedHome(gps);
    }
    return;
  }

  await resolveHomeLocation({
    preferGps: true,
    onUpdate: (home) => {
      setHome({
        lat: home.lat,
        lon: home.lon,
        label: home.label,
        source: home.source,
        city: home.city,
        region: home.region,
        country: home.country,
        ip: home.ip,
        accuracyM: home.accuracyM,
      });
    },
  });
}
