// Admin "add a place by clicking it on Google Maps".
//
// The admin clicks a POI on the map, the client sends us only that place_id,
// and this function does the privileged work: fetch Place Details with the
// server key, re-host the photos, score it, and insert it. The Google server
// key never reaches the browser.
//
// The normalization deliberately MIRRORS scripts/sync-google-places.mjs — a
// place added here must be indistinguishable from one the monthly sync would
// have produced, or the two sources drift and the quality gates stop meaning
// the same thing. languageCode=ar&regionCode=SA is REQUIRED: without it
// Google returns English names and hours, which previously poisoned rows.
import { createClient } from "npm:@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}

const ATMOSPHERE = "outdoorSeating,goodForChildren,goodForGroups,menuForChildren,servesBreakfast";
const DETAIL_MASK = [
  "id", "displayName", "formattedAddress", "location", "types", "primaryType",
  "businessStatus", "photos", "rating", "userRatingCount",
  "regularOpeningHours", "currentOpeningHours", "websiteUri", "nationalPhoneNumber",
  ATMOSPHERE,
].join(",");

const MAX_PHOTOS = 3;
const PHOTO_WIDTH = 800;
// Same 7km gate the sync uses: Google's locationBias is a bias, not a
// restriction, so a mis-tap far outside Riyadh must not silently enter.
const SERVED_RADIUS_KM = 7;
const RIYADH = { lat: 24.7136, lng: 46.6753 };

const DISTRICTS = [
  { name: "العليا", lat: 24.6939, lng: 46.6852 }, { name: "حي السفارات", lat: 24.6877, lng: 46.6219 },
  { name: "الملقا", lat: 24.7944, lng: 46.6243 }, { name: "النخيل", lat: 24.7569, lng: 46.6309 },
  { name: "الورود", lat: 24.7244, lng: 46.6634 }, { name: "الياسمين", lat: 24.8240, lng: 46.6480 },
  { name: "غرناطة", lat: 24.7659, lng: 46.7470 }, { name: "الملز", lat: 24.6685, lng: 46.7351 },
  { name: "الربوة", lat: 24.7058, lng: 46.7251 }, { name: "قرطبة", lat: 24.7754, lng: 46.7587 },
  { name: "حطين", lat: 24.7743, lng: 46.5972 }, { name: "الصحافة", lat: 24.8135, lng: 46.6355 },
  { name: "النرجس", lat: 24.8608, lng: 46.6467 }, { name: "القيروان", lat: 24.8355, lng: 46.5766 },
  { name: "العارض", lat: 24.9350, lng: 46.6431 }, { name: "الدرعية", lat: 24.7370, lng: 46.5760 },
  { name: "الروضة", lat: 24.7208, lng: 46.7908 }, { name: "النسيم", lat: 24.7150, lng: 46.8330 },
  { name: "الحمراء", lat: 24.7702, lng: 46.8017 }, { name: "الريان", lat: 24.6912, lng: 46.7767 },
  { name: "البطحاء", lat: 24.6300, lng: 46.7150 }, { name: "الشفا", lat: 24.5537, lng: 46.7003 },
  { name: "العزيزية", lat: 24.5623, lng: 46.7758 }, { name: "السويدي", lat: 24.6019, lng: 46.6764 },
  { name: "ظهرة لبن", lat: 24.6280, lng: 46.5510 }, { name: "عرقة", lat: 24.6800, lng: 46.5750 },
];

function nearestDistrict(lat: number, lng: number) {
  let best = DISTRICTS[0], bestD = Infinity;
  for (const d of DISTRICTS) {
    const dist = ((d.lat - lat) * 111) ** 2 + ((d.lng - lng) * 98) ** 2;
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return { name: best.name, distKm: Math.sqrt(bestD) };
}

function kmFromCenter(lat: number, lng: number) {
  return Math.sqrt(((RIYADH.lat - lat) * 111) ** 2 + ((RIYADH.lng - lng) * 98) ** 2);
}

type G = Record<string, any>;

function mapType(p: G): "كافيه" | "مطعم" {
  const primary = p.primaryType;
  if (primary === "cafe" || primary === "coffee_shop" || primary === "tea_house") return "كافيه";
  if (primary && primary !== "restaurant") {
    if ((p.types ?? []).some((t: string) => t === "cafe" || t === "coffee_shop" || t === "tea_house")) return "كافيه";
  }
  if ((p.types ?? []).some((t: string) => t === "cafe" || t === "coffee_shop" || t === "tea_house")) return "كافيه";
  return "مطعم";
}

function mapHours(p: G): string {
  const lines = p.regularOpeningHours?.weekdayDescriptions;
  return Array.isArray(lines) && lines.length ? lines.join("\n") : "";
}

function mapIsOpen(p: G): boolean {
  if (p.businessStatus === "CLOSED_PERMANENTLY" || p.businessStatus === "CLOSED_TEMPORARILY") return false;
  if (typeof p.currentOpeningHours?.openNow === "boolean") return p.currentOpeningHours.openNow;
  return true;
}

// Same scoring as lib/quality.ts and the sync — kept in sync by hand.
function computeQuality(input: {
  name: string; rating: number | null; reviews: number | null;
  photoCount: number; hasHours: boolean; hasContact: boolean; hasGeo: boolean;
}) {
  const flags: string[] = [];
  let score = 0;
  const reviews = input.reviews ?? 0;
  if (reviews >= 200) score += 25; else if (reviews >= 50) score += 20;
  else if (reviews >= 10) score += 12; else if (reviews >= 3) score += 6;
  else flags.push("very_few_reviews");

  const rating = input.rating ?? 0;
  if (rating >= 5 && reviews < 10) { flags.push("perfect_rating_low_sample"); }
  else if (rating >= 4.0) score += 15;
  else if (rating >= 3.0) score += 10;
  else if (rating > 0) score += 4;

  if (input.photoCount >= 3) score += 15; else if (input.photoCount > 0) score += 8;
  else flags.push("no_photo");
  if (input.hasHours) score += 10; else flags.push("no_hours");
  if (input.hasContact) score += 10; else flags.push("no_contact");
  if (input.hasGeo) score += 10;
  if (!input.name.trim()) flags.push("no_name");

  const status = flags.includes("no_name") ? "quarantined"
    : score >= 60 && !flags.includes("perfect_rating_low_sample") ? "published"
    : "search_only";
  return { score, flags, status };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);

  const url = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const googleKey = Deno.env.get("GOOGLE_PLACES_API_KEY");
  if (!googleKey) return json({ error: "missing_google_key" }, 500);

  // --- admin only ---
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) return json({ error: "unauthenticated" }, 401);
  const asUser = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } }, auth: { persistSession: false },
  });
  const { data: ures } = await asUser.auth.getUser();
  const uid = ures?.user?.id;
  if (!uid) return json({ error: "unauthenticated" }, 401);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: prof } = await admin.from("profiles").select("role").eq("id", uid).maybeSingle();
  if (prof?.role !== "admin") return json({ error: "forbidden" }, 403);

  const body = await req.json().catch(() => ({}));
  const placeId = String(body?.placeId ?? "").trim();
  const preview = body?.preview === true;
  if (!placeId) return json({ error: "missing_place_id" }, 400);

  // --- already in the catalog? ---
  const { data: existing } = await admin
    .from("places").select("id, name, status").eq("google_place_id", placeId).maybeSingle();
  if (existing && !preview) return json({ error: "duplicate", place: existing }, 409);

  // --- Google Place Details (ar/SA is mandatory, see header comment) ---
  const res = await fetch(
    `https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}?languageCode=ar&regionCode=SA`,
    { headers: { "X-Goog-Api-Key": googleKey, "X-Goog-FieldMask": DETAIL_MASK } },
  );
  if (!res.ok) {
    const detail = await res.text();
    return json({ error: "google_lookup_failed", status: res.status, detail: detail.slice(0, 300) }, 502);
  }
  const p: G = await res.json();

  const lat = p.location?.latitude, lng = p.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") return json({ error: "no_location" }, 422);

  const distKm = kmFromCenter(lat, lng);
  const outsideArea = distKm > SERVED_RADIUS_KM * 4; // generous: whole metro
  const district = nearestDistrict(lat, lng);
  const name = p.displayName?.text ?? "";
  const nameEn = /^[\x00-\x7F\s]+$/.test(name) ? name : "";

  // Preview: everything except photos (which cost money to fetch) and the write.
  if (preview) {
    return json({
      preview: true,
      alreadyExists: existing ?? null,
      outsideArea,
      distanceKm: Math.round(distKm * 10) / 10,
      place: {
        googlePlaceId: p.id ?? placeId,
        name, nameEn,
        type: mapType(p),
        district: district.name,
        address: p.formattedAddress ?? "",
        rating: typeof p.rating === "number" ? p.rating : null,
        reviewCount: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
        photoCount: (p.photos ?? []).length,
        hasHours: !!mapHours(p),
        website: p.websiteUri ?? null,
        phone: p.nationalPhoneNumber ?? null,
        businessStatus: p.businessStatus ?? null,
        isOpen: mapIsOpen(p),
      },
    });
  }

  // --- re-host photos (Google forbids hot-linking their media URLs) ---
  const photoUrls: string[] = [];
  for (const photo of (p.photos ?? []).slice(0, MAX_PHOTOS)) {
    try {
      const media = await fetch(
        `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=${PHOTO_WIDTH}&key=${googleKey}`,
      );
      if (!media.ok) continue;
      const bytes = new Uint8Array(await media.arrayBuffer());
      const path = `google/${placeId}/${photoUrls.length}.jpg`;
      const { error } = await admin.storage.from("place-photos")
        .upload(path, bytes, { contentType: "image/jpeg", upsert: true });
      if (error) continue;
      photoUrls.push(admin.storage.from("place-photos").getPublicUrl(path).data.publicUrl);
    } catch { /* a failed photo must not fail the import */ }
  }

  const quality = computeQuality({
    name,
    rating: typeof p.rating === "number" ? p.rating : null,
    reviews: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    photoCount: photoUrls.length,
    hasHours: !!mapHours(p),
    hasContact: !!(p.websiteUri || p.nationalPhoneNumber),
    hasGeo: true,
  });

  const row = {
    name,
    name_en: nameEn,
    type: mapType(p),
    category: "",
    district: district.name,
    address: p.formattedAddress ?? "",
    image: photoUrls[0] ?? "",
    images: photoUrls,
    latitude: lat,
    longitude: lng,
    opening_hours: mapHours(p),
    is_open: mapIsOpen(p),
    description: "",
    tags: p.servesBreakfast === true ? ["فطور"] : [],
    is_new: true,
    is_verified: false,
    source: "google",
    google_place_id: placeId,
    google_rating: typeof p.rating === "number" ? p.rating : null,
    google_review_count: typeof p.userRatingCount === "number" ? p.userRatingCount : null,
    google_synced_at: new Date().toISOString(),
    website: p.websiteUri ?? null,
    phone: p.nationalPhoneNumber ?? null,
    quality_score: quality.score,
    quality_flags: quality.flags,
    status: quality.status,
    has_outdoor_seating: p.outdoorSeating === true,
    is_family_friendly: p.goodForChildren === true || p.goodForGroups === true,
    is_kids_friendly: p.goodForChildren === true || p.menuForChildren === true,
  };

  const { data: inserted, error: insErr } = await admin.from("places").insert(row).select().single();
  if (insErr) {
    // 23505 = someone imported the same place a moment ago
    if (insErr.code === "23505") return json({ error: "duplicate" }, 409);
    return json({ error: "insert_failed", detail: insErr.message }, 500);
  }

  await admin.from("audit_log").insert({
    actor_id: uid, action: "place_create", target_table: "places", target_id: inserted.id,
    detail: `إضافة من خريطة قوقل: ${name} · ${district.name} · جودة ${quality.score}`,
  });

  return json({ ok: true, place: inserted, photosStored: photoUrls.length, quality });
});
