// Monthly Google Places sync — Phase-1 architecture (three stages):
//
//   A. DISCOVERY (free): Text Search with an IDs-only field mask — the
//      "Text Search Essentials IDs Only" SKU is unlimited free — sweeps
//      the district grid and diffs against stored google_place_ids.
//   B. ENRICHMENT (paid, tiny volume): one Place Details call per NEW
//      place with the full field mask (incl. atmosphere + website/phone).
//      Expected ~50–150/month — inside the free tier.
//   C. REFRESH (paid, capped): rotates through ~1/3 of the existing
//      catalog per run, oldest-synced first, user-REPORTED places first.
//      Enterprise-tier mask; atmosphere fields join only in Jan/Apr/Jul/
//      Oct (they rarely change and cost the top SKU).
//
// Run `pnpm sync:google-places`, or scheduled via
// .github/workflows/sync-google-places.yml. Standalone Node script.
//
// Env knobs (besides keys): DRY_RUN=1 (no DB writes), LIMIT_DISTRICTS=n,
// MAX_DETAILS=n (cap on billable Place Details calls, default 2000),
// SKIP_DISCOVERY=1, SKIP_REFRESH=1.
//
// Writes only "base facts". Curated editorial fields (category, district
// after insert, work-friendliness, description, links, is_verified,
// owner_id) are never touched after insert. Admin quality decisions
// (quarantined/retired) are never auto-promoted.

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

dotenv.config({ path: ".env.script.local" });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_PLACES_API_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or GOOGLE_PLACES_API_KEY in env.");
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === "1";
// Default is PROPOSE: changes are staged into place_updates for admin
// approval in the "تحديثات قوقل" panel — the database is never modified
// automatically. AUTO_APPLY=1 restores the legacy direct-write behavior.
const AUTO_APPLY = process.env.AUTO_APPLY === "1";
const SCAN_RUN_ID = `sync_${new Date().toISOString().slice(0, 10)}_${process.pid}`;
const LIMIT_DISTRICTS = Number(process.env.LIMIT_DISTRICTS) || Infinity;
const MAX_DETAILS = Number(process.env.MAX_DETAILS) || 2000;
const SKIP_DISCOVERY = process.env.SKIP_DISCOVERY === "1";
const SKIP_REFRESH = process.env.SKIP_REFRESH === "1";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Search centers — Riyadh's well-known commercial districts.
const DISTRICTS = [
  // Center / north-center
  { name: "العليا", lat: 24.6939, lng: 46.6852 },
  { name: "حي السفارات", lat: 24.6877, lng: 46.6219 },
  { name: "الملقا", lat: 24.7944, lng: 46.6243 },
  { name: "النخيل", lat: 24.7569, lng: 46.6309 },
  { name: "الورود", lat: 24.7244, lng: 46.6634 },
  { name: "الياسمين", lat: 24.8240, lng: 46.6480 },
  { name: "غرناطة", lat: 24.7659, lng: 46.7470 },
  { name: "الملز", lat: 24.6685, lng: 46.7351 },
  { name: "الربوة", lat: 24.7058, lng: 46.7251 },
  { name: "قرطبة", lat: 24.7754, lng: 46.7587 },
  // North / north-west
  { name: "حطين", lat: 24.7743, lng: 46.5972 },
  { name: "الصحافة", lat: 24.8135, lng: 46.6355 },
  { name: "النرجس", lat: 24.8608, lng: 46.6467 },
  { name: "القيروان", lat: 24.8355, lng: 46.5766 },
  { name: "العارض", lat: 24.9350, lng: 46.6431 },
  { name: "الدرعية", lat: 24.7370, lng: 46.5760 },
  // East
  { name: "الروضة", lat: 24.7208, lng: 46.7908 },
  { name: "النسيم", lat: 24.7150, lng: 46.8330 },
  { name: "الحمراء", lat: 24.7702, lng: 46.8017 },
  { name: "الريان", lat: 24.6912, lng: 46.7767 },
  // South / old city
  { name: "البطحاء", lat: 24.6300, lng: 46.7150 },
  { name: "الشفا", lat: 24.5537, lng: 46.7003 },
  { name: "العزيزية", lat: 24.5623, lng: 46.7758 },
  { name: "السويدي", lat: 24.6019, lng: 46.6764 },
  // West
  { name: "ظهرة لبن", lat: 24.6280, lng: 46.5510 },
  { name: "عرقة", lat: 24.6800, lng: 46.5750 },
];

// Stage D (opt-in): gap mining — resolve FSQ-only leads to Google
// identities via FREE IDs-only search, then route them through the normal
// enrichment -> quality gate -> admin-approval pipeline.
const GAP_MINE = Number(process.env.GAP_MINE) || 0;

const DISCOVERY_QUERIES = ["مقهى", "مطعم"];
const DISCOVERY_RADIUS_METERS = 2500;
const MAX_PHOTOS_PER_PLACE = 3;
const PHOTO_MAX_WIDTH_PX = 800;

// Per-run API call counters — the cost dashboard for every sync log.
const calls = { textSearchIdsOnly: 0, detailsEnrich: 0, detailsRefresh: 0, photoMedia: 0 };

// Atmosphere fields bill at the top SKU and rarely change — refresh them
// only in Jan/Apr/Jul/Oct. New-place enrichment always includes them.
const ATMOSPHERE_FIELDS = "outdoorSeating,goodForChildren,goodForGroups,menuForChildren,servesBreakfast";
// Months [0,4,8] (period 4) — NOT [0,3,6,9]: the refresh rotation has a
// period of 3 runs, so a period-3 atmosphere cadence would phase-lock to
// one cohort and the other two thirds of the catalog would never get an
// atmosphere refresh. Period 4 walks all three cohorts across the year.
const QUARTERLY_ATMOSPHERE = [0, 4, 8].includes(new Date().getMonth());

const ENRICH_MASK = [
  "id", "displayName", "formattedAddress", "location", "types", "primaryType",
  "businessStatus", "photos", "rating", "userRatingCount",
  "regularOpeningHours", "currentOpeningHours", "websiteUri", "nationalPhoneNumber",
  ATMOSPHERE_FIELDS,
].join(",");

const REFRESH_MASK = [
  // primaryType is Pro-tier and this mask already carries Enterprise fields
  // (rating, opening hours, website…), so it rides along free — billing
  // follows the highest tier requested. Refreshing it here is also what keeps
  // primary_type a periodically-renewed value rather than a permanent store,
  // matching how Google's caching terms are handled for lat/lng.
  "id", "primaryType", "businessStatus", "photos", "rating", "userRatingCount",
  "regularOpeningHours", "currentOpeningHours", "websiteUri", "nationalPhoneNumber",
  ...(QUARTERLY_ATMOSPHERE ? [ATMOSPHERE_FIELDS] : []),
].join(",");

/* ---------------- Stage A: free IDs-only discovery ---------------- */

async function discoverIds() {
  const ids = new Set();
  const districts = DISTRICTS.slice(0, LIMIT_DISTRICTS);
  for (const district of districts) {
    for (const query of DISCOVERY_QUERIES) {
      let pageToken;
      for (let page = 0; page < 3; page++) {
        const body = {
          textQuery: query,
          pageSize: 20,
          languageCode: "ar",
          regionCode: "SA",
          locationBias: {
            circle: { center: { latitude: district.lat, longitude: district.lng }, radius: DISCOVERY_RADIUS_METERS },
          },
        };
        if (pageToken) body.pageToken = pageToken;
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            // IDs-only mask -> Text Search Essentials IDs Only SKU (free)
            "X-Goog-FieldMask": "places.id,nextPageToken",
          },
          body: JSON.stringify(body),
        });
        calls.textSearchIdsOnly++;
        if (!res.ok) {
          console.error(`Discovery failed ${district.name}/${query} p${page}: ${res.status} ${await res.text()}`);
          break;
        }
        const json = await res.json();
        for (const p of json.places ?? []) {
          if (p.id) ids.add(p.id);
        }
        pageToken = json.nextPageToken;
        if (!pageToken) break;
      }
    }
  }
  return ids;
}

/* ---------------- Place Details (enrich + refresh) ---------------- */

async function fetchDetails(placeId, mask) {
  const res = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=ar&regionCode=SA`, {
    headers: { "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": mask },
  });
  if (res.status === 404) return { notFound: true };
  if (!res.ok) {
    console.error(`Details failed for ${placeId}: ${res.status} ${await res.text()}`);
    return null;
  }
  return await res.json();
}

/* ---------------- mapping helpers ---------------- */

// locationBias is a BIAS, not a restriction — Text Search can return
// places far from the searching district (even other cities). Attribute
// each place to the nearest district center, and report how far it is so
// the ingest gate can reject out-of-area results.
const SERVED_RADIUS_KM = 7;
function nearestDistrict(lat, lng) {
  let best = DISTRICTS[0], bestD = Infinity;
  for (const d of DISTRICTS) {
    const dist = ((d.lat - lat) * 111) ** 2 + ((d.lng - lng) * 98) ** 2; // km²
    if (dist < bestD) { bestD = dist; best = d; }
  }
  return { name: best.name, distKm: Math.sqrt(bestD) };
}

function mapGoogleType(place) {
  const primary = place.primaryType;
  if (primary === "cafe" || primary === "coffee_shop" || primary === "tea_house") return "كافيه";
  if (primary && primary !== "restaurant") {
    // fall through to types when the primary is something generic
  }
  if (place.types?.some((t) => t === "cafe" || t === "coffee_shop" || t === "tea_house")) return "كافيه";
  return "مطعم";
}

function mapOpeningHours(place) {
  const lines = place.regularOpeningHours?.weekdayDescriptions;
  return Array.isArray(lines) && lines.length ? lines.join("\n") : "";
}

function mapIsOpen(place) {
  if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") return false;
  if (typeof place.currentOpeningHours?.openNow === "boolean") return place.currentOpeningHours.openNow;
  return true;
}

function mapAttributes(place) {
  return {
    has_outdoor_seating: place.outdoorSeating === true,
    is_family_friendly: place.goodForChildren === true || place.goodForGroups === true,
    is_kids_friendly: place.goodForChildren === true || place.menuForChildren === true,
  };
}

async function downloadAndUploadPhotos(googlePlaceId, photos) {
  const urls = [];
  for (const photo of (photos ?? []).slice(0, MAX_PHOTOS_PER_PLACE)) {
    try {
      const mediaUrl = `https://places.googleapis.com/v1/${photo.name}/media?maxWidthPx=${PHOTO_MAX_WIDTH_PX}&key=${GOOGLE_PLACES_API_KEY}`;
      const res = await fetch(mediaUrl);
      calls.photoMedia++;
      if (!res.ok) continue;
      const bytes = new Uint8Array(await res.arrayBuffer());
      const path = `google/${googlePlaceId}/${urls.length}.jpg`;
      const { error } = await supabase.storage.from("place-photos").upload(path, bytes, {
        contentType: "image/jpeg",
        upsert: true,
      });
      if (error) { console.error(`Photo upload failed for ${googlePlaceId}:`, error.message); continue; }
      const { data } = supabase.storage.from("place-photos").getPublicUrl(path);
      urls.push(data.publicUrl);
    } catch (e) {
      console.error(`Photo fetch failed for ${googlePlaceId}:`, e.message);
    }
  }
  return urls;
}

/* ---------------- quality model (mirrors 0014 backfill + website/phone) ---------------- */

const RESIDENTIAL_RE = /(فيلا|منزل|بيت |ديوانية|استراحة|مجلس |شاليه|مزرعة)/;

function computeQuality(place, photoCount) {
  const reviews = place.userRatingCount ?? 0;
  const rating = typeof place.rating === "number" ? place.rating : null;
  const hasHours = !!mapOpeningHours(place);
  const hasContact = !!(place.websiteUri || place.nationalPhoneNumber);
  const name = place.displayName?.text ?? "";

  let score = 0;
  score += reviews >= 100 ? 25 : reviews >= 25 ? 20 : reviews >= 5 ? 10 : 0;
  if (rating != null) {
    if (rating === 5 && reviews < 20) score += 0; // tiny-sample perfect = no credit
    else if (rating >= 3.8 && rating <= 4.9 && reviews >= 25) score += 15;
    else if (rating >= 3.3) score += 8;
  }
  score += photoCount >= 3 ? 15 : photoCount >= 1 ? 10 : 0;
  score += hasHours ? 10 : 0;
  score += hasContact ? 10 : 0;
  score += 10; // geographic fit — discovered inside the served grid
  score += 15; // category — matched cafe/restaurant search

  const flags = [];
  if (rating === 5 && reviews < 20) flags.push("perfect_rating_low_sample");
  if (reviews < 10) flags.push("low_reviews");
  if (photoCount === 0) flags.push("no_photos");
  if (!hasHours) flags.push("no_hours");
  if (RESIDENTIAL_RE.test(name)) flags.push("residential_name");

  const status =
    flags.includes("residential_name") && reviews < 25 ? "quarantined" :
    score >= 60 ? "published" :
    score >= 35 ? "search_only" : "quarantined";

  return { score, flags, status };
}

/* ---------------- Stage B: enrich + insert new places ---------------- */

// Stage a proposal into place_updates, replacing any still-pending one
// for the same (google_place_id, change_type).
async function propose(row) {
  if (DRY_RUN) return;
  const { data: existing } = await supabase
    .from("place_updates").select("id")
    .eq("google_place_id", row.google_place_id)
    .eq("change_type", row.change_type)
    .eq("status", "pending")
    .maybeSingle();
  if (existing) {
    const { error } = await supabase.from("place_updates").update({
      current_values: row.current_values, proposed_values: row.proposed_values,
      diff_fields: row.diff_fields, scan_run_id: SCAN_RUN_ID, scanned_at: new Date().toISOString(),
    }).eq("id", existing.id);
    if (error) throw error;
  } else {
    const { error } = await supabase.from("place_updates").insert({ ...row, scan_run_id: SCAN_RUN_ID });
    if (error) throw error;
  }
}

// Record a gate rejection so next month's discovery doesn't re-bill a
// Place Details call for the same id. Re-checked after 90 days.
async function rememberSkip(placeId, reason) {
  if (DRY_RUN) return;
  const { error } = await supabase.from("sync_skips").upsert({
    google_place_id: placeId, reason, last_seen: new Date().toISOString(),
  });
  if (error) console.error(`sync_skips upsert failed ${placeId}:`, error.message);
}

async function insertNewPlace(placeId, fsqId = null) {
  const place = await fetchDetails(placeId, ENRICH_MASK);
  calls.detailsEnrich++;
  if (!place || place.notFound) return "errors";

  // Ingest gates — every rejection is remembered in sync_skips
  if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") {
    await rememberSkip(placeId, "closed"); return "skipped";
  }
  if (!(place.photos?.length) && (place.userRatingCount ?? 0) < 5) {
    await rememberSkip(placeId, "junk"); return "skipped";
  }
  const lat = place.location?.latitude, lng = place.location?.longitude;
  if (typeof lat !== "number" || typeof lng !== "number") {
    await rememberSkip(placeId, "no_location"); return "skipped";
  }
  const { name: districtName, distKm } = nearestDistrict(lat, lng);
  if (distKm > SERVED_RADIUS_KM) {
    await rememberSkip(placeId, "out_of_area"); return "skipped";
  }

  if (DRY_RUN) return "created";

  const photos = await downloadAndUploadPhotos(placeId, place.photos);
  const quality = computeQuality(place, photos.length);
  const nameEn = /^[A-Za-z0-9 .,'&-]+$/.test(place.displayName?.text ?? "") ? place.displayName.text : "";

  const insertPayload = {
    name: place.displayName?.text ?? "",
    name_en: nameEn,
    type: mapGoogleType(place),
    // mapGoogleType collapses this to كافيه/مطعم; keep the fine-grained value
    // too — it is what food search matches dish queries against.
    primary_type: place.primaryType ?? null,
    category: "",
    district: districtName,
    address: place.formattedAddress ?? "",
    image: photos[0] ?? "",
    images: photos,
    latitude: place.location?.latitude,
    longitude: place.location?.longitude,
    opening_hours: mapOpeningHours(place),
    is_open: mapIsOpen(place),
    description: "",
    tags: place.servesBreakfast === true ? ["فطور"] : [],
    is_new: true,
    is_verified: false,
    source: "google",
    google_place_id: placeId,
    fsq_place_id: fsqId,
    google_rating: typeof place.rating === "number" ? place.rating : null,
    google_review_count: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    google_synced_at: new Date().toISOString(),
    website: place.websiteUri ?? null,
    phone: place.nationalPhoneNumber ?? null,
    quality_score: quality.score,
    quality_flags: quality.flags,
    status: quality.status,
    ...mapAttributes(place),
  };

  if (!AUTO_APPLY) {
    // Stage as a pending "new place" for admin approval (photos are
    // already uploaded to storage — the payload carries their URLs).
    await propose({
      google_place_id: placeId, place_id: null, change_type: "new",
      current_values: null, proposed_values: insertPayload, diff_fields: ["new"],
    });
    return "created";
  }

  const { error } = await supabase.from("places").insert(insertPayload);
  if (error) throw error;
  return "created";
}

/* ---------------- Stage C: rotating refresh ---------------- */

async function pickRefreshBatch() {
  const COLS = "id, google_place_id, google_synced_at, images, tags, status, quality_flags, " +
    "opening_hours, website, phone, google_rating, google_review_count, " +
    "has_outdoor_seating, is_family_friendly, is_kids_friendly";
  const { count, error: countError } = await supabase
    .from("places").select("id", { count: "exact", head: true })
    .not("google_place_id", "is", null).neq("status", "retired");
  if (countError) throw countError;
  const third = Math.ceil((count ?? 0) / 3);

  // User-reported places jump the rotation — their businessStatus is the
  // thing users are usually reporting. google_place_id filter matters:
  // an admin-created place has none, and must never reach fetchDetails.
  const { data: reported } = await supabase.from("reports").select("place_id").eq("status", "open").not("place_id", "is", null);
  const reportedIds = [...new Set((reported ?? []).map((r) => r.place_id))];
  const priorityRows = reportedIds.length
    ? (await supabase.from("places").select(COLS).in("id", reportedIds)
        .not("google_place_id", "is", null).neq("status", "retired")).data ?? []
    : [];

  // Oldest-synced first with a stable id tiebreaker (equal timestamps are
  // common after bulk syncs — without it, pages can skip/duplicate rows).
  const rows = [];
  const PAGE = 1000;
  for (let from = 0; rows.length + priorityRows.length < third; from += PAGE) {
    const { data, error } = await supabase
      .from("places").select(COLS)
      .not("google_place_id", "is", null).neq("status", "retired")
      .order("google_synced_at", { ascending: true, nullsFirst: true })
      .order("id", { ascending: true })
      .range(from, Math.min(from + PAGE, third + priorityRows.length) - 1);
    if (error) throw error;
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }

  const priorityIds = new Set(priorityRows.map((r) => r.id));
  return [...priorityRows, ...rows.filter((r) => !priorityIds.has(r.id))].slice(0, third);
}

async function refreshPlace(row) {
  const place = await fetchDetails(row.google_place_id, REFRESH_MASK);
  calls.detailsRefresh++;
  if (!place) return "errors";

  if (place.notFound) {
    // Listing gone from Google — propose retirement (or apply in legacy mode).
    if (!DRY_RUN && !AUTO_APPLY) {
      await propose({
        google_place_id: row.google_place_id, place_id: row.id, change_type: "closed",
        current_values: { status: row.status },
        proposed_values: { status: "retired", reason: "place_id_obsolete" },
        diff_fields: ["status"],
      });
      await supabase.from("places").update({ google_synced_at: new Date().toISOString() }).eq("id", row.id);
      return "retired";
    }
    if (!DRY_RUN) {
      const { error } = await supabase.from("places").update({ status: "retired", google_synced_at: new Date().toISOString() }).eq("id", row.id);
      if (error) throw error;
    }
    return "retired";
  }

  if (DRY_RUN) return "updated";

  if (!AUTO_APPLY) {
    // PROPOSE mode: diff fresh Google data against the stored row and
    // stage the differences; only the rotation bookkeeping timestamp is
    // written to places.
    const current = {}, proposed = {}, diff = [];
    const cmp = (field, cur, next) => {
      if ((cur ?? "") !== (next ?? "") && next !== undefined) { current[field] = cur; proposed[field] = next; diff.push(field); }
    };
    if (place.businessStatus === "CLOSED_PERMANENTLY" || place.businessStatus === "CLOSED_TEMPORARILY") {
      await propose({
        google_place_id: row.google_place_id, place_id: row.id, change_type: "closed",
        current_values: { status: row.status },
        proposed_values: { status: place.businessStatus === "CLOSED_PERMANENTLY" ? "retired" : "search_only", reason: place.businessStatus },
        diff_fields: ["status"],
      });
      await supabase.from("places").update({ google_synced_at: new Date().toISOString() }).eq("id", row.id);
      return "updated";
    }
    cmp("opening_hours", row.opening_hours, mapOpeningHours(place));
    cmp("website", row.website, place.websiteUri ?? null);
    cmp("phone", row.phone, place.nationalPhoneNumber ?? null);
    if (typeof place.rating === "number" && place.rating !== Number(row.google_rating)) {
      current.google_rating = row.google_rating; proposed.google_rating = place.rating; diff.push("google_rating");
    }
    if (typeof place.userRatingCount === "number" && place.userRatingCount !== row.google_review_count) {
      current.google_review_count = row.google_review_count; proposed.google_review_count = place.userRatingCount; diff.push("google_review_count");
    }
    if (QUARTERLY_ATMOSPHERE) {
      const attrs = mapAttributes(place);
      cmp("has_outdoor_seating", row.has_outdoor_seating, attrs.has_outdoor_seating);
      cmp("is_family_friendly", row.is_family_friendly, attrs.is_family_friendly);
      cmp("is_kids_friendly", row.is_kids_friendly, attrs.is_kids_friendly);
    }
    if (diff.length) {
      const onlyRating = diff.every((f) => f === "google_rating" || f === "google_review_count");
      await propose({
        google_place_id: row.google_place_id, place_id: row.id,
        change_type: onlyRating ? "rating" : "info",
        current_values: current, proposed_values: proposed, diff_fields: diff,
      });
    }
    await supabase.from("places").update({ google_synced_at: new Date().toISOString() }).eq("id", row.id);
    return "updated";
  }

  const photos = row.images?.length ? [] : await downloadAndUploadPhotos(row.google_place_id, place.photos);
  const photoCount = photos.length || row.images?.length || 0;
  const quality = computeQuality(place, photoCount);

  // Preserve flags the score model doesn't compute (user_reported and any
  // future externally-set flags) — overwriting them silently pulled
  // reported places out of the admin review queue.
  const COMPUTED_FLAGS = new Set(["perfect_rating_low_sample", "low_reviews", "no_photos", "no_hours", "residential_name"]);
  const externalFlags = (row.quality_flags ?? []).filter((f) => !COMPUTED_FLAGS.has(f));
  const mergedFlags = [...new Set([...quality.flags, ...externalFlags])];

  const update = {
    opening_hours: mapOpeningHours(place),
    is_open: mapIsOpen(place),
    // Only overwrite when Google actually returned one — a missing field must
    // not wipe a value the backfill established.
    ...(place.primaryType ? { primary_type: place.primaryType } : {}),
    google_rating: typeof place.rating === "number" ? place.rating : null,
    google_review_count: typeof place.userRatingCount === "number" ? place.userRatingCount : null,
    google_synced_at: new Date().toISOString(),
    website: place.websiteUri ?? null,
    phone: place.nationalPhoneNumber ?? null,
    quality_score: quality.score,
    quality_flags: mergedFlags,
  };
  if (QUARTERLY_ATMOSPHERE) Object.assign(update, mapAttributes(place));
  if (place.businessStatus === "CLOSED_PERMANENTLY") {
    update.status = "retired";
  } else if (row.status === "quarantined" || row.status === "retired" || externalFlags.includes("user_reported")) {
    // Never auto-promote out of an admin's quarantine/retire decision, and
    // never reverse a report-driven demotion — user reports are a fresher
    // signal than Google's businessStatus. Admins clear the flag when they
    // resolve the reports.
  } else {
    update.status = quality.status === "quarantined" ? "search_only" : quality.status;
  }
  if (photos.length) { update.image = photos[0]; update.images = photos; }

  const { error } = await supabase.from("places").update(update).eq("id", row.id);
  if (error) throw error;
  return "updated";
}

/* ---------------- Stage D: gap mining (FSQ-only leads) ---------------- */

const normName = (s) => (s ?? "").toLowerCase().replace(/[^0-9a-z؀-ۿ]/g, "");

// Resolve FSQ-only venues to Google identities and feed them through the
// normal enrichment -> propose pipeline. Leads ranked contact-first (a
// phone/website is the strongest realness signal FSQ carries).
async function gapMine(count, budget) {
  // Existing catalog snapshot: coordinates grid + name for shadow checks,
  // google-id map for bonus linking, linked-FSQ exclusion set.
  const placesAll = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from("places").select("id, name, latitude, longitude, google_place_id, fsq_place_id")
      .order("id").range(from, from + 999);
    if (error) throw error;
    placesAll.push(...(data ?? []));
    if (!data || data.length < 1000) break;
  }
  const linkedFsq = new Set(placesAll.map((p) => p.fsq_place_id).filter(Boolean));
  const byGoogleId = new Map(placesAll.filter((p) => p.google_place_id).map((p) => [p.google_place_id, p]));
  const grid = new Map(); // 0.002° buckets -> places
  const bucketKey = (lat, lng) => `${Math.round(lat / 0.002)}:${Math.round(lng / 0.002)}`;
  for (const p of placesAll) {
    const k = bucketKey(p.latitude, p.longitude);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  const shadowedBy = (lead) => {
    const baseLat = Math.round(lead.latitude / 0.002), baseLng = Math.round(lead.longitude / 0.002);
    const ln = normName(lead.name);
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      for (const p of grid.get(`${baseLat + dy}:${baseLng + dx}`) ?? []) {
        const d2 = ((p.latitude - lead.latitude) * 111000) ** 2 + ((p.longitude - lead.longitude) * 98000) ** 2;
        if (d2 > 150 ** 2) continue;
        const pn = normName(p.name);
        if (ln && pn && (pn.includes(ln) || ln.includes(pn))) return p;
      }
    }
    return null;
  };

  // Lead pool: open, unprocessed, not already linked — ranked contact-first.
  const pool = [];
  for (let from = 0; pool.length < count * 4; from += 1000) {
    const { data, error } = await supabase
      .from("fsq_places")
      .select("fsq_place_id, name, latitude, longitude, tel, website, date_refreshed")
      .is("date_closed", null).is("gap_checked_at", null)
      .order("date_refreshed", { ascending: false, nullsFirst: false })
      .range(from, from + 999);
    if (error) throw error;
    for (const r of data ?? []) if (!linkedFsq.has(r.fsq_place_id)) pool.push(r);
    if (!data || data.length < 1000) break;
  }
  const leads = pool
    .sort((a, b) => Number(!!(b.tel || b.website)) - Number(!!(a.tel || a.website)))
    .slice(0, count);

  const gap = { leads: leads.length, linked: 0, proposed: 0, skipped: 0, noMatch: 0 };
  for (const lead of leads) {
    if (typeof lead.latitude !== "number" || typeof lead.longitude !== "number" || !lead.name) {
      await markLead(lead, "skipped"); gap.skipped++; continue;
    }
    // Shadowed by an existing catalog place -> just link it (free win).
    const shadow = shadowedBy(lead);
    if (shadow) {
      if (!shadow.fsq_place_id && !DRY_RUN) {
        await supabase.from("places").update({ fsq_place_id: lead.fsq_place_id }).eq("id", shadow.id).is("fsq_place_id", null);
      }
      await markLead(lead, "linked"); gap.linked++; continue;
    }
    // FREE IDs-only search at the lead's coordinates.
    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
        "X-Goog-FieldMask": "places.id",
      },
      body: JSON.stringify({
        textQuery: lead.name,
        pageSize: 3,
        languageCode: "ar",
        regionCode: "SA",
        locationBias: { circle: { center: { latitude: lead.latitude, longitude: lead.longitude }, radius: 300 } },
      }),
    });
    calls.textSearchIdsOnly++;
    if (!res.ok) { await markLead(lead, "skipped"); gap.skipped++; continue; }
    const ids = ((await res.json()).places ?? []).map((p) => p.id).filter(Boolean);
    if (!ids.length) { await markLead(lead, "no_match"); gap.noMatch++; continue; }

    const existing = ids.map((id) => byGoogleId.get(id)).find(Boolean);
    if (existing) {
      // Google says this lead IS an existing catalog place -> link.
      if (!existing.fsq_place_id && !DRY_RUN) {
        await supabase.from("places").update({ fsq_place_id: lead.fsq_place_id }).eq("id", existing.id).is("fsq_place_id", null);
      }
      await markLead(lead, "linked"); gap.linked++; continue;
    }
    if (budget.left-- <= 0) { console.warn("MAX_DETAILS reached — remaining gap leads deferred."); break; }
    const outcome = await insertNewPlace(ids[0], lead.fsq_place_id); // proposes in default mode
    await markLead(lead, outcome === "created" ? "proposed" : "skipped");
    if (outcome === "created") gap.proposed++; else gap.skipped++;
  }
  console.log(`Gap mining: ${gap.leads} leads → proposed ${gap.proposed}, linked ${gap.linked}, no-match ${gap.noMatch}, skipped ${gap.skipped}`);
}

async function markLead(lead, result) {
  if (DRY_RUN) return;
  await supabase.from("fsq_places")
    .update({ gap_checked_at: new Date().toISOString(), gap_result: result })
    .eq("fsq_place_id", lead.fsq_place_id);
}

/* ---------------- main ---------------- */

async function main() {
  console.log(`Sync start ${new Date().toISOString()} — dry_run=${DRY_RUN}, quarterly_atmosphere=${QUARTERLY_ATMOSPHERE}`);
  const counts = { created: 0, updated: 0, retired: 0, skipped: 0, errors: 0 };
  let detailsBudget = MAX_DETAILS;

  if (!SKIP_DISCOVERY) {
    const discovered = await discoverIds();
    // Page past the 1000-row response cap — a truncated known-set would
    // make existing places look "new" and re-bill their enrichment. The
    // stable ORDER BY matters: unordered pages can skip/duplicate rows.
    const known = new Set();
    const PAGE = 1000;
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("places").select("google_place_id").not("google_place_id", "is", null)
        .order("google_place_id").range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data ?? []) known.add(r.google_place_id);
      if (!data || data.length < PAGE) break;
    }
    // Also skip ids we rejected at the gates within the last 90 days —
    // without this, the same junk id re-bills one Details call per month.
    const skipCutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString();
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await supabase
        .from("sync_skips").select("google_place_id").gte("last_seen", skipCutoff)
        .order("google_place_id").range(from, from + PAGE - 1);
      if (error) throw error;
      for (const r of data ?? []) known.add(r.google_place_id);
      if (!data || data.length < PAGE) break;
    }
    const fresh = [...discovered].filter((id) => !known.has(id));
    console.log(`Discovery: ${discovered.size} ids seen (${calls.textSearchIdsOnly} free searches), ${fresh.length} new.`);

    for (const id of fresh) {
      if (detailsBudget-- <= 0) { console.warn("MAX_DETAILS reached — remaining new ids deferred to next run."); break; }
      try { counts[await insertNewPlace(id)]++; }
      catch (e) { counts.errors++; console.error(`Insert failed ${id}:`, e.message); }
    }
  }

  if (!SKIP_REFRESH) {
    const batch = await pickRefreshBatch();
    console.log(`Refresh: ${batch.length} places in this rotation.`);
    for (const row of batch) {
      if (detailsBudget-- <= 0) { console.warn("MAX_DETAILS reached — remaining refreshes deferred to next run."); break; }
      try { counts[await refreshPlace(row)]++; }
      catch (e) { counts.errors++; console.error(`Refresh failed ${row.google_place_id}:`, e.message); }
    }
  }

  if (GAP_MINE > 0) {
    await gapMine(GAP_MINE, { left: detailsBudget });
  }

  // Age out the "new" badge after two weeks.
  if (!DRY_RUN) {
    const { error: ageError } = await supabase
      .from("places")
      .update({ is_new: false })
      .eq("source", "google")
      .eq("is_new", true)
      .lt("created_at", new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString());
    if (ageError) console.error("Failed to age is_new flags:", ageError.message);
  }

  console.log(`Done. Created: ${counts.created}, Updated: ${counts.updated}, Retired: ${counts.retired}, Skipped: ${counts.skipped}, Errors: ${counts.errors}`);
  console.log(`API calls — textSearch IDs-only (FREE): ${calls.textSearchIdsOnly}, ` +
    `details enrich (Enterprise+Atmosphere): ${calls.detailsEnrich}, ` +
    `details refresh (${QUARTERLY_ATMOSPHERE ? "Enterprise+Atmosphere" : "Enterprise"}): ${calls.detailsRefresh}, ` +
    `photo media: ${calls.photoMedia}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
