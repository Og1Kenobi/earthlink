import { createFileRoute, ClientOnly } from "@tanstack/react-router";
import { EarthScene } from "@/components/globe/EarthScene";
import { Hud } from "@/components/Hud";
import { TrafficFeed } from "@/components/TrafficFeed";
import { HomeLocator } from "@/components/HomeLocator";

export const Route = createFileRoute("/")({
  component: HomePage,
});

function HomePage() {
  return (
    <main className="relative h-dvh w-full overflow-hidden bg-bg">
      <ClientOnly
        fallback={
          <div className="flex h-full w-full items-center justify-center">
            <p className="font-mono text-sm text-muted">Booting globe…</p>
          </div>
        }
      >
        <EarthScene />
        <HomeLocator />
        <TrafficFeed />
      </ClientOnly>
      <Hud />
    </main>
  );
}
