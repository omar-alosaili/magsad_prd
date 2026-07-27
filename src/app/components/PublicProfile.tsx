import { useEffect, useRef, useState } from "react";
import { tappable } from "../lib/a11y";
import { ArrowRight, MapPin, Instagram, Globe, Star, List as ListIcon, Bookmark } from "lucide-react";
import type { Profile } from "../lib/types";
import type { List, Place } from "./data";
import { getFollowCounts, isFollowing, toggleFollowUser } from "../lib/profile";
import { getPublicListsByUser, getReviewsByUser, getSavedPlacesByUser, type UserReview } from "../lib/social";
import { toast } from "../lib/toast";
import { sizedImage, IMG, PLACE_IMAGE_FALLBACK, originalImage } from "../lib/types";

type Props = {
  profile: Profile;
  viewerId: string | null;
  isAdmin: boolean;
  onBack: () => void;
  onPlaceClick: (id: string) => void;
  onListClick: (list: List) => void;
};

// X / TikTok / Snapchat have no lucide icons — small inline glyphs.
function SocialLink({ href, label, glyph }: { href: string; label: string; glyph: React.ReactNode }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={label}
      className="w-9 h-9 rounded-full bg-muted flex items-center justify-center text-foreground hover:bg-secondary transition-colors"
    >
      {glyph}
    </a>
  );
}

function socialUrl(kind: string, handle: string): string {
  const h = handle.replace(/^@/, "").trim();
  switch (kind) {
    case "instagram": return `https://instagram.com/${h}`;
    case "x": return `https://x.com/${h}`;
    case "tiktok": return `https://tiktok.com/@${h}`;
    case "snapchat": return `https://snapchat.com/add/${h}`;
    case "website": return /^https?:\/\//.test(handle) ? handle : `https://${handle}`;
    default: return "#";
  }
}

export function PublicProfile({ profile, viewerId, isAdmin, onBack, onPlaceClick, onListClick }: Props) {
  const [tab, setTab] = useState<"lists" | "recommendations" | "saved">("lists");
  const [lists, setLists] = useState<List[]>([]);
  const [reviews, setReviews] = useState<UserReview[]>([]);
  const [saved, setSaved] = useState<Place[]>([]);
  const [counts, setCounts] = useState({ followers: 0, following: 0 });
  const [following, setFollowing] = useState(false);

  const isSelf = viewerId === profile.id;
  const canSeeCounts = isSelf || isAdmin;

  useEffect(() => {
    getPublicListsByUser(profile.id).then(setLists).catch(console.error);
    getReviewsByUser(profile.id).then(setReviews).catch(console.error);
    getSavedPlacesByUser(profile.id).then(setSaved).catch(console.error);
  }, [profile.id]);

  // Separate effect keyed on the VIEWER too: isAdmin resolves async after a
  // ?u= deep link (the viewer's own profile row loads late), and without the
  // extra deps an admin would see the counts stuck at 0/0.
  useEffect(() => {
    if (canSeeCounts) getFollowCounts(profile.id).then(setCounts).catch(console.error);
    if (viewerId && !isSelf) isFollowing(viewerId, profile.id).then(setFollowing).catch(console.error);
  }, [profile.id, viewerId, isAdmin]);

  // Ignore taps while a toggle is writing — a double-tap would race the
  // INSERT against the DELETE and desync the button from the DB (same
  // guard as App.tsx handleSave).
  const followInFlight = useRef(false);
  const handleFollow = () => {
    if (!viewerId) { toast.info("سجّل الدخول لمتابعة المستخدمين"); return; }
    if (isSelf || followInFlight.current) return;
    const next = !following;
    setFollowing(next);
    setCounts(c => ({ ...c, followers: Math.max(0, c.followers + (next ? 1 : -1)) }));
    followInFlight.current = true;
    toggleFollowUser(viewerId, profile.id, following)
      .catch(() => {
        setFollowing(!next);
        setCounts(c => ({ ...c, followers: Math.max(0, c.followers + (next ? -1 : 1)) }));
        toast.error(next ? "تعذّرت المتابعة — حاول مجدداً" : "تعذّر إلغاء المتابعة — حاول مجدداً");
      })
      .finally(() => { followInFlight.current = false; });
  };

  const socials: { kind: string; value: string | null; glyph: React.ReactNode }[] = [
    { kind: "instagram", value: profile.instagram, glyph: <Instagram size={16} /> },
    { kind: "x", value: profile.x_handle, glyph: <span className="text-sm font-bold">𝕏</span> },
    { kind: "tiktok", value: profile.tiktok, glyph: <span className="text-xs font-bold">TT</span> },
    { kind: "snapchat", value: profile.snapchat, glyph: <span className="text-xs font-bold">👻</span> },
    { kind: "website", value: profile.website, glyph: <Globe size={16} /> },
  ];
  const activeSocials = socials.filter(s => s.value?.trim());

  return (
    <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
      {/* Header */}
      <div className="bg-card border-b border-border px-5 pt-14 pb-5">
        <button onClick={onBack} aria-label="رجوع" className="w-9 h-9 rounded-full bg-muted flex items-center justify-center mb-4">
          <ArrowRight size={18} className="text-foreground" />
        </button>
        <div className="flex items-center gap-4">
          {profile.avatar_url ? (
            <img src={sizedImage(profile.avatar_url, IMG.thumb)} alt={profile.name} className="w-20 h-20 rounded-full object-cover border-2 border-accent" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.display = "none"; }} />
          ) : (
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center border-2 border-accent text-2xl font-bold text-muted-foreground">
              {profile.name?.[0] ?? "؟"}
            </div>
          )}
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-foreground">{profile.name || "بلا اسم"}</h1>
            {profile.username && <p className="text-sm text-accent">@{profile.username}</p>}
            {profile.location && (
              <p className="text-xs text-muted-foreground mt-1 flex items-center gap-1">
                <MapPin size={11} /> {profile.location}
              </p>
            )}
          </div>
        </div>

        {profile.bio && <p className="text-sm text-foreground mt-3">{profile.bio}</p>}

        {activeSocials.length > 0 && (
          <div className="flex gap-2 mt-3">
            {activeSocials.map(s => (
              <SocialLink key={s.kind} href={socialUrl(s.kind, s.value!)} label={s.kind} glyph={s.glyph} />
            ))}
          </div>
        )}

        {/* Counts — private: only self or admin */}
        {canSeeCounts && (
          <div className="flex gap-6 mt-4">
            <div><span className="font-bold text-foreground">{counts.followers.toLocaleString("en-US")}</span> <span className="text-xs text-muted-foreground">متابِع</span></div>
            <div><span className="font-bold text-foreground">{counts.following.toLocaleString("en-US")}</span> <span className="text-xs text-muted-foreground">يتابِع</span></div>
          </div>
        )}

        {/* Follow button (not on own profile) — guests get the login nudge */}
        {!isSelf && (
          <button
            onClick={handleFollow}
            aria-pressed={following}
            className={`w-full mt-4 py-2.5 rounded-2xl text-sm font-semibold transition-colors ${
              following ? "bg-muted text-foreground border border-border" : "bg-primary text-primary-foreground"
            }`}
          >
            {following ? "متابَع ✓" : "متابعة"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border bg-card">
        {[
          { key: "lists" as const, label: "القوائم", icon: <ListIcon size={15} /> },
          { key: "recommendations" as const, label: "التوصيات", icon: <Star size={15} /> },
          { key: "saved" as const, label: "المحفوظة", icon: <Bookmark size={15} /> },
        ].map(t => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? "border-accent text-accent" : "border-transparent text-muted-foreground"
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      <div className="px-5 py-5">
        {tab === "lists" && (
          lists.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm">لا قوائم عامة بعد</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {lists.map(list => (
                <div
                  key={list.id}
                  {...tappable(() => onListClick(list), list.title)}
                  className="flex gap-3 p-3 bg-card border border-border rounded-2xl cursor-pointer hover:shadow-md transition-shadow"
                >
                  <img src={sizedImage(list.coverImage, IMG.thumb)} alt={list.title} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{list.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{list.placeCount} أماكن · {list.followers} متابع</p>
                    {list.description && <p className="text-xs text-muted-foreground mt-1 truncate">{list.description}</p>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "recommendations" && (
          reviews.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-3xl mb-2">⭐</p>
              <p className="text-sm">لا توصيات بعد</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {reviews.filter(r => r.place).map(r => (
                <div
                  key={r.id}
                  {...tappable(() => { if (r.place) onPlaceClick(r.place.id); }, r.place?.name)}
                  className="flex gap-3 p-3 bg-card border border-border rounded-2xl cursor-pointer hover:shadow-md transition-shadow"
                >
                  <img src={sizedImage(r.place!.image, IMG.thumb)} alt={r.place!.name} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <h3 className="text-sm font-semibold text-foreground">{r.place!.name}</h3>
                      <span className="text-xs text-rating">★ {r.rating}</span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{r.place!.type} · {r.place!.district}</p>
                    {r.comment && <p className="text-xs text-foreground mt-1 line-clamp-2">{r.comment}</p>}
                  </div>
                </div>
              ))}
            </div>
          )
        )}

        {tab === "saved" && (
          saved.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-3xl mb-2">🔖</p>
              <p className="text-sm">لا أماكن محفوظة بعد</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {saved.map(place => (
                <div
                  key={place.id}
                  {...tappable(() => onPlaceClick(place.id), place.name)}
                  className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                >
                  <img src={sizedImage(place.image, IMG.card)} alt={place.name} className="w-full h-28 object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                  <div className="p-2.5">
                    <h3 className="text-xs font-semibold text-foreground truncate">{place.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{place.district}</p>
                  </div>
                </div>
              ))}
            </div>
          )
        )}
      </div>
    </div>
  );
}
