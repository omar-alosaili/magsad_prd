import { useEffect, useRef, useState } from "react";
import { tappable } from "../lib/a11y";
import { Pencil, List, Bookmark, MapPin, ChevronLeft, LogOut, User, X, Camera } from "lucide-react";
import type { List as ListType, Place } from "./data";
import type { Profile } from "../lib/types";
import { getMyLists } from "../lib/lists";
import { getVisitedPlaces } from "../lib/visitedPlaces";
import { getSuggestedUsers, getFollowingIds, toggleFollowUser, updateProfile, getFollowCounts, isUsernameAvailable, USERNAME_RE, uploadAvatar, deleteAvatarFiles, MAX_AVATAR_BYTES } from "../lib/profile";
import { getPlaces } from "../lib/places";
import { toast } from "../lib/toast";
import { Button } from "./Button";
import { sizedImage, IMG, PLACE_IMAGE_FALLBACK } from "../lib/types";
import { useSheetA11y } from "./Sheet";

type Props = {
  userId: string | null;
  currentUser: Profile | null;
  onPlaceClick: (id: string) => void;
  onListClick: (id: string) => void;
  onUserClick?: (p: Profile) => void;
  savedPlaces: Set<string>;
  onLoginClick?: () => void;
  onProfileUpdated?: () => void;
  onLogout?: () => void;
};

export function ProfilePage({ userId, currentUser, onPlaceClick, onListClick, onUserClick, savedPlaces, onLoginClick, onProfileUpdated, onLogout }: Props) {
  const [tab, setTab] = useState<"lists" | "saved" | "visited">("lists");
  const [userLists, setUserLists] = useState<ListType[]>([]);
  const [visitedPlacesList, setVisitedPlacesList] = useState<Place[]>([]);
  const [wantToVisitList, setWantToVisitList] = useState<Place[]>([]);
  const [savedPlacesArray, setSavedPlacesArray] = useState<Place[]>([]);
  const [suggestedUsers, setSuggestedUsers] = useState<Profile[]>([]);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [followCounts, setFollowCounts] = useState({ followers: 0, following: 0 });
  const [showEditModal, setShowEditModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editBio, setEditBio] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editLocation, setEditLocation] = useState("");
  const [editInstagram, setEditInstagram] = useState("");
  const [editX, setEditX] = useState("");
  const [editTiktok, setEditTiktok] = useState("");
  const [editSnapchat, setEditSnapchat] = useState("");
  const [editWebsite, setEditWebsite] = useState("");
  const [usernameStatus, setUsernameStatus] = useState<"idle" | "checking" | "ok" | "taken" | "invalid">("idle");
  const [savingProfile, setSavingProfile] = useState(false);
  const [editPersonalization, setEditPersonalization] = useState(true);
  const [editAvatarUrl, setEditAvatarUrl] = useState<string | null>(null);
  const [avatarUploading, setAvatarUploading] = useState(false);

  useEffect(() => {
    if (!userId) return;
    getMyLists(userId).then(setUserLists).catch(console.error);
    getVisitedPlaces(userId, "visited").then(setVisitedPlacesList).catch(console.error);
    getVisitedPlaces(userId, "want_to_visit").then(setWantToVisitList).catch(console.error);
    getSuggestedUsers(userId).then(setSuggestedUsers).catch(console.error);
    getFollowingIds(userId).then(setFollowingIds).catch(console.error);
    getFollowCounts(userId).then(setFollowCounts).catch(console.error);
  }, [userId]);

  useEffect(() => {
    if (!currentUser) return;
    setEditName(currentUser.name);
    setEditBio(currentUser.bio);
    setEditUsername(currentUser.username ?? "");
    setEditLocation(currentUser.location ?? "");
    setEditInstagram(currentUser.instagram ?? "");
    setEditX(currentUser.x_handle ?? "");
    setEditTiktok(currentUser.tiktok ?? "");
    setEditSnapchat(currentUser.snapchat ?? "");
    setEditWebsite(currentUser.website ?? "");
    setEditPersonalization(currentUser.personalization_opt_in !== false);
    setEditAvatarUrl(currentUser.avatar_url ?? null);
  }, [currentUser]);

  const pickAvatar = (file: File | null | undefined) => {
    if (!file || !userId || avatarUploading) return;
    if (file.size > MAX_AVATAR_BYTES) { toast.error("الصورة أكبر من 5MB — اختر صورة أصغر"); return; }
    setAvatarUploading(true);
    uploadAvatar(userId, file)
      .then(setEditAvatarUrl)
      .catch(() => toast.error("تعذّر رفع الصورة — حاول مجدداً"))
      .finally(() => setAvatarUploading(false));
  };

  // Live username availability check (debounced)
  useEffect(() => {
    if (!userId || !showEditModal) return;
    const uname = editUsername.trim().toLowerCase();
    if (uname && uname === (currentUser?.username ?? "")) { setUsernameStatus("idle"); return; }
    // Usernames are mandatory — clearing the field blocks saving too.
    if (!USERNAME_RE.test(uname)) { setUsernameStatus("invalid"); return; }
    setUsernameStatus("checking");
    // `stale` also cancels the response — a slow reply for the previous
    // input must not overwrite the verdict for what's typed now.
    let stale = false;
    const t = setTimeout(() => {
      isUsernameAvailable(uname, userId)
        .then(free => { if (!stale) setUsernameStatus(free ? "ok" : "taken"); })
        .catch(() => { if (!stale) setUsernameStatus("idle"); });
    }, 350);
    return () => { stale = true; clearTimeout(t); };
  }, [editUsername, showEditModal, userId]);

  useEffect(() => {
    if (savedPlaces.size === 0) { setSavedPlacesArray([]); return; }
    getPlaces().then(all => setSavedPlacesArray(all.filter(p => savedPlaces.has(p.id)))).catch(console.error);
  }, [savedPlaces]);

  // Per-target in-flight guard: a double-tap would race INSERT/DELETE and
  // desync the button from the DB (same guard as App.tsx handleSave).
  const followsInFlight = useRef<Set<string>>(new Set());
  const toggleFollow = (targetId: string) => {
    if (!userId) return;
    if (followsInFlight.current.has(targetId)) return;
    followsInFlight.current.add(targetId);
    const currentlyFollowing = followingIds.has(targetId);
    setFollowingIds(prev => {
      const next = new Set(prev);
      if (currentlyFollowing) next.delete(targetId); else next.add(targetId);
      return next;
    });
    // Optimistically bump the following counter, then re-sync from the server
    setFollowCounts(prev => ({ ...prev, following: Math.max(0, prev.following + (currentlyFollowing ? -1 : 1)) }));
    toggleFollowUser(userId, targetId, currentlyFollowing)
      .then(() => getFollowCounts(userId).then(setFollowCounts))
      .catch(() => {
        // revert the optimistic follow state
        setFollowingIds(prev => {
          const next = new Set(prev);
          if (currentlyFollowing) next.add(targetId); else next.delete(targetId);
          return next;
        });
        setFollowCounts(prev => ({ ...prev, following: Math.max(0, prev.following + (currentlyFollowing ? 1 : -1)) }));
        toast.error(currentlyFollowing ? "تعذّر إلغاء المتابعة — حاول مجدداً" : "تعذّرت المتابعة — حاول مجدداً");
      })
      .finally(() => { followsInFlight.current.delete(targetId); });
  };

  const usernameBlocked = usernameStatus === "taken" || usernameStatus === "invalid" || usernameStatus === "checking";

  const saveProfileEdit = () => {
    if (!userId || usernameBlocked || savingProfile) return;
    const uname = editUsername.trim().toLowerCase();
    setSavingProfile(true);
    updateProfile(userId, {
      name: editName,
      bio: editBio,
      avatar_url: editAvatarUrl,
      username: uname || null,
      location: editLocation.trim() || null,
      instagram: editInstagram.trim() || null,
      x_handle: editX.trim() || null,
      tiktok: editTiktok.trim() || null,
      snapchat: editSnapchat.trim() || null,
      website: editWebsite.trim() || null,
      personalization_opt_in: editPersonalization,
    })
      .then(() => {
        // Picture removed: drop the stored file too, or it lingers in the
        // bucket forever with nothing pointing at it.
        if (!editAvatarUrl) deleteAvatarFiles(userId).catch(() => {});
        setShowEditModal(false); onProfileUpdated?.(); toast.success("تم حفظ ملفك الشخصي");
      })
      .catch(() => toast.error("تعذّر حفظ الملف — حاول مجدداً"))
      .finally(() => setSavingProfile(false));
  };

  const shareProfile = () => {
    // Public profile via username deep-link (falls back to the app root)
    const url = currentUser?.username
      ? `${window.location.origin}/?u=${currentUser.username}`
      : window.location.origin;
    const text = `تابعني على مقصد — ${currentUser?.name ?? ""}`;
    if (navigator.share) navigator.share({ title: "مقصد", text, url }).catch(() => {});
    else navigator.clipboard.writeText(url)
      .then(() => toast.success("تم نسخ رابط الملف"))
      .catch(() => toast.error("تعذّر نسخ الرابط"));
  };

  if (!currentUser) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 text-center" dir="rtl">
        <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
          <User size={28} className="text-muted-foreground" />
        </div>
        <div>
          <p className="text-base font-bold text-foreground mb-1">أنت تتصفح كزائر</p>
          <p className="text-sm text-muted-foreground">سجل الدخول لحفظ أماكنك وإنشاء قوائمك الخاصة</p>
        </div>
        {onLoginClick && (
          <button
            onClick={onLoginClick}
            className="px-8 py-3 rounded-2xl font-bold text-sm active:scale-[0.98] transition-transform"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            تسجيل الدخول
          </button>
        )}
      </div>
    );
  }

  const editSheet = useSheetA11y(showEditModal, () => setShowEditModal(false), "تعديل الملف");

  return (
    <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
      {/* Header */}
      <div className="bg-card border-b border-border px-5 pt-14 pb-0">
        <div className="flex items-start justify-between mb-5">
          <div className="flex items-center gap-4">
            <div className="relative">
              {currentUser.avatar_url ? (
                <img
                  src={sizedImage(currentUser.avatar_url, IMG.thumb)}
                  alt={currentUser.name}
                  className="w-20 h-20 rounded-full object-cover border-3 border-accent"
                  style={{ borderWidth: 3 }}
          loading="lazy"
          decoding="async"
          onError={e => { e.currentTarget.style.display = "none"; }}
        />
              ) : (
                <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center border-3 border-accent text-2xl font-bold text-muted-foreground" style={{ borderWidth: 3 }}>
                  {currentUser.name?.[0] ?? "؟"}
                </div>
              )}
            </div>
            <div>
              <h1 className="text-lg font-bold text-foreground">{currentUser.name || "بلا اسم"}</h1>
              {currentUser.username && <p className="text-sm text-accent">@{currentUser.username}</p>}
              {currentUser.location && (
                <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-1"><MapPin size={10} /> {currentUser.location}</p>
              )}
              {currentUser.bio && <p className="text-xs text-muted-foreground mt-1">{currentUser.bio}</p>}
            </div>
          </div>
          <button onClick={() => setShowEditModal(true)} className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
            <Pencil size={15} className="text-foreground" />
          </button>
        </div>

        {/* Stats */}
        <div className="flex divide-x divide-border rtl:divide-x-reverse mb-5">
          {[
            { label: "متابع", value: followCounts.followers.toLocaleString("en-US") },
            { label: "متابَع", value: followCounts.following.toLocaleString("en-US") },
            { label: "قوائم", value: userLists.length },
            { label: "محفوظ", value: savedPlaces.size },
          ].map(stat => (
            <div key={stat.label} className="flex-1 text-center py-2">
              <p className="text-base font-bold text-foreground">{stat.value}</p>
              <p className="text-xs text-muted-foreground">{stat.label}</p>
            </div>
          ))}
        </div>

        {/* Follow Buttons */}
        <div className="flex gap-3 mb-5">
          <button
            onClick={() => setShowEditModal(true)}
            className="flex-1 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            تعديل الملف
          </button>
          <button
            onClick={shareProfile}
            className="flex-1 py-2.5 rounded-2xl bg-muted text-foreground text-sm font-semibold hover:bg-secondary transition-colors"
          >
            مشاركة الملف
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border">
          {[
            { key: "lists" as const, label: "القوائم", icon: <List size={15} /> },
            { key: "saved" as const, label: "المحفوظة", icon: <Bookmark size={15} /> },
            { key: "visited" as const, label: "الزيارات", icon: <MapPin size={15} /> },
          ].map(t => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 py-3 flex items-center justify-center gap-1.5 text-sm font-medium border-b-2 transition-colors ${
                tab === t.key
                  ? "border-accent text-accent"
                  : "border-transparent text-muted-foreground"
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5 py-5">
        {tab === "lists" && (
          <div className="flex flex-col gap-3">
            {userLists.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-2">📋</p>
                <p className="text-sm text-muted-foreground">لا توجد قوائم بعد</p>
              </div>
            ) : (
              userLists.map(list => (
                <div
                  key={list.id}
                  className="flex gap-3 p-3 bg-card border border-border rounded-2xl cursor-pointer hover:shadow-md transition-shadow"
                  {...tappable(() => onListClick(list.id), list.title)}
                >
                  <img src={sizedImage(list.coverImage, IMG.thumb)} alt={list.title} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{list.title}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{list.placeCount} أماكن · {list.followers} متابع</p>
                    <p className="text-xs text-muted-foreground mt-1 truncate">{list.description}</p>
                  </div>
                  <ChevronLeft size={16} className="text-muted-foreground rotate-180 flex-shrink-0 self-center" />
                </div>
              ))
            )}
          </div>
        )}

        {tab === "saved" && (
          <div>
            {savedPlacesArray.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-2">🔖</p>
                <p className="text-sm text-muted-foreground">لم تحفظ أي مكان بعد</p>
                <p className="text-xs text-muted-foreground mt-1">ابحث عن أماكن واحفظها</p>
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-3">
                {savedPlacesArray.map(place => (
                  <div
                    key={place.id}
                    className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                    {...tappable(() => onPlaceClick(place.id), place.name)}
                  >
                    <img src={sizedImage(place.image, IMG.card)} alt={place.name} className="w-full h-28 object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
                    <div className="p-2.5">
                      <h3 className="text-xs font-semibold text-foreground truncate">{place.name}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{place.district}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "visited" && (
          <div>
            {visitedPlacesList.length === 0 && wantToVisitList.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-4xl mb-2">📍</p>
                <p className="text-sm text-muted-foreground">لم تسجل زيارات بعد</p>
                <p className="text-xs text-muted-foreground mt-1">افتح صفحة مكان وسجل زيارتك</p>
              </div>
            ) : (
              <div className="flex flex-col gap-5">
                {visitedPlacesList.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-foreground mb-3">زرتها ✓</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {visitedPlacesList.map(place => (
                        <div
                          key={place.id}
                          className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                          {...tappable(() => onPlaceClick(place.id), place.name)}
                        >
                          <img src={sizedImage(place.image, IMG.card)} alt={place.name} className="w-full h-28 object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
                          <div className="p-2.5">
                            <h3 className="text-xs font-semibold text-foreground truncate">{place.name}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{place.district}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {/* Places marked «أرغب بالزيارة» were previously write-only —
                    saved from the place page but shown nowhere. */}
                {wantToVisitList.length > 0 && (
                  <div>
                    <h3 className="text-sm font-bold text-foreground mb-3">أرغب بزيارتها 📍</h3>
                    <div className="grid grid-cols-2 gap-3">
                      {wantToVisitList.map(place => (
                        <div
                          key={place.id}
                          className="bg-card border border-border rounded-2xl overflow-hidden cursor-pointer hover:shadow-md transition-shadow"
                          {...tappable(() => onPlaceClick(place.id), place.name)}
                        >
                          <img src={sizedImage(place.image, IMG.card)} alt={place.name} className="w-full h-28 object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
                          <div className="p-2.5">
                            <h3 className="text-xs font-semibold text-foreground truncate">{place.name}</h3>
                            <p className="text-xs text-muted-foreground mt-0.5">{place.district}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Suggested Users to Follow */}
      {suggestedUsers.length > 0 && (
        <div className="px-5 mb-6">
          <h2 className="text-sm font-bold text-foreground mb-3">اكتشف أشخاصاً تتابعهم</h2>
          <div className="flex flex-col gap-3">
            {suggestedUsers.map(u => (
              <div key={u.id} className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl">
                {u.avatar_url ? (
                  <img src={sizedImage(u.avatar_url, IMG.thumb)} alt={u.name} className="w-11 h-11 rounded-full object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.display = "none"; }} />
                ) : (
                  <div className="w-11 h-11 rounded-full bg-muted flex items-center justify-center flex-shrink-0 text-sm font-bold text-muted-foreground">
                    {u.name?.[0] ?? "؟"}
                  </div>
                )}
                <div className="flex-1 min-w-0 cursor-pointer" {...(onUserClick ? tappable(() => onUserClick(u), u.name) : {})}>
                  <h3 className="text-sm font-semibold text-foreground">{u.name || "بلا اسم"}</h3>
                  {u.username && <p className="text-xs text-accent">@{u.username}</p>}
                  {u.bio && <p className="text-xs text-muted-foreground truncate mt-0.5">{u.bio}</p>}
                </div>
                <button
                  onClick={() => toggleFollow(u.id)}
                  className="flex-shrink-0 px-3 py-1.5 rounded-full bg-primary text-primary-foreground text-xs font-semibold hover:opacity-90 transition-opacity"
                >
                  {followingIds.has(u.id) ? "متابَع ✓" : "تابع"}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Logout */}
      {onLogout && (
        <div className="px-5 pb-8">
          <button
            onClick={onLogout}
            className="w-full py-3.5 rounded-2xl border border-destructive/40 text-destructive text-sm font-semibold flex items-center justify-center gap-2 hover:bg-destructive/5 transition-colors"
          >
            <LogOut size={15} /> تسجيل الخروج
          </button>
          {/* Third-party data attribution (Apache 2.0 notice in the repo) */}
          <p className="text-[10px] text-muted-foreground text-center mt-4">
            تتضمن بيانات الأماكن محتوى من Foursquare OS Places (Apache 2.0) وخرائط قوقل
          </p>
        </div>
      )}

      {/* Edit Profile Modal */}
      {showEditModal && (
        <div className="absolute inset-0 z-50 flex items-end" dir="rtl" {...editSheet}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditModal(false)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6 max-h-[88vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">تعديل الملف</h3>
              <button onClick={() => setShowEditModal(false)}>
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              {/* Optional profile picture */}
              <div className="flex items-center gap-4">
                <div className="relative">
                  {editAvatarUrl ? (
                    <img src={editAvatarUrl} alt="صورة الملف" className="w-16 h-16 rounded-full object-cover" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.display = "none"; }} />
                  ) : (
                    <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center text-xl font-bold text-muted-foreground">
                      {editName?.[0] ?? "؟"}
                    </div>
                  )}
                  <label className="absolute -bottom-1 -left-1 w-7 h-7 rounded-full bg-accent text-white flex items-center justify-center cursor-pointer shadow-sm" aria-label="تغيير صورة الملف">
                    {avatarUploading
                      ? <span className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      : <Camera size={14} />}
                    <input
                      type="file"
                      accept="image/*"
                      className="hidden"
                      disabled={avatarUploading}
                      onChange={e => { pickAvatar(e.target.files?.[0]); e.target.value = ""; }}
                    />
                  </label>
                </div>
                <div>
                  <p className="text-xs font-semibold text-foreground">صورة الملف (اختيارية)</p>
                  {editAvatarUrl ? (
                    <button onClick={() => setEditAvatarUrl(null)} className="text-xs text-destructive underline underline-offset-2 mt-0.5">
                      إزالة الصورة
                    </button>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-0.5">حتى 5MB</p>
                  )}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">الاسم</label>
                <input
                  type="text"
                  value={editName}
                  onChange={e => setEditName(e.target.value)}
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">المعرّف (username)</label>
                <div className="flex items-center bg-input-background border border-border rounded-2xl px-4 focus-within:ring-2 focus-within:ring-accent/30">
                  <span className="text-sm text-muted-foreground">@</span>
                  <input
                    type="text"
                    value={editUsername}
                    onChange={e => setEditUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ""))}
                    placeholder="اسم_المستخدم"
                    maxLength={20}
                    style={{ direction: "ltr" }}
                    className="flex-1 bg-transparent py-3 text-sm text-foreground focus:outline-none"
                  />
                  {usernameStatus === "checking" && <span className="text-xs text-muted-foreground">…</span>}
                  {usernameStatus === "ok" && <span className="text-xs text-success">متاح ✓</span>}
                  {usernameStatus === "taken" && <span className="text-xs text-destructive">مستخدم</span>}
                  {usernameStatus === "invalid" && <span className="text-xs text-destructive">٣-٢٠ حرف</span>}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">حروف إنجليزية وأرقام و_ فقط — يُستخدم لرابط ملفك</p>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">نبذة</label>
                <textarea
                  value={editBio}
                  onChange={e => setEditBio(e.target.value)}
                  rows={2}
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">الموقع (اختياري)</label>
                <input
                  type="text"
                  value={editLocation}
                  onChange={e => setEditLocation(e.target.value)}
                  placeholder="مثل: الرياض"
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">روابط التواصل (اختياري)</label>
                <div className="flex flex-col gap-2" style={{ direction: "ltr" }}>
                  {[
                    { v: editInstagram, set: setEditInstagram, ph: "Instagram username" },
                    { v: editX, set: setEditX, ph: "X (Twitter) username" },
                    { v: editTiktok, set: setEditTiktok, ph: "TikTok username" },
                    { v: editSnapchat, set: setEditSnapchat, ph: "Snapchat username" },
                    { v: editWebsite, set: setEditWebsite, ph: "Website URL" },
                  ].map((f, i) => (
                    <input
                      key={i}
                      type="text"
                      value={f.v}
                      onChange={e => f.set(e.target.value)}
                      placeholder={f.ph}
                      className="w-full bg-input-background border border-border rounded-2xl px-4 py-2.5 text-sm text-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                    />
                  ))}
                </div>
              </div>
              {/* Privacy: personalized recommendations */}
              <div className="flex items-center justify-between border-t border-border pt-4">
                <div className="flex-1 pl-3">
                  <p className="text-sm text-foreground">توصيات مخصّصة</p>
                  <p className="text-xs text-muted-foreground mt-0.5">استخدام اهتماماتك وأماكنك المحفوظة لترتيب «مقترح لك»</p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={editPersonalization}
                  onClick={() => setEditPersonalization(v => !v)}
                  className={`relative w-11 h-6 rounded-full flex-shrink-0 transition-colors ${editPersonalization ? "bg-primary" : "bg-switch-background"}`}
                >
                  <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white transition-all ${editPersonalization ? "right-0.5" : "right-[22px]"}`} />
                </button>
              </div>
              <Button
                fullWidth
                onClick={saveProfileEdit}
                disabled={usernameBlocked || savingProfile}
                loading={savingProfile}
              >
                حفظ
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
