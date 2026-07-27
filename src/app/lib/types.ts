import type { Place, List, Offer } from "../components/data";

export type UserRole = "user" | "business" | "admin";

export type Profile = {
  id: string;
  name: string;
  username: string | null;
  avatar_url: string | null;
  bio: string;
  role: UserRole;
  owned_place_id: string | null;
  is_creator: boolean;
  notification_opt_in: boolean;
  personalization_opt_in: boolean;
  location: string | null;
  instagram: string | null;
  x_handle: string | null;
  tiktok: string | null;
  snapchat: string | null;
  website: string | null;
  created_at: string;
  updated_at: string;
};

export type Review = {
  id: string;
  userId: string;
  user: string;
  avatar: string | null;
  rating: number;
  comment: string;
  photos: string[];
  date: string;
};

export type PlaceRow = {
  id: string;
  name: string;
  name_en: string;
  type: "كافيه" | "مطعم";
  category: string;
  district: string;
  // Detail-only columns — absent from the card projection the catalog fetch
  // uses (see PLACE_CARD_COLS); present when a row is fetched by id.
  address?: string;
  image: string;
  images?: string[];
  price_level: 1 | 2 | 3;
  rating: number;
  review_count: number;
  is_family_friendly: boolean;
  is_kids_friendly: boolean;
  is_work_friendly: boolean;
  has_outdoor_seating: boolean;
  has_parking: boolean;
  opening_hours?: string;
  is_open: boolean;
  is_new: boolean;
  is_verified: boolean;
  description?: string;
  tags: string[];
  order_link?: string | null;
  booking_link?: string | null;
  latitude: number;
  longitude: number;
  google_rating: number | null;
  google_review_count: number | null;
  google_place_id?: string | null;
  quality_score: number;
  quality_flags: string[];
  status: "published" | "search_only" | "quarantined" | "retired";
  brand: string | null;
  created_at?: string;
};

export type ListRow = {
  id: string;
  user_id: string;
  title: string;
  description: string;
  is_public: boolean;
  cover_image: string;
  likes: number;
  followers: number;
  is_paid: boolean;
  price: number | null;
  place_count: number;
};

export type OfferRow = {
  id: string;
  place_id: string;
  title: string;
  description: string;
  discount: string | null;
  end_date: string;
};

export type ReviewRow = {
  id: string;
  user_id: string;
  rating: number;
  comment: string;
  photos: string[] | null;
  created_at: string;
  profiles: { name: string; avatar_url: string | null } | null;
};

// Some legitimate places have no photos on Google Maps — show a neutral
// placeholder instead of a broken image box.
export const PLACE_IMAGE_FALLBACK =
  "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=800&h=600&fit=crop&auto=format";

// Stored place photos are 800px-wide JPEGs (~165 KB each), so a 15-card feed
// pulled ~2.4 MB of imagery — several times the weight of all our code and API
// traffic combined. Supabase serves on-the-fly resizes from the same object,
// so asking for the display width cuts 66-85% with no re-sync and no extra
// storage. Widths are the CSS size at ~2x for retina.
export const IMG = { thumb: 200, card: 430, hero: 860 } as const;

// Undo sizedImage(): the original object URL, for onError retries.
export function originalImage(url: string): string {
  return url.includes("/storage/v1/render/image/public/")
    ? url.replace("/storage/v1/render/image/public/", "/storage/v1/object/public/").split("?")[0]
    : url;
}

export function sizedImage(url: string, width: number, quality = 70): string {
  // Only our own storage objects can be transformed; external URLs (the
  // Unsplash fallback, anything an admin pasted) pass through untouched.
  if (!url.includes("/storage/v1/object/public/")) return url;
  const base = url.replace("/storage/v1/object/public/", "/storage/v1/render/image/public/");
  // resize=contain is REQUIRED: passing width alone makes the transformer
  // center-crop to that width while keeping the original height (an 800x600
  // photo came back 430x600 — the middle slice), which silently mangled every
  // image. contain scales the whole frame and is smaller on the wire too.
  return `${base}${base.includes("?") ? "&" : "?"}width=${width}&resize=contain&quality=${quality}`;
}

export function mapPlaceRow(row: PlaceRow): Place {
  return {
    id: row.id,
    name: row.name,
    nameEn: row.name_en,
    type: row.type,
    category: row.category,
    district: row.district,
    address: row.address ?? "",
    image: row.image || PLACE_IMAGE_FALLBACK,
    // Card rows carry no gallery — fall back to the card image so any
    // consumer of images[0] still renders something real.
    images: row.images?.length ? row.images : [row.image || PLACE_IMAGE_FALLBACK],
    priceLevel: row.price_level,
    rating: row.rating,
    reviewCount: row.review_count,
    isFamilyFriendly: row.is_family_friendly,
    isKidsFriendly: row.is_kids_friendly,
    isWorkFriendly: row.is_work_friendly,
    hasOutdoorSeating: row.has_outdoor_seating,
    hasParking: row.has_parking,
    openingHours: row.opening_hours ?? "",
    isOpen: row.is_open,
    isNew: row.is_new,
    isVerified: row.is_verified,
    description: row.description ?? "",
    tags: row.tags,
    orderLink: row.order_link ?? undefined,
    bookingLink: row.booking_link ?? undefined,
    latitude: row.latitude,
    longitude: row.longitude,
    googleRating: row.google_rating,
    googleReviewCount: row.google_review_count,
    googlePlaceId: row.google_place_id ?? null,
    qualityScore: row.quality_score ?? 0,
    qualityFlags: row.quality_flags ?? [],
    status: row.status ?? "published",
    brand: row.brand ?? null,
    createdAt: row.created_at ?? "",
  };
}

export function mapListRow(row: ListRow, placeIds: string[] = []): List {
  return {
    id: row.id,
    userId: row.user_id,
    title: row.title,
    description: row.description,
    isPublic: row.is_public,
    coverImage: row.cover_image,
    placeIds,
    likes: row.likes,
    followers: row.followers,
    // ?? fallbacks keep the app working if migration 0004 isn't applied yet
    isPaid: row.is_paid ?? false,
    price: row.price ?? null,
    // For paid lists RLS hides list_places from non-buyers, so placeIds
    // can be empty while the list still contains places — the DB-side
    // counter is the truth for display.
    placeCount: row.place_count ?? placeIds.length,
  };
}

export function mapOfferRow(row: OfferRow): Offer {
  return {
    id: row.id,
    placeId: row.place_id,
    title: row.title,
    description: row.description,
    endDate: row.end_date,
    discount: row.discount ?? undefined,
  };
}

export function formatArabicRelativeTime(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "الآن";
  if (minutes < 60) return `منذ ${minutes} دقيقة`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `منذ ${hours} ساعة`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `منذ ${days} يوم`;
  const weeks = Math.floor(days / 7);
  if (weeks < 4) return `منذ ${weeks} أسبوع`;
  const months = Math.floor(days / 30);
  return `منذ ${months} شهر`;
}

export type NotificationType = "offer" | "follow" | "save" | "verify" | "new";

export type NotificationRow = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  image: string | null;
  related_place_id: string | null;
  related_user_id: string | null;
  is_read: boolean;
  created_at: string;
};

export type Notification = {
  id: string;
  type: NotificationType;
  title: string;
  body: string;
  time: string;
  unread: boolean;
  image: string | null;
  relatedPlaceId: string | null;
  relatedUserId: string | null;
};

export function mapNotificationRow(row: NotificationRow): Notification {
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    body: row.body,
    time: formatArabicRelativeTime(row.created_at),
    unread: !row.is_read,
    image: row.image,
    relatedPlaceId: row.related_place_id,
    relatedUserId: row.related_user_id,
  };
}

export function mapReviewRow(row: ReviewRow): Review {
  return {
    id: row.id,
    userId: row.user_id,
    // `||` not `??`: an empty-string profile name should also fall back
    user: row.profiles?.name || "مستخدم",
    avatar: row.profiles?.avatar_url ?? null,
    rating: row.rating,
    comment: row.comment,
    photos: row.photos ?? [],
    date: formatArabicRelativeTime(row.created_at),
  };
}
