import { useEffect, useState } from "react";
import { Search, SlidersHorizontal, X, Wifi, Users, Baby, Trees, Map, List, MapPin, UtensilsCrossed, Star } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { APIProvider, Map as GoogleMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { displayRating, placeMatchesQuery, isRecentlyAdded, type Place } from "./data";
import { getPlaces } from "../lib/places";
import { searchProfiles } from "../lib/profile";
import { searchFood, type FoodResult } from "../lib/foodSearch";
import { tappable } from "../lib/a11y";
import type { Profile } from "../lib/types";
import { PlaceCard } from "./PlaceCard";
import { sizedImage, IMG } from "../lib/types";

// Real Google Map when a browser key is configured; the styled mock map
// remains as a keyless fallback.
// Browser Maps key. Public by design (it ships in the client bundle) and
// protected by the HTTP-referrer + API restrictions on the key itself —
// so it must allow the production domain (magsad.app) in Google Cloud.
const GOOGLE_MAPS_KEY = (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) || "AIzaSyDZ8z953e8wTsY69xTPkILItNBxNE8du0Q";
const RIYADH_CENTER = { lat: 24.744, lng: 46.68 };

type Props = {
  onPlaceClick: (id: string) => void;
  onUserClick: (p: Profile) => void;
  currentUserId: string | null;
  savedPlaces: Set<string>;
  onSave: (id: string) => void;
  initialQuery?: string;
};

type Filters = {
  district: string;
  type: string;
  isWorkFriendly: boolean;
  isFamilyFriendly: boolean;
  isKidsFriendly: boolean;
  hasOutdoorSeating: boolean;
  isOpen: boolean;
  isNew: boolean;
  priceLevel: number | null;
};

const defaultFilters: Filters = {
  district: "الجميع",
  type: "الكل",
  isWorkFriendly: false,
  isFamilyFriendly: false,
  isKidsFriendly: false,
  hasOutdoorSeating: false,
  isOpen: false,
  isNew: false,
  priceLevel: null,
};

// Projects a place's real lat/lng onto the mock map's 0-100% container space.
const LAT_RANGE: [number, number] = [24.55, 24.95];
const LNG_RANGE: [number, number] = [46.55, 46.85];
function projectToMap(lat: number, lng: number) {
  const top = 85 - ((lat - LAT_RANGE[0]) / (LAT_RANGE[1] - LAT_RANGE[0])) * 70;
  const left = 15 + ((lng - LNG_RANGE[0]) / (LNG_RANGE[1] - LNG_RANGE[0])) * 70;
  return { top: Math.min(85, Math.max(15, top)), left: Math.min(85, Math.max(15, left)) };
}

// With thousands of places, rendering every card at once freezes the page —
// paginate the list and grow it on demand.
const LIST_PAGE_SIZE = 60;

// Suggested dishes shown before the user types in the Food tab
const FOOD_SUGGESTIONS = ["كوكيز 🍪", "بيتزا 🍕", "برجر 🍔", "ماتشا 🍵", "كنافة 🥮", "فطور 🍳", "آيس كريم 🍨", "سوشي 🍣"];

export function ExplorePage({ onPlaceClick, onUserClick, currentUserId, savedPlaces, onSave, initialQuery }: Props) {
  const [mainTab, setMainTab] = useState<"places" | "users" | "food">("places");
  const [userQuery, setUserQuery] = useState("");
  const [userResults, setUserResults] = useState<Profile[]>([]);
  const [usersLoading, setUsersLoading] = useState(false);
  const [foodQuery, setFoodQuery] = useState("");
  const [foodTerm, setFoodTerm] = useState("");
  const [foodResults, setFoodResults] = useState<FoodResult[]>([]);
  const [foodLoading, setFoodLoading] = useState(false);

  useEffect(() => {
    if (mainTab !== "food") return; // keep results across tab switches
    if (!foodQuery.trim()) { setFoodResults([]); setFoodTerm(""); setFoodLoading(false); return; }
    setFoodLoading(true);
    // cancelled guards against out-of-order responses: an in-flight
    // search for a superseded query must not overwrite newer results
    let cancelled = false;
    const t = setTimeout(() => {
      searchFood(foodQuery, currentUserId)
        .then(({ term, results }) => {
          if (cancelled) return;
          setFoodTerm(term);
          setFoodResults(results);
        })
        .catch(console.error)
        .finally(() => { if (!cancelled) setFoodLoading(false); });
    }, 400);
    return () => { cancelled = true; clearTimeout(t); };
  }, [foodQuery, mainTab, currentUserId]);

  useEffect(() => {
    if (mainTab !== "users") return;
    setUsersLoading(true);
    // cancelled guards against out-of-order responses (same as the food
    // search): a slow reply for a superseded query must not overwrite
    // newer results.
    let cancelled = false;
    const t = setTimeout(() => {
      searchProfiles(userQuery, currentUserId, 30)
        .then(res => { if (!cancelled) setUserResults(res); })
        .catch(console.error)
        .finally(() => { if (!cancelled) setUsersLoading(false); });
    }, 300);
    return () => { cancelled = true; clearTimeout(t); };
  }, [userQuery, mainTab, currentUserId]);

  const [places, setPlaces] = useState<Place[]>([]);
  const [query, setQuery] = useState(initialQuery ?? "");
  const [filters, setFilters] = useState<Filters>(defaultFilters);
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<"list" | "map">("list");
  const [mapSelected, setMapSelected] = useState<string | null>(null);
  const [listLimit, setListLimit] = useState(LIST_PAGE_SIZE);
  const [placesLoading, setPlacesLoading] = useState(true);

  // Reset pagination whenever the result set changes
  useEffect(() => { setListLimit(LIST_PAGE_SIZE); }, [query, filters]);

  useEffect(() => {
    getPlaces().then(setPlaces).catch(console.error).finally(() => setPlacesLoading(false));
  }, []);

  // Offer only districts that actually have places, so the filter always matches data.
  const districts = ["الجميع", ...[...new Set(places.map(p => p.district).filter(Boolean))].sort()];

  const activeFilterCount = Object.entries(filters).filter(([k, v]) => {
    if (k === "district") return v !== "الجميع";
    if (k === "type") return v !== "الكل";
    if (k === "priceLevel") return v !== null;
    return v === true;
  }).length;

  const filtered = places.filter(p => {
    if (!placeMatchesQuery(p, query)) return false;
    if (filters.district !== "الجميع" && p.district !== filters.district) return false;
    if (filters.type !== "الكل" && p.type !== filters.type) return false;
    if (filters.isWorkFriendly && !p.isWorkFriendly) return false;
    if (filters.isFamilyFriendly && !p.isFamilyFriendly) return false;
    if (filters.isKidsFriendly && !p.isKidsFriendly) return false;
    if (filters.hasOutdoorSeating && !p.hasOutdoorSeating) return false;
    if (filters.isOpen && !p.isOpen) return false;
    if (filters.isNew && !isRecentlyAdded(p)) return false;
    if (filters.priceLevel && p.priceLevel !== filters.priceLevel) return false;
    return true;
  });

  const toggle = (key: keyof Filters) => {
    setFilters(f => ({ ...f, [key]: !f[key as keyof typeof f] }));
  };

  const selectedPlace = places.find(p => p.id === mapSelected);

  // Cap rendered map markers — thousands of DOM markers stall the map.
  // Highest-rated places win the slots (narrowing filters shows the rest);
  // the selected place always renders.
  const MAP_MARKER_CAP = 500;
  const mapMarkers = (() => {
    if (filtered.length <= MAP_MARKER_CAP) return filtered;
    const top = [...filtered]
      .sort((a, b) => displayRating(b).rating - displayRating(a).rating)
      .slice(0, MAP_MARKER_CAP);
    if (mapSelected && !top.some(p => p.id === mapSelected)) {
      const sel = filtered.find(p => p.id === mapSelected);
      if (sel) top.push(sel);
    }
    return top;
  })();

  return (
    <div className="flex-1 flex flex-col overflow-hidden" dir="rtl">
      {/* Sticky Header */}
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm px-5 pt-14 pb-3">
        <div className="flex items-center justify-between mb-3">
          <h1 className="text-xl font-bold text-foreground">اكتشف</h1>
          {/* Places view toggle — only in the Places tab */}
          {mainTab === "places" && (
            <div className="flex gap-1 bg-muted p-1 rounded-2xl">
              <button
                onClick={() => setViewMode("list")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  viewMode === "list" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                <List size={13} /> قائمة
              </button>
              <button
                onClick={() => setViewMode("map")}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-all ${
                  viewMode === "map" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
                }`}
              >
                <Map size={13} /> خريطة
              </button>
            </div>
          )}
        </div>

        {/* Places / Food / Users tabs */}
        <div className="flex gap-1 bg-muted p-1 rounded-2xl mb-3">
          {([
            { key: "places" as const, label: "الأماكن", icon: <MapPin size={14} /> },
            { key: "food" as const, label: "الأطعمة", icon: <UtensilsCrossed size={14} /> },
            { key: "users" as const, label: "المستخدمون", icon: <Users size={14} /> },
          ]).map(t => (
            <button
              key={t.key}
              onClick={() => setMainTab(t.key)}
              className={`flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl text-sm font-semibold transition-all ${
                mainTab === t.key ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {mainTab === "food" && (
          <div className="relative">
            <Search size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={foodQuery}
              onChange={e => setFoodQuery(e.target.value)}
              placeholder="ابحث عن طبق أو حلا أو مشروب..."
              className="w-full bg-card border border-border rounded-2xl pr-11 pl-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
        )}

        {mainTab === "users" && (
          <div className="relative">
            <Search size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              dir="auto"
              value={userQuery}
              onChange={e => setUserQuery(e.target.value)}
              placeholder="ابحث بالاسم أو المعرّف @..."
              className="w-full bg-card border border-border rounded-2xl pr-11 pl-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
            />
          </div>
        )}

        {mainTab === "places" && (
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search size={16} className="absolute right-4 top-1/2 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="مكان، حي، تصنيف..."
              className="w-full bg-card border border-border rounded-2xl pr-11 pl-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/50 transition-all"
            />
            {query && (
              <button onClick={() => setQuery("")} className="absolute left-3 top-1/2 -translate-y-1/2">
                <X size={14} className="text-muted-foreground" />
              </button>
            )}
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`relative flex-shrink-0 w-12 h-12 rounded-2xl border flex items-center justify-center transition-all ${
              showFilters || activeFilterCount > 0
                ? "bg-primary border-primary text-primary-foreground"
                : "bg-card border-border text-foreground"
            }`}
          >
            <SlidersHorizontal size={18} />
            {activeFilterCount > 0 && (
              <span className="absolute -top-1 -left-1 w-5 h-5 bg-accent text-white text-xs rounded-full flex items-center justify-center">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>
        )}
      </div>

      {/* Food tab: dish-based discovery */}
      {mainTab === "food" && (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {!foodQuery.trim() ? (
            <div className="pt-6">
              <p className="text-sm font-semibold text-foreground mb-1">وش تشتهي اليوم؟ 😋</p>
              <p className="text-xs text-muted-foreground mb-4">ابحث عن صنف — نرشح لك أفضل الأماكن حسب توصيات مستخدمي مقصد</p>
              <div className="flex flex-wrap gap-2">
                {FOOD_SUGGESTIONS.map(s => (
                  <button
                    key={s}
                    onClick={() => setFoodQuery(s.replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, "").trim())}
                    className="px-4 py-2.5 rounded-2xl bg-card border border-border text-sm font-medium hover:shadow-md transition-shadow"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          ) : foodLoading ? (
            /* always replace the list while searching — stale cards under
               a stale header must not stay clickable for a new query */
            <div className="text-center py-16">
              <div className="w-8 h-8 mx-auto mb-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">نحلل التوصيات...</p>
            </div>
          ) : foodResults.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">🍽️</p>
              <p className="text-foreground font-medium">لا توصيات لهذا الصنف بعد</p>
              <p className="text-muted-foreground text-sm mt-1">جرب صنفاً آخر أو كن أول من يوصي</p>
            </div>
          ) : (
            <div>
              <p className="text-xs text-muted-foreground mb-4">
                أفضل أماكن <span className="font-bold text-foreground">{foodTerm}</span> في الرياض — حسب توصيات مستخدمي مقصد وإشارات التقييم
              </p>
              <div className="flex flex-col gap-3">
                {foodResults.map((r, i) => (
                  <div
                    key={r.place.id}
                    {...tappable(() => onPlaceClick(r.place.id), r.place.name)}
                    className="bg-card border border-border rounded-2xl p-3 cursor-pointer hover:shadow-md transition-shadow"
                  >
                    <div className="flex gap-3">
                      <div className="relative flex-shrink-0">
                        <img src={sizedImage(r.place.image, IMG.thumb)} alt={r.place.name} className="w-20 h-20 rounded-xl object-cover" loading="lazy" decoding="async" />
                        <span className="absolute -top-1.5 -right-1.5 w-6 h-6 rounded-full bg-primary text-primary-foreground text-[10px] font-bold flex items-center justify-center">
                          {i + 1}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-bold text-foreground truncate">{r.place.name}</h3>
                          <span className="flex-shrink-0 px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs font-bold">
                            {r.score}٪ توصية
                          </span>
                        </div>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {r.place.district} · {"﷼".repeat(r.place.priceLevel)}
                          {r.place.googleRating ? <> · <Star size={9} className="inline fill-rating text-rating" /> {r.place.googleRating}</> : null}
                        </p>
                        {r.reasons.length > 0 && (
                          <p className="text-xs text-accent mt-1 truncate">{r.reasons[0]}</p>
                        )}
                      </div>
                    </div>
                    {r.comments.length > 0 && (
                      <p className="text-xs text-foreground bg-muted rounded-xl px-3 py-2 mt-2 line-clamp-2">
                        "{r.comments[0].text}" — <span className="text-muted-foreground">{r.comments[0].author}</span>
                      </p>
                    )}
                    <div className="flex items-center gap-1.5 mt-2 flex-wrap">
                      {r.recommenders > 0 && (
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-secondary text-secondary-foreground">
                          👥 {r.recommenders.toLocaleString("en-US")} موصٍ
                        </span>
                      )}
                      {r.sources.map(s => (
                        <span key={s} className="text-[10px] px-2 py-0.5 rounded-full bg-muted text-muted-foreground">{s}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Users tab: search results */}
      {mainTab === "users" && (
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {usersLoading && userResults.length === 0 ? (
            <div className="text-center py-16">
              <div className="w-8 h-8 mx-auto mb-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">جارٍ البحث...</p>
            </div>
          ) : userResults.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">👥</p>
              <p className="text-foreground font-medium">لا مستخدمين</p>
              <p className="text-muted-foreground text-sm mt-1">جرب اسماً أو معرّفاً آخر</p>
            </div>
          ) : (
            /* Dim + freeze stale rows while a newer query is in flight so
               the user can't act on results that no longer match the input */
            <div className={`flex flex-col gap-3 transition-opacity ${usersLoading ? "opacity-50 pointer-events-none" : ""}`}>
              {userResults.map(u => (
                <button
                  key={u.id}
                  onClick={() => onUserClick(u)}
                  className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl text-right hover:shadow-md transition-shadow"
                >
                  {u.avatar_url ? (
                    <img src={sizedImage(u.avatar_url, IMG.thumb)} alt={u.name} className="w-12 h-12 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" />
                  ) : (
                    <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-base font-bold text-muted-foreground">
                      {u.name?.[0] ?? "؟"}
                    </div>
                  )}
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground truncate">{u.name || "بلا اسم"}</h3>
                    {u.username && <p className="text-xs text-accent">@{u.username}</p>}
                    {u.bio && <p className="text-xs text-muted-foreground truncate mt-0.5">{u.bio}</p>}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Places tab content below */}
      {mainTab === "places" && (
      <>
      {/* Filters Panel */}
      <AnimatePresence>
        {showFilters && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25 }}
            className="overflow-hidden"
          >
            <div className="mx-5 mb-3 bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-semibold text-foreground">الفلاتر</h3>
                <button onClick={() => setFilters(defaultFilters)} className="text-xs text-accent font-medium">
                  مسح الكل
                </button>
              </div>

              <div className="mb-3">
                <p className="text-xs text-muted-foreground mb-2">النوع</p>
                <div className="flex gap-2">
                  {["الكل", "كافيه", "مطعم"].map(t => (
                    <button
                      key={t}
                      onClick={() => setFilters(f => ({ ...f, type: t }))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                        filters.type === t ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <p className="text-xs text-muted-foreground mb-2">السعر</p>
                <div className="flex gap-2">
                  {[null, 1, 2, 3].map(level => (
                    <button
                      key={level ?? "all"}
                      onClick={() => setFilters(f => ({ ...f, priceLevel: level }))}
                      className={`px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                        filters.priceLevel === level ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      }`}
                    >
                      {level === null ? "الكل" : level === 1 ? "＄" : level === 2 ? "＄＄" : "＄＄＄"}
                    </button>
                  ))}
                </div>
              </div>

              <div className="mb-3">
                <p className="text-xs text-muted-foreground mb-2">الحي</p>
                <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
                  {districts.map(d => (
                    <button
                      key={d}
                      onClick={() => setFilters(f => ({ ...f, district: d }))}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-xl text-xs font-medium transition-all ${
                        filters.district === d ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <p className="text-xs text-muted-foreground mb-2">المميزات</p>
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { key: "isWorkFriendly" as const, label: "للعمل", icon: <Wifi size={13} /> },
                    { key: "isFamilyFriendly" as const, label: "للعائلة", icon: <Users size={13} /> },
                    { key: "isKidsFriendly" as const, label: "للأطفال", icon: <Baby size={13} /> },
                    { key: "hasOutdoorSeating" as const, label: "جلسات خارجية", icon: <Trees size={13} /> },
                    { key: "isOpen" as const, label: "مفتوح الآن", icon: null },
                    { key: "isNew" as const, label: "جديد", icon: null },
                  ].map(({ key, label, icon }) => (
                    <button
                      key={key}
                      onClick={() => toggle(key)}
                      className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-medium transition-all ${
                        filters[key] ? "bg-primary text-primary-foreground" : "bg-muted text-foreground"
                      }`}
                    >
                      {icon}
                      {label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Content */}
      {viewMode === "list" ? (
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {placesLoading ? (
            /* Don't flash "0 مكان" while the catalog downloads */
            <div className="text-center py-16">
              <div className="w-8 h-8 mx-auto mb-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">جارٍ تحميل الأماكن...</p>
            </div>
          ) : (
          <>
          <p className="text-sm text-muted-foreground mb-4 pt-1">
            {filtered.length} مكان{query ? ` لـ "${query}"` : ""}
          </p>

          {filtered.length === 0 ? (
            <div className="text-center py-16">
              <p className="text-4xl mb-3">🔍</p>
              <p className="text-foreground font-medium">ما لقينا نتائج</p>
              <p className="text-muted-foreground text-sm mt-1">جرب كلمة أخرى أو عدّل الفلاتر</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {filtered.slice(0, listLimit).map((place, i) => (
                <motion.div
                  key={place.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i, 10) * 0.05 }}
                >
                  <PlaceCard
                    place={place}
                    onClick={() => onPlaceClick(place.id)}
                    onSave={onSave}
                    saved={savedPlaces.has(place.id)}
                  />
                </motion.div>
              ))}
              {filtered.length > listLimit && (
                <button
                  onClick={() => setListLimit(l => l + LIST_PAGE_SIZE)}
                  className="w-full py-3.5 rounded-2xl bg-muted text-foreground text-sm font-semibold hover:bg-secondary transition-colors"
                >
                  عرض المزيد ({filtered.length - listLimit} متبقي)
                </button>
              )}
            </div>
          )}
          </>
          )}
        </div>
      ) : (
        /* Map View */
        <div className="flex-1 relative overflow-hidden">
          {GOOGLE_MAPS_KEY ? (
            /* Real Google Map */
            <APIProvider apiKey={GOOGLE_MAPS_KEY} language="ar" region="SA">
              <GoogleMap
                defaultCenter={RIYADH_CENTER}
                defaultZoom={11}
                mapId="DEMO_MAP_ID"
                gestureHandling="greedy"
                disableDefaultUI
                zoomControl
                clickableIcons={false} // don't let Google's own POI pins hijack taps with their info window
                style={{ width: "100%", height: "100%" }}
              >
                {mapMarkers.map(place => {
                  const isSelected = mapSelected === place.id;
                  return (
                    <AdvancedMarker
                      key={place.id}
                      position={{ lat: place.latitude, lng: place.longitude }}
                      zIndex={isSelected ? 10 : 1}
                      onClick={() => setMapSelected(isSelected ? null : place.id)}
                    >
                      {isSelected ? (
                        <div className="relative flex flex-col items-center" dir="rtl">
                          <div className="px-2.5 py-1.5 rounded-2xl shadow-lg border-2 flex items-center gap-1.5 bg-primary text-white border-primary">
                            <img src={sizedImage(place.image, IMG.thumb)} alt="" className="w-5 h-5 rounded-full object-cover" loading="lazy" decoding="async" />
                            <span className="text-xs font-bold whitespace-nowrap">{place.name}</span>
                          </div>
                          <div className="w-2 h-2 rotate-45 mt-[-4px] bg-primary" />
                        </div>
                      ) : (
                        <div
                          className={`w-3.5 h-3.5 rounded-full border-2 border-white shadow-md ${
                            place.isOpen ? "bg-accent" : "bg-gray-400"
                          }`}
                        />
                      )}
                    </AdvancedMarker>
                  );
                })}
              </GoogleMap>
            </APIProvider>
          ) : (
          /* Keyless fallback: styled mock map */
          <div className="absolute inset-0" style={{
            background: "linear-gradient(135deg, #e8f4e8 0%, #d4e8d4 30%, #c8dfc8 60%, #e0e8d0 100%)",
          }}>
            {/* Grid lines */}
            {[...Array(12)].map((_, i) => (
              <div key={`h${i}`} className="absolute w-full border-t border-white/40" style={{ top: `${(i + 1) * 8}%` }} />
            ))}
            {[...Array(8)].map((_, i) => (
              <div key={`v${i}`} className="absolute h-full border-r border-white/40" style={{ left: `${(i + 1) * 12.5}%` }} />
            ))}

            {/* Mock Roads */}
            <div className="absolute inset-0 opacity-60">
              <svg width="100%" height="100%" viewBox="0 0 400 700" preserveAspectRatio="none">
                <path d="M200 0 L200 700" stroke="#d4c5a9" strokeWidth="8" fill="none" />
                <path d="M0 350 L400 350" stroke="#d4c5a9" strokeWidth="8" fill="none" />
                <path d="M0 200 L400 300" stroke="#e0d0b0" strokeWidth="5" fill="none" />
                <path d="M100 0 L300 700" stroke="#e0d0b0" strokeWidth="4" fill="none" />
                <path d="M0 150 L200 400 L400 500" stroke="#e0d0b0" strokeWidth="3" fill="none" />
                <path d="M0 500 L150 350 L400 200" stroke="#e0d0b0" strokeWidth="3" fill="none" />
              </svg>
            </div>

            {/* District labels */}
            {[
              { label: "العليا", top: "40%", left: "52%" },
              { label: "الملقا", top: "18%", left: "42%" },
              { label: "النخيل", top: "32%", left: "30%" },
              { label: "الغدير", top: "14%", left: "60%" },
            ].map(d => (
              <div
                key={d.label}
                className="absolute text-xs text-gray-500 font-medium opacity-60 pointer-events-none"
                style={{ top: d.top, left: d.left, transform: "translate(-50%,-50%)" }}
              >
                {d.label}
              </div>
            ))}

            {/* Place Pins — with many results, draw small dots instead of
                labeled pins so the map stays readable; the selected place
                still gets a full labeled pin. */}
            {filtered.map(place => {
              const pos = projectToMap(place.latitude, place.longitude);
              const isSelected = mapSelected === place.id;
              const dotMode = filtered.length > 40 && !isSelected;
              return (
                <motion.button
                  key={place.id}
                  style={{
                    position: "absolute",
                    top: `${pos.top}%`,
                    left: `${pos.left}%`,
                    transform: dotMode ? "translate(-50%, -50%)" : "translate(-50%, -100%)",
                  }}
                  onClick={() => setMapSelected(isSelected ? null : place.id)}
                  whileHover={{ scale: dotMode ? 1.6 : 1.1 }}
                  whileTap={{ scale: 0.95 }}
                  animate={isSelected ? { scale: 1.15 } : { scale: 1 }}
                >
                  {dotMode ? (
                    <div
                      className={`w-3 h-3 rounded-full border-2 border-white shadow-md ${
                        place.isOpen ? "bg-accent" : "bg-gray-400"
                      }`}
                    />
                  ) : (
                    <div className={`relative flex flex-col items-center ${isSelected ? "z-10" : ""}`}>
                      <div className={`px-2.5 py-1.5 rounded-2xl shadow-lg border-2 flex items-center gap-1.5 ${
                        isSelected
                          ? "bg-primary text-white border-primary"
                          : place.isOpen
                          ? "bg-white text-foreground border-white"
                          : "bg-gray-100 text-gray-500 border-gray-200"
                      }`}>
                        <img src={sizedImage(place.image, IMG.thumb)} alt="" className="w-5 h-5 rounded-full object-cover" loading="lazy" decoding="async" />
                        <span className="text-xs font-bold whitespace-nowrap">{place.name}</span>
                      </div>
                      <div className={`w-2 h-2 rotate-45 mt-[-4px] ${isSelected ? "bg-primary" : "bg-white"}`} />
                    </div>
                  )}
                </motion.button>
              );
            })}
          </div>
          )}

          {/* Selected Place Card */}
          <AnimatePresence>
            {selectedPlace && (
              <motion.div
                initial={{ y: 100, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                exit={{ y: 100, opacity: 0 }}
                transition={{ type: "spring", damping: 25, stiffness: 300 }}
                className="absolute bottom-4 left-4 right-4 bg-card rounded-3xl shadow-2xl border border-border overflow-hidden"
                dir="rtl"
              >
                <div
                  className="flex gap-3 p-4 cursor-pointer"
                  {...tappable(() => onPlaceClick(selectedPlace.id), selectedPlace.name)}
                >
                  <img src={sizedImage(selectedPlace.image, IMG.thumb)} alt={selectedPlace.name} className="w-20 h-20 rounded-2xl object-cover flex-shrink-0" loading="lazy" decoding="async" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-foreground">{selectedPlace.name}</h3>
                        <p className="text-xs text-muted-foreground mt-0.5">{selectedPlace.type} · {selectedPlace.district}</p>
                      </div>
                      <span className={`text-xs px-2 py-0.5 rounded-full flex-shrink-0 ${selectedPlace.isOpen ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
                        {selectedPlace.isOpen ? "مفتوح" : "مغلق"}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="flex items-center gap-1 text-xs">
                        <span className="text-rating">★</span>
                        <span className="font-semibold">{displayRating(selectedPlace).rating}</span>
                        <span className="text-muted-foreground">({displayRating(selectedPlace).count})</span>
                      </span>
                      {/* Category is admin-curated and usually empty — never render a dangling separator */}
                      {selectedPlace.category && (
                        <>
                          <span className="text-muted-foreground text-xs">·</span>
                          <span className="text-muted-foreground text-xs">{selectedPlace.category}</span>
                        </>
                      )}
                    </div>
                    <button
                      className="mt-2 bg-primary text-primary-foreground text-xs font-semibold px-3 py-1.5 rounded-xl"
                      onClick={e => { e.stopPropagation(); onPlaceClick(selectedPlace.id); }}
                    >
                      عرض التفاصيل
                    </button>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Result count badge */}
          <div className="absolute top-4 right-4 bg-card/90 backdrop-blur-sm border border-border rounded-full px-3 py-1.5 shadow-sm">
            <span className="text-xs font-semibold text-foreground">{filtered.length} مكان</span>
          </div>
        </div>
      )}
      </>
      )}
    </div>
  );
}
