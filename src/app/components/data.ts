export type Place = {
  id: string;
  name: string;
  nameEn: string;
  type: "كافيه" | "مطعم";
  category: string;
  district: string;
  address: string;
  image: string;
  images: string[];
  priceLevel: 1 | 2 | 3;
  rating: number;
  reviewCount: number;
  isFamilyFriendly: boolean;
  isKidsFriendly: boolean;
  isWorkFriendly: boolean;
  hasOutdoorSeating: boolean;
  hasParking: boolean;
  openingHours: string;
  isOpen: boolean;
  isNew: boolean;
  isVerified: boolean;
  description: string;
  tags: string[];
  orderLink?: string;
  bookingLink?: string;
  latitude: number;
  longitude: number;
  googleRating: number | null;
  googleReviewCount: number | null;
  googlePlaceId: string | null;
  qualityScore: number;
  qualityFlags: string[];
  status: "published" | "search_only" | "quarantined" | "retired";
  brand: string | null;
  // When our sync first saw this place — drives the «جديد» badge (isRecentlyAdded)
  createdAt: string;
};

// Latin aliases for the normalized (Arabic) brand column, so "Starbucks"
// finds every ستاربكس branch — not just the ones with Latin display names.
const BRAND_ALIASES: [string, string][] = [
  ["dunkin", "دانكن"], ["starbucks", "ستاربكس"], ["mcdonald", "ماكدونالدز"],
  ["kfc", "كنتاكي"], ["kentucky", "كنتاكي"], ["barns", "بارنز"], ["kudu", "كودو"],
  ["half million", "هاف مليون"], ["coffee address", "عنوان القهوة"], ["albaik", "البيك"], ["baik", "البيك"],
];

// Arabic is written with several interchangeable letter forms and optional
// diacritics, so an exact substring match fails constantly: «قهوه» found 6
// places where «قهوة» found 202, and 634 Latin-named places were unfindable
// by a lowercase query. Fold both scripts to one comparable form.
export function normalizeSearch(s: string): string {
  return s
    .toLowerCase()
    .replace(/[ً-ْٰـ]/g, "")   // harakat + tatweel
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")                             // ta marbuta <-> ha
    .replace(/[ىی]/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/\s+/g, " ")
    .trim();
}

// Place text search across Arabic name, English name, brand (with Latin
// aliases), district, category and tags — "Dunkin" must find دانكن, and
// «فطور» must match a place tagged for breakfast, not just one named for it.
export function placeMatchesQuery(p: Place, query: string): boolean {
  const q = normalizeSearch(query);
  if (!q) return true;
  const haystack = normalizeSearch(
    [p.name, p.nameEn ?? "", p.brand ?? "", p.district, p.category, (p.tags ?? []).join(" ")].join(" | "),
  );
  if (haystack.includes(q)) return true;
  // Latin brand aliases: match whole words so "baikal" doesn't pull every البيك
  if (q.length >= 3 && p.brand) {
    const nb = normalizeSearch(p.brand);
    return BRAND_ALIASES.some(([latin, ar]) =>
      nb === normalizeSearch(ar) && (latin === q || latin.startsWith(q) || q.startsWith(latin)),
    );
  }
  return false;
}

// "New" is derived from when we first saw the place, NOT from the stored
// is_new flag: that flag was true on 100% of the catalog because the only
// thing that cleared it ran inside the monthly sync AND filtered
// source='google', while the column defaults to 'manual'. A read-time rule
// can't drift, needs no cron, and covers admin-added places too.
export const NEW_WINDOW_DAYS = 14;

export function isRecentlyAdded(p: Place): boolean {
  if (!p.createdAt) return false;
  const age = Date.now() - new Date(p.createdAt).getTime();
  return age >= 0 && age < NEW_WINDOW_DAYS * 24 * 60 * 60 * 1000;
}

// Discovery surfaces (جديد في الرياض، مقترح لك، promotions) may only show
// published places with a healthy score and no tiny-sample-perfect-rating
// fingerprint — the pattern behind villas topping the feed.
export function isDiscoveryEligible(p: Place): boolean {
  return p.status === "published" && p.qualityScore >= 60 && !p.qualityFlags.includes("perfect_rating_low_sample");
}

// Blend in-app reviews with Google reviews, weighted by count, so a
// single app review doesn't displace thousands of Google ratings —
// and Google-discovered places never show a permanent 0★.
export function displayRating(place: Place): { rating: number; count: number } {
  const own = place.reviewCount > 0 ? { rating: place.rating, count: place.reviewCount } : null;
  const google =
    place.googleRating != null && (place.googleReviewCount ?? 0) > 0
      ? { rating: place.googleRating, count: place.googleReviewCount! }
      : null;
  if (own && google) {
    const count = own.count + google.count;
    const rating = Math.round(((own.rating * own.count + google.rating * google.count) / count) * 10) / 10;
    return { rating, count };
  }
  return own ?? google ?? { rating: place.rating, count: place.reviewCount };
}

export type List = {
  id: string;
  userId: string;
  title: string;
  description: string;
  isPublic: boolean;
  coverImage: string;
  placeIds: string[];
  likes: number;
  followers: number;
  isPaid: boolean;
  price: number | null;
  placeCount: number;
};

export type Offer = {
  id: string;
  placeId: string;
  title: string;
  description: string;
  endDate: string;
  discount?: string;
};

export const DISTRICTS = [
  "الجميع", "العليا", "حي السفارات", "الملقا", "النخيل", "الربوة", "الغدير", "الورود", "شمال الرياض", "جنوب الرياض"
];
