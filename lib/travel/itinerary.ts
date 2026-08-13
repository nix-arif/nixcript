export interface TravelJourneyGroup<T> {
  startIdx: number;
  stops: T[];
}

// Groups legs into "journeys". Primarily inferred from the route data itself
// — a leg starts a new journey whenever its origin doesn't pick up where the
// previous leg left off — but a leg explicitly marked `journeyBreak: true`
// (set when the user clicks "Add Separate Journey") always starts a new
// group too, even if its From happens to coincide with the previous leg's
// To (e.g. both are the same home-base default). Without this override, two
// legs that are merely at the same *location* would be wrongly treated as
// one continuous journey.
export function groupTravelJourneys<T extends { fromLocation: string; toLocation: string; journeyBreak?: boolean }>(stops: T[]): TravelJourneyGroup<T>[] {
  if (stops.length === 0) return [];
  const norm = (s: string) => s.trim().toLowerCase();
  const groupStarts: number[] = [];
  stops.forEach((s, i) => {
    const isContinuation = i > 0 && !s.journeyBreak && norm(s.fromLocation) !== "" && norm(s.fromLocation) === norm(stops[i - 1].toLocation);
    if (!isContinuation) groupStarts.push(i);
  });
  return groupStarts.map((start, gi) => {
    const end = gi + 1 < groupStarts.length ? groupStarts[gi + 1] : stops.length;
    return { startIdx: start, stops: stops.slice(start, end) };
  });
}

// Compact single-line summary: each journey's own route chained with "→",
// separate journeys joined with " | " instead — a break between journeys
// isn't a continuation, so it shouldn't read as one connected route.
export function formatTravelItinerary<T extends { fromLocation: string; toLocation: string; journeyBreak?: boolean }>(stops: T[]): string {
  return groupTravelJourneys(stops)
    .map((g) => [g.stops[0].fromLocation, ...g.stops.map((s) => s.toLocation)].join(" → "))
    .join(" | ");
}

function findGroup<T extends { fromLocation: string; toLocation: string }>(
  groups: TravelJourneyGroup<T>[],
  idx: number,
): TravelJourneyGroup<T> | undefined {
  return groups.find((g) => idx >= g.startIdx && idx < g.startIdx + g.stops.length);
}

// A leg "returns" when it arrives back at the origin of its *own* journey —
// matching where "Add Return Leg" actually sends you back to (the current
// journey's start, not necessarily the whole trip's very first origin).
export function isReturnLeg<T extends { fromLocation: string; toLocation: string }>(stops: T[], idx: number): boolean {
  const norm = (s: string) => s.trim().toLowerCase();
  const group = findGroup(groupTravelJourneys(stops), idx);
  if (!group) return false;
  const journeyOrigin = norm(group.stops[0].fromLocation);
  return journeyOrigin !== "" && norm(stops[idx].toLocation) === journeyOrigin;
}

// Contextual label for one leg of an itinerary: within a journey, the first
// leg is "Outbound", any leg that arrives back at that journey's own origin
// is "Return", and everything else is numbered "Stop N". When a trip has
// more than one journey, each leg's label is prefixed "Journey N · " so a
// break in the route is never mislabeled as just another stop.
export function travelLegLabel(stops: { fromLocation: string; toLocation: string }[], idx: number): string {
  const norm = (s: string) => s.trim().toLowerCase();
  const groups = groupTravelJourneys(stops);
  const groupIndex = groups.findIndex((g) => idx >= g.startIdx && idx < g.startIdx + g.stops.length);
  const group = groups[groupIndex];
  const prefix = groups.length > 1 ? `Journey ${groupIndex + 1} · ` : "";

  if (isReturnLeg(stops, idx)) return `${prefix}Return`;
  if (idx === group.startIdx) return `${prefix}Outbound`;

  const journeyOrigin = norm(group.stops[0].fromLocation);
  let n = 0;
  for (let i = group.startIdx + 1; i < idx; i++) {
    const isRet = journeyOrigin !== "" && norm(stops[i].toLocation) === journeyOrigin;
    if (!isRet) n++;
  }
  return `${prefix}Stop ${n + 1}`;
}

// Purpose is per leg, except a Return leg (which just closes the loop back
// to the journey's start) inherits the purpose of the last "real" leg
// before it rather than needing its own.
export function effectiveLegPurpose<T extends { fromLocation: string; toLocation: string; purpose: string }>(
  stops: T[],
  idx: number,
): string {
  if (!isReturnLeg(stops, idx)) return stops[idx].purpose.trim();
  const group = findGroup(groupTravelJourneys(stops), idx);
  if (!group) return "";
  for (let i = idx - 1; i >= group.startIdx; i--) {
    if (!isReturnLeg(stops, i)) return stops[i].purpose.trim();
  }
  return "";
}

// For a compact single-line summary (tables, notifications): every distinct
// purpose across the trip's legs, deduped in order of first appearance.
export function travelPurposesSummary(stops: { purpose: string }[]): string {
  const seen: string[] = [];
  for (const s of stops) {
    const p = s.purpose.trim();
    if (p && !seen.includes(p)) seen.push(p);
  }
  return seen.join(" / ");
}
