import { NextRequest, NextResponse } from "next/server";

async function geocode(query: string): Promise<{ lat: number; lon: number } | null> {
  const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query + ", Malaysia")}&format=json&limit=1`;
  const res = await fetch(url, {
    headers: { "User-Agent": "NixScript-ClaimSystem/1.0" },
  });
  if (!res.ok) return null;
  const data = await res.json();
  if (!data[0]) return null;
  return { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
}

async function getRoadDistanceKm(
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<number | null> {
  const url = `https://router.project-osrm.org/route/v1/driving/${from.lon},${from.lat};${to.lon},${to.lat}?overview=false`;
  const res = await fetch(url);
  if (!res.ok) return null;
  const data = await res.json();
  const meters = data?.routes?.[0]?.distance;
  if (!meters) return null;
  return Math.round((meters / 1000) * 10) / 10; // 1 decimal place
}

export async function POST(req: NextRequest) {
  try {
    const { from, to } = await req.json();
    if (!from?.trim() || !to?.trim()) {
      return NextResponse.json({ error: "from and to are required" }, { status: 400 });
    }

    const [fromCoords, toCoords] = await Promise.all([geocode(from), geocode(to)]);

    if (!fromCoords) return NextResponse.json({ error: `Could not find: "${from}"` }, { status: 422 });
    if (!toCoords)   return NextResponse.json({ error: `Could not find: "${to}"` }, { status: 422 });

    const distanceKm = await getRoadDistanceKm(fromCoords, toCoords);
    if (distanceKm === null) {
      return NextResponse.json({ error: "Could not calculate road distance" }, { status: 422 });
    }

    return NextResponse.json({ distanceKm });
  } catch {
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
