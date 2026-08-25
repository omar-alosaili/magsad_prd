import { supabase } from "./supabase";
import { getPlaces } from "./places";
import { getFollowingIds } from "./profile";
import { getDishCategories } from "./menu";
import type { Place } from "../components/data";
import { FEATURES } from "./features";

// ============================================================
// Food discovery: rank places for a dish query ("أفضل كوكيز في
// الرياض") from Magsad-first signals — user reviews mentioning the
// dish (followed users and creators weigh more), public lists whose
// title/description mention it, saves as popularity, and the place's
// own name/tags — enriched by Google rating data as a quality prior.
// ============================================================

export type FoodSource = "توصيات مقصد" | "قوائم مقصد" | "أطباق المكان" | "بيانات قوقل";

export type FoodResult = {
  place: Place;
  term: string;                 // the dish term that matched
  score: number;                // 15..99 display score (relative x absolute)
  recommenders: number;         // distinct Magsad users recommending
  comments: { author: string; text: string; rating: number }[];
  reasons: string[];            // "why this place"
  sources: FoodSource[];
};

// --- Arabic-aware normalization -----------------------------------

// Strips PostgREST or() syntax and SQL LIKE wildcards but keeps the
// original Arabic spelling (for building DB-side ilike patterns).
function sanitize(s: string): string {
  return s.toLowerCase().replace(/[,()"\\%*_]/g, " ").trim();
}

// Folds Arabic spelling variants for client-side matching. NEVER use
// the output in a DB ilike pattern: Postgres does no Arabic folding,
// so a normalized ه-form pattern misses the standard ة spelling.
function normalize(s: string): string {
  return sanitize(s)
    .replace(/[ً-ْـ]/g, "") // diacritics + tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .trim();
}

// Filler words stripped from queries: "أفضل كوكيز في الرياض" → "كوكيز"
const FILLER = new Set([
  "افضل", "احسن", "احلي", "اطيب", "الذ", "اجمل", "best", "top", "good",
  "في", "من", "الرياض", "رياض", "بالرياض", "مكان", "اماكن", "محل", "محلات",
]);

// A dish concept and every spelling that means it. `slug` ties the group to
// a canonical `dish_categories` row so a matched query can pull owner-declared
// menu items by category, not just by name.
export type DishGroup = { slug: string | null; terms: string[]; googleTypes: string[] };

// OFFLINE FALLBACK ONLY. The live vocabulary is `dish_categories` in the
// database — see buildGroups(). This list exists so search still works if that
// fetch fails, and it is deliberately not the source of truth: when the two
// disagreed, «بسكوت» was a cookie synonym in the DB but missing here, which
// made «مقهى بسكوت و شاهي» invisible to a «كوكيز» search.
// The FIRST entry is the display form shown in the results header, so it keeps
// proper spelling (ة not the normalized ه). All raw spellings are listed
// explicitly because DB-side ilike gets the RAW forms.
const FALLBACK_SYNONYMS: string[][] = [
  ["كوكيز", "كوكي", "cookie", "cookies"],
  ["بيتزا", "pizza"],
  ["برجر", "برغر", "برقر", "همبرجر", "burger", "burgers"],
  ["قهوة", "قهوه", "كوفي", "coffee", "اسبريسو", "espresso"],
  ["ماتشا", "matcha"],
  ["كنافة", "كنافه", "kunafa", "knafeh", "kunafah"],
  ["تشيزكيك", "cheesecake", "تشيز كيك"],
  ["كرواسون", "كرواسان", "كرسون", "croissant"],
  ["سوشي", "sushi"],
  ["شاورما", "shawarma"],
  ["دونات", "دوناتس", "donut", "donuts", "doughnut"],
  ["آيس كريم", "ايس كريم", "بوظة", "بوظه", "جيلاتو", "ice cream", "gelato"],
  ["فطور", "فطار", "breakfast"],
  ["كيك", "كيكة", "كيكه", "cake"],
  ["شوكولاتة", "شوكولاته", "شوكلت", "chocolate"],
  ["باستا", "معكرونة", "معكرونه", "مكرونة", "مكرونه", "pasta"],
  ["ستيك", "steak"],
  ["مندي", "mandi"],
  ["كبسة", "كبسه", "kabsa"],
  ["وافل", "waffle"],
  ["بان كيك", "بانكيك", "pancake"],
  ["مشويات", "مشاوي", "grill", "bbq"],
];

const FALLBACK_GROUPS: DishGroup[] = FALLBACK_SYNONYMS.map(terms => ({ slug: null, terms, googleTypes: [] }));

// The live vocabulary: one group per canonical category, carrying its Arabic
// and English display names plus every listed spelling.
function buildGroups(
  categories: { slug: string; nameAr: string; nameEn: string; synonyms: string[]; googleTypes: string[] }[],
): DishGroup[] {
  if (!categories.length) return FALLBACK_GROUPS;
  return categories.map(c => ({
    slug: c.slug,
    // nameAr first — it is the display term. Empty strings are dropped:
    // "".indexOf() matches at position 0 and would match every query.
    terms: [...new Set([c.nameAr, ...c.synonyms, c.nameEn].filter(Boolean))],
    googleTypes: c.googleTypes,
  }));
}

export type ExpandedQuery = {
  term: string;           // display form
  variants: string[];     // normalized — for client-side matching only
  serverVariants: string[]; // raw spellings — for DB ilike patterns
  slug: string | null;    // canonical category, when the query names one
  googleTypes: string[];  // Google primaryTypes implying that category
};

// Extract the dish term from a free query and expand its variants.
// Exact variant match wins first ("كيك" → the كيك group, even though
// "تشيز كيك" contains it); then containment, preferring the variant
// that appears EARLIEST in the query (head noun: "وافل شوكولاتة" →
// وافل), tie-broken by length ("تشيز كيك ..." → تشيزكيك, not كيك).
export function expandFoodQuery(raw: string, groups: DishGroup[] = FALLBACK_GROUPS): ExpandedQuery {
  const rawWords = sanitize(raw).split(/\s+/).filter(w => w && !FILLER.has(normalize(w)));
  const rawCleaned = rawWords.join(" ");
  const cleaned = normalize(rawCleaned);
  // Single characters match half the catalog — wait for real input.
  if (cleaned.length < 2) return { term: "", variants: [], serverVariants: [], slug: null, googleTypes: [] };

  const build = (group: DishGroup): ExpandedQuery => ({
    term: group.terms[0],
    variants: [...new Set([...group.terms.map(normalize), cleaned])],
    serverVariants: [...new Set([...group.terms.map(t => t.toLowerCase()), rawCleaned, cleaned])],
    slug: group.slug,
    googleTypes: group.googleTypes,
  });

  for (const group of groups) {
    if (group.terms.map(normalize).includes(cleaned)) return build(group);
  }

  let best: { group: DishGroup; pos: number; len: number } | null = null;
  for (const group of groups) {
    for (const t of group.terms.map(normalize)) {
      const pos = cleaned.indexOf(t);
      if (pos < 0) continue;
      if (!best || pos < best.pos || (pos === best.pos && t.length > best.len)) {
        best = { group, pos, len: t.length };
      }
    }
  }
  if (best) return build(best.group);

  return { term: rawCleaned, variants: [cleaned], serverVariants: [...new Set([rawCleaned, cleaned])], slug: null, googleTypes: [] };
}

// --- Signal weights ------------------------------------------------

const W_REVIEW_FOLLOWED = 2.0; // a followed user's recommendation
const W_REVIEW_CREATOR = 1.5;  // a creator/influencer
const W_REVIEW_USER = 1.0;     // any Magsad user
const W_LIST = 0.6;            // place appears in a matching list
const W_NAME = 1.0;            // dish in the place's own name
const W_TAG = 0.5;             // dish in tags/category/description
const W_SAVE = 0.15;           // log-scaled saves (popularity)
// The place itself declaring the dish: authoritative that it EXISTS, but it
// is the owner's own claim, so it ranks under a Magsad user's recommendation.
const W_MENU = 0.9;
// Google's primaryType says this place is a pizza_restaurant / ice_cream_shop.
// Broad coverage — it is the only dish signal most of the catalog has — but
// coarser than the others: `bakery` implies cake without specialising in it.
// Ranked under both a name match and an owner-declared dish so the
// approximation never outranks a place that actually claims the dish.
const W_TYPE = 0.7;

// Saves are only fetched for the leaders — keeps the .in() id list
// (and the response rows) bounded no matter how broad the dish is.
const SAVES_POOL = 60;
const RESULT_LIMIT = 20;

type WeightedComment = { author: string; text: string; rating: number; weight: number };

type Candidate = {
  place: Place;
  reviewSignal: number;
  recommenders: Set<string>;
  comments: WeightedComment[];
  listTitles: string[];
  nameMatch: boolean;
  tagMatch: boolean;
  menuItems: string[];  // owner-declared dishes that matched
  typeMatch: boolean;   // Google's primaryType implies the dish
  saves: number;
};

// Google quality prior, centered on a neutral 3.5 stars: unknown places
// get the 0.55 baseline, well-rated places rise toward 1.0, and badly
// rated places sink BELOW unknown (bad evidence must penalize).
function googlePrior(place: Place): number {
  const g = place.googleRating;
  if (!g) return 0.55;
  const confidence = Math.min(1, Math.log1p(place.googleReviewCount ?? 0) / 8);
  return Math.min(1, Math.max(0.2, 0.55 + 0.45 * ((g - 3.5) / 1.5) * confidence));
}

export async function searchFood(rawQuery: string, viewerId: string | null): Promise<{ term: string; results: FoodResult[] }> {
  // Cheap guard before any network work: under 2 characters names no dish.
  if (!expandFoodQuery(rawQuery).term) return { term: "", results: [] };

  const [places, following, categories] = await Promise.all([
    getPlaces(),
    viewerId ? getFollowingIds(viewerId).catch(() => new Set<string>()) : Promise.resolve(new Set<string>()),
    getDishCategories().catch(() => []),
  ]);

  // Expand against the DB taxonomy so search and the owner-facing category
  // picker share one vocabulary; falls back to the built-in list if it failed.
  const { term, variants, serverVariants, slug, googleTypes } = expandFoodQuery(rawQuery, buildGroups(categories));
  if (!term) return { term: "", results: [] };

  // The canonical category this query means, so the menu query can match by
  // category as well as name — «سموذي» finds an item named «عصير ليمون
  // بالنعناع» filed under `juice`.
  const wantedCats = slug ? [slug] : [];

  // DB-side patterns use RAW spellings (ilike does no Arabic folding).
  const reviewOr = serverVariants.map(v => `comment.ilike.%${v}%`).join(",");
  const listOr = serverVariants.flatMap(v => [`title.ilike.%${v}%`, `description.ilike.%${v}%`]).join(",");
  let listsQ = supabase.from("lists").select("id, title, list_places(place_id)").eq("is_public", true).or(listOr);
  if (!FEATURES.paidLists) listsQ = listsQ.eq("is_paid", false);

  // Owner-declared dishes: match the dish NAME, and the canonical category
  // so «كوكيز» finds a place whose item is «كوكيز الشوكولاتة بالملح».
  const menuConds = serverVariants.map(v => `name.ilike.%${v}%`);
  if (wantedCats.length) menuConds.push(`category_slug.in.(${wantedCats.join(",")})`);

  const [reviewsRes, listsRes, menuRes] = await Promise.all([
    supabase.from("reviews").select("place_id, user_id, rating, comment, profiles(name, is_creator)").or(reviewOr),
    listsQ,
    supabase.from("place_menu_items").select("place_id, name, category_slug").or(menuConds.join(",")),
  ]);
  if (reviewsRes.error) throw reviewsRes.error;
  if (listsRes.error) throw listsRes.error;

  const byId = new Map(places.map(p => [p.id, p]));
  const candidates = new Map<string, Candidate>();
  const getCand = (placeId: string): Candidate | null => {
    const place = byId.get(placeId);
    if (!place) return null;
    let c = candidates.get(placeId);
    if (!c) {
      c = { place, reviewSignal: 0, recommenders: new Set(), comments: [], listTitles: [], nameMatch: false, tagMatch: false, menuItems: [], typeMatch: false, saves: 0 };
      candidates.set(placeId, c);
    }
    return c;
  };

  // 1. Review signal — Magsad-first, weighted by who recommends
  for (const r of reviewsRes.data as unknown as { place_id: string; user_id: string; rating: number; comment: string; profiles: { name: string; is_creator: boolean } | null }[]) {
    if (r.rating < 3) continue; // a bad review is not a recommendation
    const c = getCand(r.place_id);
    if (!c) continue;
    const weight = following.has(r.user_id) ? W_REVIEW_FOLLOWED : r.profiles?.is_creator ? W_REVIEW_CREATOR : W_REVIEW_USER;
    const strength = (r.rating - 2.5) / 2.5; // 5★ → 1.0
    c.reviewSignal += weight * strength;
    c.recommenders.add(r.user_id);
    if (r.comment?.trim()) {
      c.comments.push({ author: r.profiles?.name || "مستخدم", text: r.comment, rating: r.rating, weight });
    }
  }

  // 2. List signal — dish-titled public lists recommend their places
  for (const l of listsRes.data as unknown as { id: string; title: string; list_places: { place_id: string }[] }[]) {
    for (const lp of l.list_places) {
      const c = getCand(lp.place_id);
      if (c && c.listTitles.length < 3) c.listTitles.push(l.title);
    }
  }

  // 2b. Owner-declared menu signal. Matches the dish name directly, or the
  // canonical category, so «كوكيز» finds «كوكيز الشوكولاتة بالملح».
  const wantedCatSet = new Set(wantedCats);
  for (const m of (menuRes.data ?? []) as { place_id: string; name: string; category_slug: string | null }[]) {
    const nameHit = variants.some(v => normalize(m.name).includes(v));
    const catHit = !!m.category_slug && wantedCatSet.has(m.category_slug);
    if (!nameHit && !catHit) continue;
    const c = getCand(m.place_id);
    if (c && !c.menuItems.includes(m.name)) c.menuItems.push(m.name);
  }

  // 3. Place-text signal — the place itself is about the dish
  //    (normalized on BOTH sides, so folding is safe here) — plus Google's
  //    primaryType, which for most of the catalog is the ONLY dish signal:
  //    description is empty catalog-wide and tags hold one value.
  const wantedTypes = new Set(googleTypes);
  for (const p of places) {
    const name = normalize(`${p.name} ${p.nameEn}`);
    const meta = normalize(`${p.category} ${p.tags.join(" ")} ${p.description}`);
    const nameHit = variants.some(v => name.includes(v));
    const tagHit = variants.some(v => meta.includes(v));
    const typeHit = !!p.primaryType && wantedTypes.has(p.primaryType);
    if (nameHit || tagHit || typeHit) {
      const c = getCand(p.id);
      if (c) { c.nameMatch = nameHit; c.tagMatch = tagHit; c.typeMatch = typeHit; }
    }
  }

  if (!candidates.size) return { term, results: [] };

  const baseScore = (c: Candidate) =>
    c.reviewSignal +
    Math.min(3, c.listTitles.length) * W_LIST +
    (c.nameMatch ? W_NAME : 0) +
    (c.tagMatch ? W_TAG : 0) +
    (c.menuItems.length ? W_MENU : 0) +
    (c.typeMatch ? W_TYPE : 0);

  // Rank once without saves, then fetch saves for the leaders only —
  // bounds the .in() list and the row count for arbitrarily broad terms.
  const pool = [...candidates.values()]
    .map(c => ({ c, raw: baseScore(c) * googlePrior(c.place) }))
    .sort((a, b) => b.raw - a.raw)
    .slice(0, SAVES_POOL);

  const { data: saves, error: savesErr } = await supabase
    .from("saved_places").select("place_id")
    .in("place_id", pool.map(e => e.c.place.id));
  if (savesErr) console.error("food search: saves signal failed", savesErr);
  for (const s of (saves ?? []) as { place_id: string }[]) {
    const e = pool.find(x => x.c.place.id === s.place_id);
    if (e) e.c.saves += 1;
  }

  const scored = pool
    .map(({ c }) => ({ c, raw: (baseScore(c) + Math.log1p(c.saves) * W_SAVE) * googlePrior(c.place) }))
    .sort((a, b) => b.raw - a.raw);

  const max = scored[0].raw || 1;
  const results: FoodResult[] = scored.slice(0, RESULT_LIMIT).map(({ c, raw }) => {
    const reasons: string[] = [];
    const sources: FoodSource[] = [];
    if (c.recommenders.size > 0) {
      reasons.push(`أوصى به ${c.recommenders.size.toLocaleString("en-US")} من مستخدمي مقصد`);
      sources.push("توصيات مقصد");
    }
    if (c.listTitles.length > 0) {
      reasons.push(`ورد في قائمة «${c.listTitles[0]}»`);
      sources.push("قوائم مقصد");
    }
    if (c.menuItems.length) {
      reasons.push(`المكان يقدّم «${c.menuItems[0]}»`);
      sources.push("أطباق المكان");
    }
    if (c.nameMatch) reasons.push("متخصص في هذا الصنف");
    // Only worth saying when nothing stronger already explains the match —
    // "قوقل يصنّفه" under a place that also has the dish in its name is noise.
    if (c.typeMatch && !c.nameMatch && !c.menuItems.length) {
      reasons.push(`مصنّف لدى قوقل ضمن «${term}»`);
      if (!sources.includes("بيانات قوقل")) sources.push("بيانات قوقل");
    }
    if (c.place.googleRating && (c.place.googleReviewCount ?? 0) > 50) {
      reasons.push(`تقييم ${c.place.googleRating} من ${(c.place.googleReviewCount ?? 0).toLocaleString("en-US")} مراجعة`);
      if (!sources.includes("بيانات قوقل")) sources.push("بيانات قوقل");
    }
    // Best comments first: followed/creator recommendations, then rating
    const comments = [...c.comments]
      .sort((a, b) => b.weight - a.weight || b.rating - a.rating)
      .slice(0, 2)
      .map(({ author, text, rating }) => ({ author, text, rating }));
    // Display score blends relative rank with absolute evidence, so a
    // lone incidental match can't present as a 99% recommendation.
    const absolute = Math.min(1, raw / 2);
    return {
      place: c.place,
      term,
      score: Math.max(15, Math.round(99 * (raw / max) * absolute)),
      recommenders: c.recommenders.size,
      comments,
      reasons,
      sources,
    };
  });

  return { term, results };
}
