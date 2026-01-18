import { NextResponse } from "next/server";

type GeocodeRequest = {
  query: string;
  limit?: number;
};

type NominatimResult = {
  lat: string;
  lon: string;
  display_name: string;
};

export const runtime = "nodejs";

export async function POST(request: Request) {
  let payload: GeocodeRequest;
  try {
    payload = (await request.json()) as GeocodeRequest;
  } catch {
    return NextResponse.json({ status: "error", error: "invalid_json" }, { status: 400 });
  }

  if (!payload?.query) {
    return NextResponse.json({ status: "error", error: "missing_query" }, { status: 400 });
  }

  const limit = Math.min(8, Math.max(1, payload.limit ?? 5));

  try {
    const url = new URL("https://nominatim.openstreetmap.org/search");
    url.searchParams.set("format", "jsonv2");
    url.searchParams.set("q", payload.query);
    url.searchParams.set("limit", limit.toString());
    url.searchParams.set("addressdetails", "0");

    const response = await fetch(url.toString(), {
      headers: {
        "User-Agent": "HyperVision/1.0 (navigation@hypervision.local)",
        "Accept-Language": "en"
      }
    });

    if (!response.ok) {
      return NextResponse.json({ status: "error", error: "geocode_failed" }, { status: 502 });
    }

    const data = (await response.json()) as NominatimResult[];
    const results = data.map((item) => ({
      lat: Number(item.lat),
      lon: Number(item.lon),
      label: item.display_name
    }));

    return NextResponse.json({ status: "ok", results });
  } catch {
    return NextResponse.json({ status: "error", error: "request_failed" }, { status: 502 });
  }
}
