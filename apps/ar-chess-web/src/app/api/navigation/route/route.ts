import { NextResponse } from "next/server";

type RouteRequest = {
  start: { lat: number; lon: number };
  end: { lat: number; lon: number };
};

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: [number, number][] };
  legs: Array<{
    steps: Array<{
      distance: number;
      name: string;
      maneuver: {
        type: string;
        modifier?: string;
        location: [number, number];
        bearing_after?: number;
        bearing_before?: number;
        exit?: number;
      };
    }>;
  }>;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: RouteRequest;
  try {
    payload = (await request.json()) as RouteRequest;
  } catch {
    return NextResponse.json({ status: "error", error: "invalid_json" }, { status: 400 });
  }

  if (
    !payload?.start ||
    !payload?.end ||
    !Number.isFinite(payload.start.lat) ||
    !Number.isFinite(payload.start.lon) ||
    !Number.isFinite(payload.end.lat) ||
    !Number.isFinite(payload.end.lon)
  ) {
    return NextResponse.json({ status: "error", error: "invalid_payload" }, { status: 400 });
  }

  const url = new URL(
    `https://router.project-osrm.org/route/v1/foot/${payload.start.lon},${payload.start.lat};${payload.end.lon},${payload.end.lat}`
  );
  url.searchParams.set("overview", "full");
  url.searchParams.set("geometries", "geojson");
  url.searchParams.set("steps", "true");

  try {
    const response = await fetch(url.toString());
    if (!response.ok) {
      return NextResponse.json({ status: "error", error: "routing_failed" }, { status: 502 });
    }
    const data = (await response.json()) as { routes?: OsrmRoute[] };
    const route = data.routes?.[0];
    if (!route) {
      return NextResponse.json({ status: "error", error: "no_route" }, { status: 404 });
    }

    const steps = route.legs?.[0]?.steps ?? [];
    return NextResponse.json({
      status: "ok",
      route: {
        geometry: route.geometry.coordinates,
        steps: steps.map((step) => ({
          distance: step.distance,
          name: step.name,
          maneuver: step.maneuver
        })),
        distance: route.distance,
        duration: route.duration
      }
    });
  } catch {
    return NextResponse.json({ status: "error", error: "request_failed" }, { status: 502 });
  }
}
