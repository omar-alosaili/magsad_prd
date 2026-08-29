// Find catalog places that Google associates with a dish, for dishes Google
// publishes no place TYPE for — cookies, matcha, kunafa, cheesecake. Those
// reach only places that spell the dish out in their own name (كوكيز = 2
// places, ماتشا = 3), and no amount of primary_type work changes that.
//
// Discovery is free: Text Search with an IDs-only field mask is the "Text
// Search Essentials IDs Only" SKU, which is unlimited free. The ids are then
// intersected with places.google_place_id, so names come from OUR database
// and no billable Google field is ever requested.
//
// PRECISION MATTERS MORE THAN REACH HERE. Seeding a dish onto a place puts it
// under «أطباق مميزة» on that place's page — a public factual claim about a
// real business. A single Text Search hit does not support that claim: the
// raw union for «كوكيز» included ماكدونالدز, a manakish shop and a plain
// bread bakery, because Google will happily return a nearby café for a food
// word. Two independent filters are applied:
//
//   1. AGREEMENT — how many distinct phrasings returned the place. One hit is
//      proximity; several wordings agreeing is aboutness.
//   2. PLAUSIBLE TYPE — primary_type must be one a place serving this dish
//      actually has. This is what drops ماكدونالدز (`restaurant`).
//
// Writes nothing by default; prints the candidates and what each filter cut.
//
//   node scripts/seed-dishes-from-search.mjs cookies
//   node scripts/seed-dishes-from-search.mjs cookies --write
//   node scripts/seed-dishes-from-search.mjs cookies --min-agree=3

import dotenv from "dotenv";
import { createClient } from "@supabase/supabase-js";

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

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const WRITE = process.argv.includes("--write");
const SLUG = process.argv[2];
const MIN_AGREE = Number((process.argv.find(a => a.startsWith("--min-agree=")) ?? "").split("=")[1]) || 2;

// The seeded name is the plain dish word — not an invented menu item like
// «كوكيز الشوكولاتة بالملح», which would put words in the owner's mouth.
const DISHES = {
  cookies: {
    name: "كوكيز",
    queries: ["كوكيز", "محل كوكيز", "كوكيز الرياض", "cookies", "cookie shop", "بسكوت"],
    // Somewhere that sells cookies is a bakery, a dessert counter or a café.
    types: ["bakery", "cake_shop", "pastry_shop", "dessert_shop", "dessert_restaurant",
            "confectionery", "candy_store", "coffee_shop", "cafe", "coffee_roastery"],
  },
  matcha: {
    name: "ماتشا",
    queries: ["ماتشا", "ماتشا لاتيه", "كافيه ماتشا", "matcha", "matcha latte", "matcha cafe"],
    // Matcha is a café/tea drink. A bakery is not evidence of it.
    types: ["coffee_shop", "cafe", "coffee_roastery", "coffee_stand", "tea_house", "tea_store"],
  },
};

// Riyadh-wide, plus centers spread across the city so the 60-result cap per
// query doesn't just return the middle. Kept local rather than imported: the
// sync script runs main() on import.
const CENTERS = [
  { name: "الرياض", lat: 24.7136, lng: 46.6753, radius: 30000 },
  { name: "الملقا", lat: 24.7944, lng: 46.6243, radius: 8000 },
  { name: "العليا", lat: 24.6939, lng: 46.6852, radius: 8000 },
  { name: "النرجس", lat: 24.8380, lng: 46.6480, radius: 8000 },
  { name: "الروضة", lat: 24.7570, lng: 46.7690, radius: 8000 },
  { name: "الحمراء", lat: 24.7690, lng: 46.7420, radius: 8000 },
  { name: "السويدي", lat: 24.6100, lng: 46.6560, radius: 8000 },
];

// placeId -> Set of phrasings that returned it
async function discover(queries) {
  const hits = new Map();
  let calls = 0;
  for (const center of CENTERS) {
    for (const textQuery of queries) {
      let pageToken;
      for (let page = 0; page < 3; page++) {
        const body = {
          textQuery, pageSize: 20, languageCode: "ar", regionCode: "SA",
          locationBias: { circle: { center: { latitude: center.lat, longitude: center.lng }, radius: center.radius } },
        };
        if (pageToken) body.pageToken = pageToken;
        const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_PLACES_API_KEY,
            // IDs-only mask -> free SKU. Adding any other field bills the call.
            "X-Goog-FieldMask": "places.id,nextPageToken",
          },
          body: JSON.stringify(body),
        });
        calls++;
        if (!res.ok) { console.error(`  ${center.name}/"${textQuery}" p${page}: ${res.status}`); break; }
        const json = await res.json();
        for (const p of json.places ?? []) {
          if (!p.id) continue;
          if (!hits.has(p.id)) hits.set(p.id, new Set());
          hits.get(p.id).add(textQuery);
        }
        pageToken = json.nextPageToken;
        if (!pageToken) break;
        await new Promise(r => setTimeout(r, 120));
      }
    }
  }
  return { hits, calls };
}

async function main() {
  const dish = DISHES[SLUG];
  if (!dish) {
    console.error(`Usage: node scripts/seed-dishes-from-search.mjs <${Object.keys(DISHES).join("|")}> [--write] [--min-agree=N]`);
    process.exit(1);
  }

  const { hits, calls } = await discover(dish.queries);
  console.log(`${hits.size} distinct place ids from ${calls} free Text Search calls\n`);

  const idList = [...hits.keys()];
  const found = [];
  for (let i = 0; i < idList.length; i += 100) {
    const { data, error } = await supabase
      .from("places")
      .select("id, name, google_place_id, primary_type, google_rating, google_review_count, status")
      .in("google_place_id", idList.slice(i, i + 100));
    if (error) throw error;
    found.push(...data);
  }

  const inCatalog = found.filter(p => p.status === "published" || p.status === "search_only");
  const withAgree = inCatalog.map(p => ({ ...p, agree: hits.get(p.google_place_id).size }));

  // The type filter has a false-negative cost: Urth Caffé is typed
  // `restaurant` but is one of the best-known matcha cafés in the city. Near-
  // unanimous agreement across phrasings is strong enough evidence on its own,
  // so it overrides the type check rather than being filtered by it.
  const STRONG_AGREE = Math.max(MIN_AGREE + 2, dish.queries.length - 1);
  const ok = p => dish.types.includes(p.primary_type) || p.agree >= STRONG_AGREE;
  const passAgree = withAgree.filter(p => p.agree >= MIN_AGREE);
  const kept = passAgree.filter(ok);
  const cutByType = passAgree.filter(p => !ok(p));

  const { data: existing } = await supabase
    .from("place_menu_items").select("place_id").eq("category_slug", SLUG);
  const already = new Set((existing ?? []).map(r => r.place_id));
  const toSeed = kept.filter(p => !already.has(p.id));

  console.log(`in catalog:           ${inCatalog.length}`);
  console.log(`agreement >= ${MIN_AGREE}:      ${passAgree.length}   (cut ${inCatalog.length - passAgree.length} single-hit)`);
  console.log(`plausible type:       ${kept.length}   (cut ${cutByType.length})`);
  console.log(`already seeded:       ${kept.length - toSeed.length}\n`);

  for (const p of [...toSeed].sort((a, b) => b.agree - a.agree || (b.google_review_count ?? 0) - (a.google_review_count ?? 0))) {
    console.log(`  + ${p.name}  [${p.primary_type}]  agree=${p.agree}  ${p.google_rating ?? "?"}★ ${p.google_review_count ?? 0}`);
  }
  if (cutByType.length) {
    console.log(`\n  cut by type: ${cutByType.map(p => `${p.name} [${p.primary_type}]`).join(", ")}`);
  }

  if (!WRITE) {
    console.log(`\n${toSeed.length} would be seeded with «${dish.name}». Re-run with --write to apply.`);
    return;
  }

  // created_by stays null: this is admin-curated, not an owner's declaration.
  const rows = toSeed.map(p => ({ place_id: p.id, name: dish.name, category_slug: SLUG, created_by: null }));
  for (let i = 0; i < rows.length; i += 100) {
    const { error } = await supabase.from("place_menu_items").insert(rows.slice(i, i + 100));
    if (error) throw error;
  }
  console.log(`\nseeded «${dish.name}» onto ${rows.length} places`);
}

main().catch(e => { console.error(e); process.exit(1); });
