// One-time backfill of places.primary_type from Google Place Details.
//
// The monthly sync always requested `primaryType` but discarded it
// (mapGoogleType collapsed it to كافيه/مطعم), so every existing row has it
// null. New and refreshed places now keep it — this fills in the history.
//
// BILLING: the field mask is `id,primaryType` and nothing else. Place Details
// is billed at the highest tier any requested field belongs to, and
// primaryType is Pro ($17/1k, first 5,000/month free). The catalog is ~3,700
// places, so a full pass sits inside the free Pro allowance — but that
// allowance is shared with anything else billing Pro this month, which is why
// MAX_CALLS exists and defaults below the free ceiling.
//
// Resumable: only rows with primary_type IS NULL are fetched, and each is
// written as it returns. Re-run after an interruption and it picks up.
//
//   node scripts/backfill-primary-type.mjs            # real run
//   DRY_RUN=1 node scripts/backfill-primary-type.mjs  # no writes, no cost
//   MAX_CALLS=50 node scripts/backfill-primary-type.mjs

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

// .env.script.local matches the other scripts; .env.prod.local is where these
// keys actually live on this machine. First file to define a var wins.
dotenv.config({ path: ".env.script.local" });
dotenv.config({ path: ".env.prod.local" });
dotenv.config();

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const GOOGLE_PLACES_API_KEY = process.env.GOOGLE_PLACES_API_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !GOOGLE_PLACES_API_KEY) {
  console.error("Missing SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, or GOOGLE_PLACES_API_KEY in env.");
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === "1";
// Stays under the 5,000/month free Pro allowance even if something else
// already spent some of it. Raise deliberately, not by default.
const MAX_CALLS = Number(process.env.MAX_CALLS) || 4000;
// A first pass at concurrency 8 with no pacing drew 2,516 429s out of 3,708
// requests. Google rejects those before serving them (so they are not billed,
// and the run is resumable) but the throughput is worthless. Pace the whole
// run instead, and back off when Google still says slow down.
const CONCURRENCY = 4;
const MIN_INTERVAL_MS = 120;   // ≈8 requests/second across all workers
const MAX_RETRIES = 5;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

// Pro-tier only. Adding ANY Enterprise field here (rating, opening hours,
// website…) would re-tier every call in this run.
const MASK = "id,primaryType";

async function fetchRows() {
  const PAGE = 1000;
  const rows = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, google_place_id")
      .not("google_place_id", "is", null)
      .is("primary_type", null)
      .range(from, from + PAGE - 1);
    if (error) throw error;
    rows.push(...data);
    if (data.length < PAGE) break;
  }
  return rows;
}

const stats = { calls: 0, written: 0, noType: 0, failed: 0, retries: 0, byStatus: {} };

const sleep = ms => new Promise(r => setTimeout(r, ms));

// Global pacer: every request waits its turn, so concurrency controls overlap
// while this controls the actual rate.
let nextSlot = 0;
async function pace() {
  const now = Date.now();
  const slot = Math.max(now, nextSlot);
  nextSlot = slot + MIN_INTERVAL_MS;
  if (slot > now) await sleep(slot - now);
}

async function fetchType(placeId) {
  for (let attempt = 0; ; attempt++) {
    await pace();
    const res = await fetch(
      `https://places.googleapis.com/v1/places/${placeId}?languageCode=ar&regionCode=SA`,
      { headers: { "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY, "X-Goog-FieldMask": MASK } },
    );
    stats.calls++;
    if (res.ok) return res;

    // 429 is a throttle, not a verdict on the place — retry it. Anything else
    // (404 for a retired place id, 403 for a key problem) is final.
    if (res.status === 429 && attempt < MAX_RETRIES) {
      stats.retries++;
      await sleep(Math.min(30000, 500 * 2 ** attempt) + Math.random() * 250);
      continue;
    }
    return res;
  }
}

async function backfillOne(row) {
  const res = await fetchType(row.google_place_id);

  if (!res.ok) {
    // 404/NOT_FOUND means Google retired the place id. Leave primary_type
    // null and let the sync's own retire path deal with it — this script
    // must not change a place's lifecycle status.
    stats.failed++;
    stats.byStatus[res.status] = (stats.byStatus[res.status] ?? 0) + 1;
    if (stats.failed <= 5) console.warn(`  ${res.status} ${row.name} (${row.google_place_id})`);
    return;
  }

  const place = await res.json();
  const primaryType = place.primaryType;
  if (!primaryType) { stats.noType++; return; }   // legitimately absent for some places
  if (DRY_RUN) { stats.written++; return; }

  const { error } = await supabase.from("places").update({ primary_type: primaryType }).eq("id", row.id);
  if (error) { stats.failed++; console.warn(`  write failed ${row.name}: ${error.message}`); return; }
  stats.written++;
}

async function main() {
  const all = await fetchRows();
  const rows = all.slice(0, MAX_CALLS);
  console.log(`${all.length} places missing primary_type; processing ${rows.length}${DRY_RUN ? " (DRY RUN — no writes, no billing difference)" : ""}`);
  if (all.length > rows.length) console.log(`capped by MAX_CALLS=${MAX_CALLS}; re-run to continue`);

  let cursor = 0;
  const worker = async () => {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try { await backfillOne(row); } catch (e) { stats.failed++; console.warn(`  ${row.name}: ${e.message}`); }
      if (stats.calls % 250 === 0) console.log(`  …${stats.calls}/${rows.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  // Only served responses bill; 429s are rejected before serving.
  const served = stats.written + stats.noType + stats.failed;
  console.log(
    `\ndone — ${stats.calls} requests (${stats.retries} were 429 retries)\n` +
    `  written:  ${stats.written}\n` +
    `  no type:  ${stats.noType}\n` +
    `  failed:   ${stats.failed}${Object.keys(stats.byStatus).length ? ` ${JSON.stringify(stats.byStatus)}` : ""}\n` +
    `  billable: ~${served} served Pro-tier responses (first 5,000/month free)`,
  );
}

main().catch(e => { console.error(e); process.exit(1); });
