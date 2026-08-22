// The shared dish vocabulary — ONE source of truth.
//
// This list previously lived only inside foodSearch as a SYNONYMS constant.
// Recommendations need the same terms (so "best كوكيز in Riyadh" can rank
// places people actually recommended it at), and two hand-maintained copies
// would drift, so both now import from here. The `dishes` table is seeded
// from the same slugs in migration 0024.
//
// `synonyms` are the RAW spellings used for DB-side ilike matching — Postgres
// does no Arabic folding, so every variant is listed explicitly. The first
// entry of `synonyms` is also the canonical display spelling.

export type Dish = {
  slug: string;      // stable id, also the FK into dishes/place_dish_recommendations
  name: string;      // Arabic display name (proper spelling, ة not ه)
  emoji: string;
  synonyms: string[];
};

export const DISH_VOCABULARY: Dish[] = [
  { slug: "coffee",     name: "قهوة",       emoji: "☕",  synonyms: ["قهوة", "قهوه", "كوفي", "coffee", "اسبريسو", "espresso"] },
  { slug: "matcha",     name: "ماتشا",      emoji: "🍵",  synonyms: ["ماتشا", "matcha"] },
  { slug: "cookies",    name: "كوكيز",      emoji: "🍪",  synonyms: ["كوكيز", "كوكي", "cookie", "cookies"] },
  { slug: "cake",       name: "كيك",        emoji: "🍰",  synonyms: ["كيك", "كيكة", "كيكه", "cake"] },
  { slug: "cheesecake", name: "تشيزكيك",    emoji: "🍰",  synonyms: ["تشيزكيك", "cheesecake", "تشيز كيك"] },
  { slug: "croissant",  name: "كرواسون",    emoji: "🥐",  synonyms: ["كرواسون", "كرواسان", "كرسون", "croissant"] },
  { slug: "donut",      name: "دونات",      emoji: "🍩",  synonyms: ["دونات", "دوناتس", "donut", "donuts", "doughnut"] },
  { slug: "waffle",     name: "وافل",       emoji: "🧇",  synonyms: ["وافل", "waffle"] },
  { slug: "pancake",    name: "بان كيك",    emoji: "🥞",  synonyms: ["بان كيك", "بانكيك", "pancake"] },
  { slug: "kunafa",     name: "كنافة",      emoji: "🥮",  synonyms: ["كنافة", "كنافه", "kunafa", "knafeh", "kunafah"] },
  { slug: "chocolate",  name: "شوكولاتة",   emoji: "🍫",  synonyms: ["شوكولاتة", "شوكولاته", "شوكلت", "chocolate"] },
  { slug: "icecream",   name: "آيس كريم",   emoji: "🍨",  synonyms: ["آيس كريم", "ايس كريم", "بوظة", "بوظه", "جيلاتو", "ice cream", "gelato"] },
  { slug: "breakfast",  name: "فطور",       emoji: "🍳",  synonyms: ["فطور", "فطار", "breakfast"] },
  { slug: "burger",     name: "برجر",       emoji: "🍔",  synonyms: ["برجر", "برغر", "برقر", "همبرجر", "burger", "burgers"] },
  { slug: "pizza",      name: "بيتزا",      emoji: "🍕",  synonyms: ["بيتزا", "pizza"] },
  { slug: "pasta",      name: "باستا",      emoji: "🍝",  synonyms: ["باستا", "معكرونة", "معكرونه", "مكرونة", "مكرونه", "pasta"] },
  { slug: "steak",      name: "ستيك",       emoji: "🥩",  synonyms: ["ستيك", "steak"] },
  { slug: "grill",      name: "مشويات",     emoji: "🍢",  synonyms: ["مشويات", "مشاوي", "grill", "bbq"] },
  { slug: "shawarma",   name: "شاورما",     emoji: "🌯",  synonyms: ["شاورما", "shawarma"] },
  { slug: "sushi",      name: "سوشي",       emoji: "🍣",  synonyms: ["سوشي", "sushi"] },
  { slug: "mandi",      name: "مندي",       emoji: "🍛",  synonyms: ["مندي", "mandi"] },
  { slug: "kabsa",      name: "كبسة",       emoji: "🍚",  synonyms: ["كبسة", "كبسه", "kabsa"] },
];

// The shape foodSearch has always consumed.
export const SYNONYM_GROUPS: string[][] = DISH_VOCABULARY.map(d => d.synonyms);

export const DISH_BY_SLUG: Record<string, Dish> =
  Object.fromEntries(DISH_VOCABULARY.map(d => [d.slug, d]));
