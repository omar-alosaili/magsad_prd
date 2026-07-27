import { useEffect, useState } from "react";
import { Search, Bell, ChevronLeft, Heart, Bookmark, Star } from "lucide-react";
import { motion } from "motion/react";
import { isRecentlyAdded, type Place, type List, type Offer } from "./data";
import { getPlaces, getNewInRiyadh } from "../lib/places";
import { getPublicLists } from "../lib/lists";
import { getActiveOffers } from "../lib/offers";
import { getFollowFeed, type FeedItem } from "../lib/social";
import { getUnreadCount } from "../lib/notifications";
import { tappable } from "../lib/a11y";
import {
  getViewerInterests, getViewerSavedDistricts, suggestFromCatalog,
  rankPlacesByDistance, requestUserLocation,
} from "../lib/recommendations";
import { getActivePromotions } from "../lib/promotions";
import type { Profile } from "../lib/types";
import { NotificationsPanel } from "./NotificationsPanel";
import { FeaturedHero } from "./FeaturedHero";
import { sizedImage, IMG, PLACE_IMAGE_FALLBACK, originalImage } from "../lib/types";

type Props = {
  onPlaceClick: (id: string) => void;
  onListClick: (id: string) => void;
  onListSelect: (id: string) => void;
  onUserClick: (p: Profile) => void;
  onSearch: (query: string) => void;
  onSeeAllOffers: () => void;
  onSeeAllLists: () => void;
  savedPlaces: Set<string>;
  onSave: (id: string) => void;
  currentUser: Profile | null;
};

const fadeUp = (delay = 0) => ({
  initial: { opacity: 0, y: 16 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: 0.4, delay, ease: [0.22, 1, 0.36, 1] },
});

export function HomePage({ onPlaceClick, onListClick, onListSelect, onUserClick, onSearch, onSeeAllOffers, onSeeAllLists, savedPlaces, onSave, currentUser }: Props) {
  const [activeTag, setActiveTag] = useState("الكل");
  const [showNotifs, setShowNotifs] = useState(false);
  const [query, setQuery] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [lists, setLists] = useState<List[]>([]);
  const [offers, setOffers] = useState<Offer[]>([]);
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [newInRiyadh, setNewInRiyadh] = useState<Place[]>([]);
  const [suggested, setSuggested] = useState<Place[]>([]);
  const [featured, setFeatured] = useState<Place[]>([]);
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  const [locating, setLocating] = useState(false);
  const nearMe = userLoc !== null;

  // Distance sort is derived, so switching it off restores the
  // default (recency / personalized) order.
  const displayedNew = nearMe ? rankPlacesByDistance(newInRiyadh, userLoc.lat, userLoc.lng) : newInRiyadh;
  const displayedSuggested = nearMe ? rankPlacesByDistance(suggested, userLoc.lat, userLoc.lng) : suggested;

  // The catalog fetch failing used to leave a silently empty home screen —
  // indistinguishable from "there is nothing here". Surface it with a retry.
  const [catalogFailed, setCatalogFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    setCatalogFailed(false);
    getPlaces()
      .then(p => { setPlaces(p); setCatalogFailed(false); })
      .catch(() => setCatalogFailed(true));
    getPublicLists().then(setLists).catch(console.error);
    getActiveOffers().then(setOffers).catch(console.error);
  }, [reloadKey]);

  // "جديد في الرياض" — recently-discovered 4★+ places, straight from the
  // Google catalog (no admin curation).
  useEffect(() => {
    let cancelled = false;
    getNewInRiyadh().then(p => { if (!cancelled) setNewInRiyadh(p); }).catch(console.error);
    return () => { cancelled = true; };
  }, [reloadKey]);

  // Featured hero ("وين مقصدك اليوم؟") — admin-curated places published into
  // the `home_featured` placement, priority-ordered. Resolve each to the
  // loaded catalog (skip any place since deleted). Falls back to an
  // auto-picked top place when admins haven't featured anything.
  useEffect(() => {
    if (places.length === 0) return;
    let cancelled = false;
    getActivePromotions("home_featured")
      .then(promos => {
        if (cancelled) return;
        const byId = new Map(places.map(p => [p.id, p]));
        setFeatured(promos.map(pr => byId.get(pr.placeId)).filter((p): p is Place => !!p));
      })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [places]);

  // "مقترح لك" — personalized straight from the catalog (no admin curation):
  // scored by the viewer's onboarding interests + saved-district affinity,
  // falling back to top-rated for guests / opted-out users. Excludes what's
  // already in "جديد في الرياض" so the two sections don't overlap.
  useEffect(() => {
    if (places.length === 0) return;
    let cancelled = false;
    (async () => {
      const personalize = currentUser?.id && currentUser.personalization_opt_in !== false;
      let interests = new Set<string>();
      let savedDistricts = new Set<string>();
      if (personalize && currentUser?.id) {
        [interests, savedDistricts] = await Promise.all([
          getViewerInterests(currentUser.id).catch(() => new Set<string>()),
          getViewerSavedDistricts(currentUser.id, places).catch(() => new Set<string>()),
        ]);
      }
      if (cancelled) return;
      const exclude = new Set(newInRiyadh.map(p => p.id));
      setSuggested(suggestFromCatalog(places, interests, savedDistricts, { exclude }));
    })();
    return () => { cancelled = true; };
  }, [places, newInRiyadh, currentUser?.id, currentUser?.personalization_opt_in]);

  // "الأقرب لي": explicit tap → browser permission prompt → local sort.
  const toggleNearMe = () => {
    if (nearMe) { setUserLoc(null); return; }
    setLocating(true);
    requestUserLocation()
      .then(setUserLoc)
      .catch(() => {/* permission denied or unavailable — keep default order */})
      .finally(() => setLocating(false));
  };

  useEffect(() => {
    if (currentUser?.id) getFollowFeed(currentUser.id).then(setFeed).catch(console.error);
    else setFeed([]);
  }, [currentUser?.id]);

  // Real unread badge — no more permanently-lit dot.
  const [unread, setUnread] = useState(0);
  useEffect(() => {
    if (currentUser?.id) getUnreadCount(currentUser.id).then(setUnread).catch(console.error);
    else setUnread(0);
  }, [currentUser?.id]);

  const matchesTag = (p: Place, tag: string = activeTag): boolean => {
    switch (tag) {
      case "كافيهات":       return p.type === "كافيه";
      case "مطاعم":         return p.type === "مطعم";
      case "للعمل":         return p.isWorkFriendly;
      case "عائلي":         return p.isFamilyFriendly;
      // category is admin-curated (empty on nearly every place) and 54% of
      // places have no tags, so a tags-only match hid most of the catalog —
      // fall back to the name, which the sync always fills.
      case "فطور":          return p.category.includes("فطور") || p.tags.some(t => t.includes("فطور"))
                                   || p.name.includes("فطور") || p.name.includes("بريكفاست")
                                   || (p.nameEn ?? "").toLowerCase().includes("breakfast");
      case "جلسات خارجية":  return p.hasOutdoorSeating;
      case "جديد":          return isRecentlyAdded(p);
      default:              return true; // "الكل"
    }
  };
  // Only offer a chip that can actually return something: the sync leaves
  // is_work_friendly false on the entire catalog, so «للعمل» was a guaranteed
  // empty state. Chips re-appear on their own once the data supports them.
  const ALL_TAGS = ["الكل", "كافيهات", "مطاعم", "للعمل", "عائلي", "فطور", "جلسات خارجية", "جديد"];
  const tags = places.length
    ? ALL_TAGS.filter(t => t === "الكل" || places.some(p => matchesTag(p, t)))
    : ALL_TAGS;

  const taggedPlaces = places.filter(p => matchesTag(p));
  const featuredPlace = [...taggedPlaces].sort((a, b) => (b.isVerified ? 1 : 0) - (a.isVerified ? 1 : 0) || b.rating - a.rating)[0];

  const submitSearch = () => { if (query.trim()) onSearch(query.trim()); };

  return (
    <>
      <NotificationsPanel
        open={showNotifs}
        onClose={() => setShowNotifs(false)}
        userId={currentUser?.id ?? null}
        onPlaceClick={onPlaceClick}
      />

      <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
        {catalogFailed && (
          <div role="alert" className="mx-5 mt-14 mb-2 bg-danger-soft border border-border rounded-2xl px-4 py-3 flex items-center justify-between gap-3">
            <p className="text-xs text-danger">تعذّر تحميل الأماكن — تأكد من اتصالك بالإنترنت</p>
            <button
              onClick={() => setReloadKey(k => k + 1)}
              className="text-xs font-semibold text-accent whitespace-nowrap px-3 py-1.5 rounded-xl bg-card border border-border"
            >
              إعادة المحاولة
            </button>
          </div>
        )}
        {/* Header */}
        <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm px-5 pt-14 pb-4">
          <div className="flex items-center justify-between mb-4">
            <motion.div {...fadeUp(0)}>
              <p className="text-sm text-muted-foreground">وين مقصدك اليوم؟</p>
              <h1 className="text-xl font-bold text-foreground">
                مساء الخير{currentUser?.name ? `، ${currentUser.name}` : ""} 👋
              </h1>
            </motion.div>
            <motion.div {...fadeUp(0.05)} className="flex items-center gap-2">
              <button
                onClick={() => { setShowNotifs(true); setUnread(0); }}
                aria-label={unread > 0 ? `الإشعارات، ${unread} غير مقروء` : "الإشعارات"}
                className="relative w-11 h-11 rounded-full bg-card border border-border flex items-center justify-center hover:bg-muted transition-colors"
              >
                <Bell size={18} className="text-foreground" />
                {unread > 0 && (
                  <span className="absolute top-1.5 right-1.5 min-w-[16px] h-4 px-1 bg-accent rounded-full border-2 border-background flex items-center justify-center text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread.toLocaleString("en-US")}
                  </span>
                )}
              </button>
              {currentUser?.avatar_url && (
                <img
                  src={sizedImage(currentUser.avatar_url, IMG.thumb)}
                  alt="profile"
                  className="w-10 h-10 rounded-full object-cover border-2 border-accent"
          loading="lazy"
          decoding="async"
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
              )}
            </motion.div>
          </div>

          {/* Search Bar */}
          <motion.div {...fadeUp(0.08)} className="relative">
            <Search size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") submitSearch(); }}
              placeholder="ابحث عن مكان أو حي..."
              className="w-full bg-card border border-border rounded-2xl pr-11 pl-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all"
            />
          </motion.div>
        </div>

        {/* Category Tags */}
        <motion.div {...fadeUp(0.1)} className="px-5 mb-6">
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide" style={{ direction: "rtl" }}>
            {tags.map(tag => (
              <button
                key={tag}
                onClick={() => setActiveTag(tag)}
                className={`flex-shrink-0 px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  activeTag === tag
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "bg-card border border-border text-foreground hover:border-primary/30"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Follow feed — activity from people you follow */}
        {feed.length > 0 && (
          <motion.div {...fadeUp(0.11)} className="mb-8">
            <div className="flex items-center justify-between px-5 mb-4">
              <h2 className="text-base font-bold text-foreground">ممن تتابع 👀</h2>
            </div>
            <div className="px-5 flex flex-col gap-3">
              {feed.slice(0, 8).map(item => {
                const actor = (
                  <button
                    onClick={() => item.actorUsername && onUserClick({ username: item.actorUsername, name: item.actorName } as Profile)}
                    className="text-xs text-accent font-semibold"
                  >
                    @{item.actorUsername ?? item.actorName}
                  </button>
                );
                if (item.kind === "list") {
                  return (
                    <div
                      key={`l-${item.id}`}
                      {...tappable(() => onListSelect(item.list.id), item.list.title)}
                      className="flex gap-3 p-3 bg-card border border-border rounded-2xl cursor-pointer hover:shadow-md transition-shadow"
                    >
                      <img src={sizedImage(item.list.coverImage, IMG.thumb)} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-muted-foreground mb-0.5">{actor} أنشأ قائمة</p>
                        <h3 className="text-sm font-semibold text-foreground truncate">{item.list.title}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{item.list.placeCount} أماكن</p>
                      </div>
                    </div>
                  );
                }
                const p = item.review.place!;
                return (
                  <div
                    key={`r-${item.id}`}
                    {...tappable(() => onPlaceClick(p.id), p.name)}
                    className="flex gap-3 p-3 bg-card border border-border rounded-2xl cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <img src={sizedImage(p.image, IMG.thumb)} alt="" className="w-14 h-14 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-xs text-muted-foreground mb-0.5">{actor} أوصى بـ</p>
                      <div className="flex items-center gap-1.5">
                        <h3 className="text-sm font-semibold text-foreground truncate">{p.name}</h3>
                        <span className="flex items-center gap-0.5 text-xs text-rating"><Star size={10} className="fill-rating text-rating" />{item.review.rating}</span>
                      </div>
                      {item.review.comment && <p className="text-xs text-muted-foreground truncate mt-0.5">{item.review.comment}</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Featured Hero — admin-curated "وين مقصدك اليوم؟" showcase when any
            place is published to it, otherwise an auto-picked brand hero. */}
        {featured.length > 0 ? (
          <FeaturedHero places={featured} savedPlaces={savedPlaces} onSave={onSave} onPlaceClick={onPlaceClick} />
        ) : featuredPlace ? (
          <motion.div {...fadeUp(0.12)} className="px-5 mb-8">
            <motion.div
              className="relative h-56 rounded-3xl overflow-hidden cursor-pointer"
              {...tappable(() => onPlaceClick(featuredPlace.id), featuredPlace.name)}
              whileHover={{ scale: 1.01 }}
              transition={{ duration: 0.3 }}
            >
              <img
                src="https://images.unsplash.com/photo-1722951812233-8fd37330dfb9?w=900&h=600&fit=crop&auto=format"
                alt="الرياض"
                className="w-full h-full object-cover"
          loading="lazy"
          decoding="async"
          onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }}
        />
              <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />

              <div className="absolute top-4 right-4">
                <span className="bg-accent text-white text-xs px-3 py-1.5 rounded-full font-semibold shadow-lg">
                  ⭐ مميز هذا الأسبوع
                </span>
              </div>

              <button
                onClick={(e) => { e.stopPropagation(); onSave(featuredPlace.id); }}
                className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md"
              >
                <Bookmark
                  size={16}
                  className={savedPlaces.has(featuredPlace.id) ? "fill-accent text-accent" : "text-foreground"}
                />
              </button>

              <div className="absolute bottom-4 right-4 left-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-white text-xl font-bold">وين مقصدك اليوم؟</h2>
                    <p className="text-white/65 text-sm mt-1">اكتشف أماكن تستاهل التجربة في الرياض</p>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); onPlaceClick(featuredPlace.id); }}
                    className="flex-shrink-0 bg-white/20 backdrop-blur-sm border border-white/30 rounded-2xl px-3 py-1.5 hover:bg-white/30 transition-colors"
                  >
                    <span className="text-white text-xs font-semibold">اكتشف ←</span>
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        ) : null}

        {/* Discovery: automatic catalog-driven sections */}
        {(displayedNew.length > 0 || displayedSuggested.length > 0) && (
          <motion.div {...fadeUp(0.14)} className="mb-2">
            <div className="flex items-center justify-between px-5 mb-1">
              <span />
              <button
                onClick={toggleNearMe}
                disabled={locating}
                className={`flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-full border transition-all ${
                  nearMe ? "bg-primary text-primary-foreground border-primary" : "bg-card text-foreground border-border"
                }`}
              >
                📍 {locating ? "جارٍ تحديد موقعك..." : nearMe ? "الأقرب لي ✓" : "الأقرب لي"}
              </button>
            </div>
          </motion.div>
        )}

        {displayedNew.length > 0 && (
          <motion.div {...fadeUp(0.15)} className="mb-8">
            <div className="px-5 mb-4">
              <h2 className="text-base font-bold text-foreground">جديد في الرياض ✨</h2>
            </div>
            <div className="flex gap-3 px-5 overflow-x-auto pb-1 scrollbar-hide" style={{ direction: "rtl" }}>
              {displayedNew.slice(0, 12).map(place => (
                <div key={place.id} {...tappable(() => onPlaceClick(place.id), place.name)} className="flex-shrink-0 w-40 cursor-pointer">
                  <div className="relative h-28 rounded-2xl overflow-hidden">
                    <img src={sizedImage(place.image, IMG.card)} alt={place.name} className="w-full h-full object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                    {isRecentlyAdded(place) && (
                      <span className="absolute top-2 right-2 text-[10px] px-1.5 py-0.5 rounded-full bg-accent text-white font-medium">جديد</span>
                    )}
                  </div>
                  <h3 className="text-xs font-semibold text-foreground mt-2 truncate">{place.name}</h3>
                  <p className="text-[11px] text-muted-foreground">{place.district}{place.googleRating ? ` · ★ ${place.googleRating}` : ""}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {displayedSuggested.length > 0 && (
          <motion.div {...fadeUp(0.16)} className="mb-8">
            <div className="px-5 mb-4">
              <h2 className="text-base font-bold text-foreground">مقترح لك 💡</h2>
            </div>
            <div className="flex gap-3 px-5 overflow-x-auto pb-1 scrollbar-hide" style={{ direction: "rtl" }}>
              {displayedSuggested.slice(0, 12).map(place => (
                <div key={place.id} {...tappable(() => onPlaceClick(place.id), place.name)} className="flex-shrink-0 w-40 cursor-pointer">
                  <div className="relative h-28 rounded-2xl overflow-hidden">
                    <img src={sizedImage(place.image, IMG.card)} alt={place.name} className="w-full h-full object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                  </div>
                  <h3 className="text-xs font-semibold text-foreground mt-2 truncate">{place.name}</h3>
                  <p className="text-[11px] text-muted-foreground">{place.district}{place.googleRating ? ` · ★ ${place.googleRating}` : ""}</p>
                </div>
              ))}
            </div>
          </motion.div>
        )}

        {/* Offers */}
        {offers.length > 0 && (
          <motion.div {...fadeUp(0.16)} className="mb-8">
            <div className="flex items-center justify-between px-5 mb-4">
              <h2 className="text-base font-bold text-foreground">عروض قريبة منك 🎁</h2>
              <button onClick={onSeeAllOffers} className="text-accent text-sm font-medium flex items-center gap-1">
                الكل <ChevronLeft size={14} className="rotate-180" />
              </button>
            </div>
            <div className="flex gap-3 px-5 overflow-x-auto pb-1 scrollbar-hide" style={{ direction: "rtl" }}>
              {offers.map((offer, i) => {
                const place = places.find(p => p.id === offer.placeId);
                if (!place) return null;
                return (
                  <motion.div
                    key={offer.id}
                    initial={{ opacity: 0, x: 20 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.18 + i * 0.06 }}
                    className="flex-shrink-0 w-64 bg-card rounded-2xl overflow-hidden border border-border cursor-pointer hover:shadow-md transition-shadow"
                    {...tappable(() => onPlaceClick(place.id), `${offer.title} — ${place.name}`)}
                  >
                    <div className="relative h-32">
                      <img src={sizedImage(place.image, IMG.card)} alt={place.name} className="w-full h-full object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                      {offer.discount && (
                        <div className="absolute top-2 right-2 bg-accent text-white text-xs font-bold px-2.5 py-1 rounded-lg shadow-sm">
                          {offer.discount} خصم
                        </div>
                      )}
                    </div>
                    <div className="p-3">
                      <p className="text-xs text-muted-foreground mb-1">{place.name}</p>
                      <h3 className="text-sm font-semibold text-foreground leading-snug">{offer.title}</h3>
                      <p className="text-xs text-accent mt-1.5 font-medium">ينتهي {offer.endDate}</p>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        )}

        {/* Popular Lists */}
        {lists.length > 0 && (
          <motion.div {...fadeUp(0.2)} className="mb-8">
            <div className="flex items-center justify-between px-5 mb-4">
              <h2 className="text-base font-bold text-foreground">قوائم رائجة 🔥</h2>
              <button onClick={onSeeAllLists} className="text-accent text-sm font-medium flex items-center gap-1">
                الكل <ChevronLeft size={14} className="rotate-180" />
              </button>
            </div>
            <div className="flex gap-3 px-5 overflow-x-auto pb-1 scrollbar-hide" style={{ direction: "rtl" }}>
              {lists.slice(0, 4).map((list, i) => (
                <motion.div
                  key={list.id}
                  initial={{ opacity: 0, x: 20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.22 + i * 0.06 }}
                  className="flex-shrink-0 w-48 cursor-pointer group"
                  {...tappable(() => onListClick(list.id), list.title)}
                >
                  <div className="relative h-52 rounded-2xl overflow-hidden">
                    <img
                      src={sizedImage(list.coverImage, IMG.card)}
                      alt={list.title}
                      className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
          decoding="async"
          onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }}
        />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/65 to-transparent" />
                    <div className="absolute bottom-3 right-3 left-3">
                      <h3 className="text-white text-sm font-semibold leading-tight">{list.title}</h3>
                      <p className="text-white/70 text-xs mt-0.5">{list.placeCount} أماكن</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-2 px-1">
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Heart size={11} /> {list.likes}
                    </span>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Bookmark size={11} /> {list.followers}
                    </span>
                  </div>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {places.length === 0 && !catalogFailed && (
          <div className="px-5 py-16 flex justify-center" aria-live="polite" aria-busy="true">
            <div className="w-7 h-7 rounded-full animate-spin" style={{ border: "3px solid var(--muted)", borderTopColor: "var(--accent)" }} />
            <span className="sr-only">جارٍ تحميل الأماكن…</span>
          </div>
        )}
        {places.length > 0 && taggedPlaces.length === 0 && (
          <div className="px-5 py-16 text-center text-muted-foreground text-sm">
            لا توجد أماكن تطابق "{activeTag}" حالياً
          </div>
        )}
      </div>
    </>
  );
}
