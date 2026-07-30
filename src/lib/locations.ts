export type City = {
  name: string;
  country: string;
  lat: number;
  lon: number;
  weight?: number;
};

/** Curated remote endpoints that look like real internet traffic. */
export const REMOTE_CITIES: City[] = [
  { name: "Ashburn", country: "US", lat: 39.0438, lon: -77.4874, weight: 3 },
  { name: "New York", country: "US", lat: 40.7128, lon: -74.006, weight: 3 },
  { name: "Los Angeles", country: "US", lat: 34.0522, lon: -118.2437, weight: 2 },
  { name: "Chicago", country: "US", lat: 41.8781, lon: -87.6298, weight: 2 },
  { name: "Dallas", country: "US", lat: 32.7767, lon: -96.797, weight: 2 },
  { name: "Seattle", country: "US", lat: 47.6062, lon: -122.3321, weight: 2 },
  { name: "Miami", country: "US", lat: 25.7617, lon: -80.1918, weight: 1 },
  { name: "Toronto", country: "CA", lat: 43.6532, lon: -79.3832, weight: 2 },
  { name: "São Paulo", country: "BR", lat: -23.5505, lon: -46.6333, weight: 2 },
  { name: "Buenos Aires", country: "AR", lat: -34.6037, lon: -58.3816, weight: 1 },
  { name: "London", country: "GB", lat: 51.5074, lon: -0.1278, weight: 3 },
  { name: "Amsterdam", country: "NL", lat: 52.3676, lon: 4.9041, weight: 3 },
  { name: "Frankfurt", country: "DE", lat: 50.1109, lon: 8.6821, weight: 3 },
  { name: "Paris", country: "FR", lat: 48.8566, lon: 2.3522, weight: 2 },
  { name: "Madrid", country: "ES", lat: 40.4168, lon: -3.7038, weight: 1 },
  { name: "Stockholm", country: "SE", lat: 59.3293, lon: 18.0686, weight: 1 },
  { name: "Zurich", country: "CH", lat: 47.3769, lon: 8.5417, weight: 1 },
  { name: "Dublin", country: "IE", lat: 53.3498, lon: -6.2603, weight: 2 },
  { name: "Warsaw", country: "PL", lat: 52.2297, lon: 21.0122, weight: 1 },
  { name: "Moscow", country: "RU", lat: 55.7558, lon: 37.6173, weight: 1 },
  { name: "Istanbul", country: "TR", lat: 41.0082, lon: 28.9784, weight: 1 },
  { name: "Dubai", country: "AE", lat: 25.2048, lon: 55.2708, weight: 2 },
  { name: "Mumbai", country: "IN", lat: 19.076, lon: 72.8777, weight: 2 },
  { name: "Bangalore", country: "IN", lat: 12.9716, lon: 77.5946, weight: 2 },
  { name: "Singapore", country: "SG", lat: 1.3521, lon: 103.8198, weight: 3 },
  { name: "Hong Kong", country: "HK", lat: 22.3193, lon: 114.1694, weight: 2 },
  { name: "Tokyo", country: "JP", lat: 35.6762, lon: 139.6503, weight: 3 },
  { name: "Osaka", country: "JP", lat: 34.6937, lon: 135.5023, weight: 1 },
  { name: "Seoul", country: "KR", lat: 37.5665, lon: 126.978, weight: 2 },
  { name: "Sydney", country: "AU", lat: -33.8688, lon: 151.2093, weight: 2 },
  { name: "Melbourne", country: "AU", lat: -37.8136, lon: 144.9631, weight: 1 },
  { name: "Auckland", country: "NZ", lat: -36.8485, lon: 174.7633, weight: 1 },
  { name: "Johannesburg", country: "ZA", lat: -26.2041, lon: 28.0473, weight: 1 },
  { name: "Lagos", country: "NG", lat: 6.5244, lon: 3.3792, weight: 1 },
  { name: "Cairo", country: "EG", lat: 30.0444, lon: 31.2357, weight: 1 },
  { name: "Tel Aviv", country: "IL", lat: 32.0853, lon: 34.7818, weight: 1 },
  { name: "Mexico City", country: "MX", lat: 19.4326, lon: -99.1332, weight: 1 },
  { name: "Santiago", country: "CL", lat: -33.4489, lon: -70.6693, weight: 1 },
  { name: "Beijing", country: "CN", lat: 39.9042, lon: 116.4074, weight: 2 },
  { name: "Shanghai", country: "CN", lat: 31.2304, lon: 121.4737, weight: 2 },
  { name: "Jakarta", country: "ID", lat: -6.2088, lon: 106.8456, weight: 1 },
  { name: "Bangkok", country: "TH", lat: 13.7563, lon: 100.5018, weight: 1 },
  { name: "Taipei", country: "TW", lat: 25.033, lon: 121.5654, weight: 1 },
  { name: "Vancouver", country: "CA", lat: 49.2827, lon: -123.1207, weight: 1 },
  { name: "Lisbon", country: "PT", lat: 38.7223, lon: -9.1393, weight: 1 },
];

export const DEFAULT_HOME: City = {
  name: "Your machine",
  country: "Local",
  lat: 37.7749,
  lon: -122.4194,
};

function weightedPick(cities: City[]): City {
  const total = cities.reduce((s, c) => s + (c.weight ?? 1), 0);
  let r = Math.random() * total;
  for (const c of cities) {
    r -= c.weight ?? 1;
    if (r <= 0) return c;
  }
  return cities[cities.length - 1]!;
}

export function randomRemoteCity(exclude?: City): City {
  let city = weightedPick(REMOTE_CITIES);
  if (exclude && city.name === exclude.name && city.country === exclude.country) {
    city = weightedPick(REMOTE_CITIES.filter((c) => c !== city));
  }
  // Small jitter so repeated hits don't stack perfectly
  return {
    ...city,
    lat: city.lat + (Math.random() - 0.5) * 0.4,
    lon: city.lon + (Math.random() - 0.5) * 0.4,
  };
}

export function fakeIp(): string {
  const octets = [
    1 + Math.floor(Math.random() * 223),
    Math.floor(Math.random() * 256),
    Math.floor(Math.random() * 256),
    1 + Math.floor(Math.random() * 254),
  ];
  return octets.join(".");
}

const PROTOCOLS = ["HTTPS", "SSH", "TLS", "QUIC", "DNS", "SMTP", "WS"] as const;
const PORTS: Record<(typeof PROTOCOLS)[number], number[]> = {
  HTTPS: [443, 8443],
  SSH: [22],
  TLS: [443, 993, 995],
  QUIC: [443, 784],
  DNS: [53],
  SMTP: [25, 587],
  WS: [443, 8080],
};

export function randomProtocol(): {
  protocol: (typeof PROTOCOLS)[number];
  port: number;
} {
  const protocol = PROTOCOLS[Math.floor(Math.random() * PROTOCOLS.length)]!;
  const ports = PORTS[protocol];
  const port = ports[Math.floor(Math.random() * ports.length)]!;
  return { protocol, port };
}
