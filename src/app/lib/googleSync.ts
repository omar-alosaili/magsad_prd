import { supabase } from "./supabase";
import { invalidatePlacesCache } from "./places";
import { computeQualityScore } from "./quality";
import { logAdminAction } from "./admin";

// ---- The admin "Google Maps Updates" workflow ----
// Scans (edge function or the monthly script) PROPOSE rows into
// place_updates; nothing touches places until an admin decides here.

export type PlaceUpdate = {
  id: string;
  googlePlaceId: string;
  placeId: string | null;
  placeName: string | null;
  changeType: "new" | "info" | "rating" | "closed" | "duplicate";
  currentValues: Record<string, unknown> | null;
  proposedValues: Record<string, unknown>;
  diffFields: string[];
  status: "pending" | "approved" | "rejected";
  scannedAt: string;
};

export const CHANGE_TYPE_LABELS: Record<PlaceUpdate["changeType"], string> = {
  new: "مكان جديد",
  info: "بيانات محدّثة",
  rating: "تقييم/مراجعات",
  closed: "مغلق",
  duplicate: "مكرر",
};

const PAGE_SIZE = 25;

export async function getPlaceUpdates(opts: {
  status: "pending" | "approved" | "rejected";
  changeType?: PlaceUpdate["changeType"] | "all";
  query?: string;
  page?: number;
}): Promise<{ rows: PlaceUpdate[]; total: number }> {
  let req = supabase
    .from("place_updates")
    .select("id, google_place_id, place_id, change_type, current_values, proposed_values, diff_fields, status, scanned_at, places(name)", { count: "exact" })
    .eq("status", opts.status)
    .order("scanned_at", { ascending: false });
  if (opts.changeType && opts.changeType !== "all") req = req.eq("change_type", opts.changeType);
  const page = opts.page ?? 0;
  req = req.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);
  const { data, error, count } = await req;
  if (error) throw error;
  let rows = (data as unknown as {
    id: string; google_place_id: string; place_id: string | null; change_type: PlaceUpdate["changeType"];
    current_values: Record<string, unknown> | null; proposed_values: Record<string, unknown>;
    diff_fields: string[]; status: PlaceUpdate["status"]; scanned_at: string; places: { name: string } | null;
  }[]).map(r => ({
    id: r.id,
    googlePlaceId: r.google_place_id,
    placeId: r.place_id,
    placeName: r.places?.name ?? (r.proposed_values?.name as string | undefined) ?? null,
    changeType: r.change_type,
    currentValues: r.current_values,
    proposedValues: r.proposed_values,
    diffFields: r.diff_fields ?? [],
    status: r.status,
    scannedAt: r.scanned_at,
  }));
  // Name search is client-side within the page window (joined column
  // filtering isn't supported by PostgREST or() on embedded resources).
  if (opts.query?.trim()) {
    const q = opts.query.trim();
    rows = rows.filter(r => (r.placeName ?? "").includes(q));
  }
  return { rows, total: count ?? 0 };
}

export async function getPendingCounts(): Promise<Record<string, number>> {
  const { data, error } = await supabase
    .from("place_updates").select("change_type").eq("status", "pending");
  if (error) throw error;
  const counts: Record<string, number> = { all: data.length };
  for (const r of data as { change_type: string }[]) {
    counts[r.change_type] = (counts[r.change_type] ?? 0) + 1;
  }
  return counts;
}

async function markDecided(id: string, status: "approved" | "rejected", actorId: string): Promise<void> {
  const { error } = await supabase
    .from("place_updates")
    .update({ status, decided_by: actorId, decided_at: new Date().toISOString() })
    .eq("id", id).eq("status", "pending");
  if (error) throw error;
}

// Apply an APPROVED update to the places table (admin RLS). Each change
// type maps to a concrete, reviewable mutation; audit_log records it.
export async function approvePlaceUpdate(u: PlaceUpdate, actorId: string): Promise<void> {
  if (u.changeType === "new") {
    const p = u.proposedValues as Record<string, never>;
    const { error } = await supabase.from("places").insert(p);
    if (error && error.code !== "23505") throw error; // already added → treat as done
  } else if (u.changeType === "closed") {
    const next = (u.proposedValues.status as string) === "search_only" ? "search_only" : "retired";
    const { error } = await supabase.from("places").update({ status: next }).eq("id", u.placeId!);
    if (error) throw error;
  } else if (u.changeType === "duplicate") {
    const { error } = await supabase.from("places").update({ status: "retired" }).eq("id", u.placeId!);
    if (error) throw error;
  } else {
    // info / rating: apply proposed fields, then recompute the quality
    // score against the freshly-applied values.
    const patch: Record<string, unknown> = {};
    for (const f of u.diffFields) {
      if (f === "location") {
        const loc = u.proposedValues.location as { lat: number; lng: number };
        patch.latitude = loc.lat; patch.longitude = loc.lng;
      } else if (f in u.proposedValues) {
        patch[f] = u.proposedValues[f];
      }
    }
    const { data: row, error: readErr } = await supabase
      .from("places")
      .select("name, google_rating, google_review_count, images, opening_hours, website, phone, quality_flags")
      .eq("id", u.placeId!).single();
    if (readErr) throw readErr;
    const merged = { ...row, ...patch } as typeof row & Record<string, unknown>;
    const q = computeQualityScore({
      name: (merged.name as string) ?? "",
      googleRating: (merged.google_rating as number | null) ?? null,
      googleReviewCount: (merged.google_review_count as number | null) ?? null,
      photoCount: ((merged.images as string[]) ?? []).length,
      hasHours: !!(merged.opening_hours as string),
      hasContact: !!(merged.website || merged.phone),
      existingFlags: (merged.quality_flags as string[]) ?? [],
    });
    patch.quality_score = q.score;
    patch.quality_flags = q.flags;
    patch.google_synced_at = new Date().toISOString();
    const { error } = await supabase.from("places").update(patch).eq("id", u.placeId!);
    if (error) throw error;
  }
  await markDecided(u.id, "approved", actorId);
  await logAdminAction(actorId, "sync_approve", "place_updates", u.id,
    `${CHANGE_TYPE_LABELS[u.changeType]} · ${u.placeName ?? u.googlePlaceId} · ${u.diffFields.join(",")}`);
  invalidatePlacesCache();
}

export async function rejectPlaceUpdate(u: PlaceUpdate, actorId: string): Promise<void> {
  await markDecided(u.id, "rejected", actorId);
  await logAdminAction(actorId, "sync_reject", "place_updates", u.id,
    `${CHANGE_TYPE_LABELS[u.changeType]} · ${u.placeName ?? u.googlePlaceId}`);
}

// "Approve all confirmed changes" = the low-risk class only: rating /
// review-count refreshes. Everything else stays a per-row decision.
export async function approveAllRatingUpdates(actorId: string, onProgress?: (done: number, total: number) => void): Promise<number> {
  let done = 0;
  for (;;) {
    const { rows } = await getPlaceUpdates({ status: "pending", changeType: "rating", page: 0 });
    if (!rows.length) break;
    for (const u of rows) {
      await approvePlaceUpdate(u, actorId);
      done++;
      onProgress?.(done, done + rows.length);
    }
  }
  return done;
}

export const HIGH_SIGNAL_MIN_REVIEWS = 1000;

// The no-brainer tier of NEW-place proposals: 1,000+ Google reviews is an
// unfakeable signal for a real, established venue. Collect the full set
// FIRST (statuses shift as approvals land, so paging while approving
// would skip rows), then approve through the same per-row path.
// JSONB numeric filters string-compare in PostgREST — filter client-side.
export async function collectHighSignalNewPlaces(minReviews = HIGH_SIGNAL_MIN_REVIEWS): Promise<PlaceUpdate[]> {
  const eligible: PlaceUpdate[] = [];
  for (let page = 0; ; page++) {
    const { rows, total } = await getPlaceUpdates({ status: "pending", changeType: "new", page });
    eligible.push(...rows.filter(u => Number(u.proposedValues.google_review_count ?? 0) >= minReviews));
    if (!rows.length || (page + 1) * PAGE_SIZE >= total) break;
  }
  return eligible;
}

// Sequential on purpose: each approval inserts + audits; parallel bursts
// would hammer PostgREST and interleave audit rows. One failure doesn't
// abort the batch — the caller reports done/failed.
export async function approveNewPlacesBulk(
  updates: PlaceUpdate[],
  actorId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<{ done: number; failed: number }> {
  let done = 0, failed = 0;
  for (const u of updates) {
    try { await approvePlaceUpdate(u, actorId); done++; }
    catch { failed++; }
    onProgress?.(done + failed, updates.length);
  }
  return { done, failed };
}

// Run the on-demand scan: walk the catalog in batches via the edge
// function, then finalize (duplicate detection).
export async function runPlaceScan(
  onProgress: (p: { scanned: number; total: number; changes: number; apiCalls: number }) => void,
): Promise<{ scanned: number; changes: number; apiCalls: number; duplicates: number }> {
  const scanRunId = `scan_${Date.now()}`;
  let cursor = 0, changes = 0, apiCalls = 0, total = 0;
  for (;;) {
    const { data, error } = await supabase.functions.invoke("place-scan", {
      body: { cursor, scanRunId, batchSize: 120 },
    });
    if (error) throw error;
    if (data.error) throw new Error(data.error);
    cursor = data.cursor; total = data.total; changes += data.changes; apiCalls += data.apiCalls;
    onProgress({ scanned: cursor, total, changes, apiCalls });
    if (data.done) break;
  }
  const { data: fin, error: finErr } = await supabase.functions.invoke("place-scan", {
    body: { finalize: true, scanRunId },
  });
  if (finErr) throw finErr;
  return { scanned: cursor, changes, apiCalls, duplicates: fin?.duplicatesProposed ?? 0 };
}

// ---------- Admin: add a place by clicking it on Google Maps ----------

export type MapPickPreview = {
  googlePlaceId: string;
  name: string;
  nameEn: string;
  type: "كافيه" | "مطعم";
  district: string;
  address: string;
  rating: number | null;
  reviewCount: number | null;
  photoCount: number;
  hasHours: boolean;
  website: string | null;
  phone: string | null;
  businessStatus: string | null;
  isOpen: boolean;
};

export type MapPickResult = {
  preview: true;
  place: MapPickPreview;
  alreadyExists: { id: string; name: string; status: string } | null;
  outsideArea: boolean;
  distanceKm: number;
};

// Look up a clicked POI without writing anything. Cheap enough to run on
// every tap: no photo fetches, no insert.
export async function previewMapPlace(placeId: string): Promise<MapPickResult> {
  const { data, error } = await supabase.functions.invoke("place-import", { body: { placeId, preview: true } });
  if (error) throw error;
  if ((data as { error?: string })?.error) throw new Error((data as { error: string }).error);
  return data as MapPickResult;
}

// Commit the import: fetches + re-hosts photos, scores, inserts, audits.
export async function importMapPlace(placeId: string): Promise<{ id: string; name: string; qualityScore: number; status: string }> {
  const { data, error } = await supabase.functions.invoke("place-import", { body: { placeId } });
  if (error) throw error;
  const res = data as { ok?: boolean; error?: string; place?: { id: string; name: string; quality_score: number; status: string } };
  if (res?.error === "duplicate") throw new Error("duplicate");
  if (!res?.ok || !res.place) throw new Error(res?.error ?? "import_failed");
  invalidatePlacesCache();
  return { id: res.place.id, name: res.place.name, qualityScore: res.place.quality_score, status: res.place.status };
}
