import { useEffect, useRef, useState } from "react";
import { tappable } from "../lib/a11y";
import { Plus, Heart, Bookmark, Lock, Globe, Share2, ArrowRight, Trash2, X, Check } from "lucide-react";
import { displayRating, type List, type Place } from "./data";
import {
  getPublicLists, getMyLists, getListById, createListInDb, deleteList, toggleListLike,
  toggleListFollow, getLikedListIds, getFollowedListIds, getPurchasedListIds, beginListPurchase,
} from "../lib/lists";
import { getPlaces } from "../lib/places";
import { FEATURES } from "../lib/features";
import { toast } from "../lib/toast";
import { Button } from "./Button";
import { sizedImage, IMG, PLACE_IMAGE_FALLBACK } from "../lib/types";
import { useSheetA11y } from "./Sheet";

type Props = {
  userId: string | null;
  isCreator: boolean;
  onPlaceClick: (id: string) => void;
  savedPlaces: Set<string>;
  onSave: (id: string) => void;
  initialListId?: string | null;
  onInitialListConsumed?: () => void;
};

export function ListsPage({ userId, isCreator, onPlaceClick, savedPlaces, onSave, initialListId, onInitialListConsumed }: Props) {
  const [popularLists, setPopularLists] = useState<List[]>([]);
  const [myLists, setMyLists] = useState<List[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [selectedList, setSelectedList] = useState<List | null>(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [likedLists, setLikedLists] = useState<Set<string>>(new Set());
  const [followedLists, setFollowedLists] = useState<Set<string>>(new Set());
  const [newListName, setNewListName] = useState("");
  const [newListDesc, setNewListDesc] = useState("");
  const [newListPublic, setNewListPublic] = useState(true);
  const [newListPaid, setNewListPaid] = useState(false);
  const [newListPrice, setNewListPrice] = useState("");
  const [purchasedLists, setPurchasedLists] = useState<Set<string>>(new Set());
  const [placesLoading, setPlacesLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);

  useEffect(() => {
    getPublicLists().then(setPopularLists).catch(console.error);
    getPlaces().then(setPlaces).catch(console.error).finally(() => setPlacesLoading(false));
    if (userId) {
      getMyLists(userId).then(setMyLists).catch(console.error);
      getLikedListIds(userId).then(setLikedLists).catch(console.error);
      getFollowedListIds(userId).then(setFollowedLists).catch(console.error);
      getPurchasedListIds(userId).then(setPurchasedLists).catch(console.error);
    } else {
      setMyLists([]);
      setPurchasedLists(new Set());
    }
  }, [userId]);

  // Open a shared list (?list= deep-link). Fetched directly so it works
  // even when the list isn't in the loaded popular/own sets.
  useEffect(() => {
    if (!initialListId) return;
    getListById(initialListId)
      .then(list => { if (list) setSelectedList(list); })
      .catch(console.error)
      .finally(() => onInitialListConsumed?.());
  }, [initialListId]);

  // A paid list is locked until the viewer owns or has bought it
  const isLocked = (list: List) =>
    FEATURES.paidLists && list.isPaid && list.userId !== userId && !purchasedLists.has(list.id);

  const handlePurchase = (list: List) => {
    if (!userId || !list.price) return;
    setPurchasing(true);
    setPurchaseError(null);
    // Moyasar hosted checkout when configured; Phase 1 mock until then.
    // On return from checkout, App confirms the payment via ?purchase_id=.
    beginListPurchase(list.id, userId, list.price)
      .then(async result => {
        if ("url" in result) {
          window.location.href = result.url;
          return;
        }
        // Mock purchase completed in place — unlock immediately
        setPurchasedLists(prev => new Set(prev).add(list.id));
        const fresh = await getListById(list.id);
        if (fresh) setSelectedList(fresh);
        getPublicLists().then(setPopularLists).catch(console.error);
        setPurchasing(false);
      })
      .catch(e => {
        console.error(e);
        setPurchaseError("تعذر بدء عملية الدفع — حاول مرة أخرى");
        setPurchasing(false);
      });
  };

  const likesInFlight = useRef<Set<string>>(new Set());
  const toggleLike = (id: string) => {
    if (!userId) return;
    if (likesInFlight.current.has(id)) return;
    likesInFlight.current.add(id);
    const currentlyLiked = likedLists.has(id);
    setLikedLists(prev => {
      const next = new Set(prev);
      if (currentlyLiked) next.delete(id); else next.add(id);
      return next;
    });
    toggleListLike(id, userId, currentlyLiked).catch(() => {
      setLikedLists(prev => {
        const next = new Set(prev);
        if (currentlyLiked) next.add(id); else next.delete(id);
        return next;
      });
      toast.error("تعذّر تحديث الإعجاب — حاول مجدداً");
    }).finally(() => { likesInFlight.current.delete(id); });
  };

  const followsInFlight = useRef<Set<string>>(new Set());
  const toggleFollow = (id: string) => {
    if (!userId) return;
    if (followsInFlight.current.has(id)) return;
    followsInFlight.current.add(id);
    const currentlyFollowing = followedLists.has(id);
    setFollowedLists(prev => {
      const next = new Set(prev);
      if (currentlyFollowing) next.delete(id); else next.add(id);
      return next;
    });
    toggleListFollow(id, userId, currentlyFollowing).catch(() => {
      setFollowedLists(prev => {
        const next = new Set(prev);
        if (currentlyFollowing) next.add(id); else next.delete(id);
        return next;
      });
      toast.error("تعذّرت متابعة القائمة — حاول مجدداً");
    }).finally(() => { followsInFlight.current.delete(id); });
  };

  const shareList = (list: List) => {
    const url = `${window.location.origin}/?list=${list.id}`;
    if (navigator.share) {
      navigator.share({ title: list.title, url }).catch(() => {});
    } else {
      navigator.clipboard.writeText(url)
        .then(() => toast.success("تم نسخ رابط القائمة"))
        .catch(() => toast.error("تعذّر نسخ الرابط"));
    }
  };

  const [creatingList, setCreatingList] = useState(false);
  const createList = () => {
    if (!newListName.trim()) return;
    if (!userId || creatingList) return;
    const price = parseFloat(newListPrice);
    // Validate BEFORE claiming the in-flight flag, or an invalid price would
    // leave the button disabled forever.
    if (newListPaid && (!price || price <= 0)) return;
    setCreatingList(true);
    createListInDb({
      userId,
      title: newListName,
      description: newListDesc,
      isPublic: newListPublic,
      coverImage: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=600&h=400&fit=crop&auto=format",
      isPaid: newListPaid,
      price: newListPaid ? price : null,
    }).then(newList => {
      setMyLists(prev => [...prev, newList]);
      // Keep the popular section in sync when the new list is public
      if (newList.isPublic) getPublicLists().then(setPopularLists).catch(console.error);
      setNewListName("");
      setNewListDesc("");
      setNewListPaid(false);
      setNewListPrice("");
      setShowCreateModal(false);
      toast.success("تم إنشاء القائمة");
    }).catch(() => toast.error("تعذّر إنشاء القائمة — حاول مجدداً"))
      .finally(() => setCreatingList(false));
  };

  const handleDeleteList = (list: List) => {
    if (!window.confirm(`حذف قائمة "${list.title}"؟ لا يمكن التراجع.`)) return;
    deleteList(list.id).then(() => {
      setMyLists(prev => prev.filter(l => l.id !== list.id));
      setPopularLists(prev => prev.filter(l => l.id !== list.id));
      setSelectedList(null);
      toast.success("تم حذف القائمة");
    }).catch(() => toast.error("تعذّر حذف القائمة — حاول مجدداً"));
  };

  if (selectedList) {
    const listPlaces = places.filter(p => selectedList.placeIds.includes(p.id));
    const isFollowing = followedLists.has(selectedList.id);
    const locked = isLocked(selectedList);
    return (
      <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
        {/* Header */}
        <div className="relative h-56">
          <img src={sizedImage(selectedList.coverImage, IMG.card)} alt={selectedList.title} className="w-full h-full object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/20 to-transparent" />
          <button
            onClick={() => setSelectedList(null)}
            className="absolute top-14 right-5 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center"
          >
            <ArrowRight size={20} className="text-foreground" />
          </button>
          <div className="absolute bottom-5 right-5 left-5">
            <div className="flex items-center gap-2 mb-1">
              {selectedList.isPublic ? (
                <Globe size={12} className="text-white/70" />
              ) : (
                <Lock size={12} className="text-white/70" />
              )}
              <span className="text-white/70 text-xs">{selectedList.isPublic ? "عامة" : "خاصة"}</span>
            </div>
            <h1 className="text-white text-xl font-bold">{selectedList.title}</h1>
            {selectedList.description && (
              <p className="text-white/70 text-sm mt-1">{selectedList.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2">
              <span className="text-white/80 text-xs">{selectedList.placeCount} أماكن</span>
              <span className="text-white/80 text-xs">{selectedList.followers} متابع</span>
              {FEATURES.paidLists && selectedList.isPaid && (
                <span className="bg-accent text-white text-xs px-2.5 py-0.5 rounded-full font-bold">
                  {purchasedLists.has(selectedList.id) ? "تم الشراء ✓" : `${selectedList.price} ر.س`}
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="px-5 py-4">
          <div className="flex gap-3 mb-5">
            {selectedList.userId === userId ? (
              <button
                onClick={() => handleDeleteList(selectedList)}
                className="flex-1 py-2.5 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 border border-destructive/40 text-destructive hover:bg-destructive/5 transition-colors"
              >
                <Trash2 size={14} /> حذف القائمة
              </button>
            ) : (
              <button
                onClick={() => toggleFollow(selectedList.id)}
                disabled={!userId}
                className={`flex-1 py-2.5 rounded-2xl text-sm font-semibold flex items-center justify-center gap-2 disabled:opacity-50 ${
                  isFollowing ? "bg-muted text-foreground border border-border" : "bg-primary text-primary-foreground"
                }`}
              >
                <Bookmark size={14} /> {isFollowing ? "متابَع ✓" : "متابعة القائمة"}
              </button>
            )}
            <button
              onClick={() => shareList(selectedList)}
              className="w-11 h-11 rounded-2xl bg-card border border-border flex items-center justify-center"
            >
              <Share2 size={16} className="text-foreground" />
            </button>
          </div>

          {locked ? (
            /* Paid list the viewer hasn't bought: sell it */
            <div className="text-center py-10 px-4 bg-card border border-border rounded-3xl">
              <div className="w-14 h-14 mx-auto rounded-full bg-accent/10 flex items-center justify-center mb-3">
                <Lock size={22} className="text-accent" />
              </div>
              <h3 className="text-base font-bold text-foreground mb-1">قائمة مدفوعة</h3>
              <p className="text-sm text-muted-foreground mb-1">
                {selectedList.placeCount} مكان مختار بعناية — اشترِ القائمة لعرضها كاملة
              </p>
              {purchaseError && <p className="text-xs text-destructive mt-2">{purchaseError}</p>}
              <button
                onClick={() => handlePurchase(selectedList)}
                disabled={!userId || purchasing}
                className="mt-4 px-8 py-3.5 rounded-2xl bg-primary text-primary-foreground text-sm font-bold disabled:opacity-50 active:scale-[0.98] transition-transform"
              >
                {purchasing ? "جارٍ الشراء..." : `شراء القائمة — ${selectedList.price} ر.س`}
              </button>
              {!userId && <p className="text-xs text-muted-foreground mt-2">سجل الدخول للشراء</p>}
            </div>
          ) : placesLoading && selectedList.placeCount > 0 ? (
            /* Catalog still downloading — don't flash "empty" for a list that has places */
            <div className="text-center py-12">
              <div className="w-8 h-8 mx-auto mb-3 border-2 border-accent border-t-transparent rounded-full animate-spin" />
              <p className="text-sm text-muted-foreground">جارٍ تحميل الأماكن...</p>
            </div>
          ) : listPlaces.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <p className="text-3xl mb-2">📋</p>
              <p className="text-sm">القائمة فارغة</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {listPlaces.map(place => (
                <div
                  key={place.id}
                  className="flex gap-3 p-3 bg-card rounded-2xl border border-border cursor-pointer hover:shadow-md transition-shadow"
                  {...tappable(() => onPlaceClick(place.id), place.name)}
                >
                  <img src={sizedImage(place.image, IMG.thumb)} alt={place.name} className="w-20 h-20 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-semibold text-foreground">{place.name}</h3>
                    <p className="text-xs text-muted-foreground mt-0.5">{place.type} · {place.district}</p>
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs text-rating">★ {displayRating(place).rating}</span>
                      <span className={`text-xs px-2 py-0.5 rounded-full ${place.isOpen ? "bg-success-soft text-success" : "bg-danger-soft text-danger"}`}>
                        {place.isOpen ? "مفتوح" : "مغلق"}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    );
  }

  const createSheet = useSheetA11y(showCreateModal, () => setShowCreateModal(false), "قائمة جديدة");

  return (
    <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm px-5 pt-14 pb-4">
        <div className="flex items-center justify-between">
          <h1 className="text-xl font-bold text-foreground">القوائم</h1>
          {userId && (
            <button
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-full text-sm font-semibold hover:opacity-90 transition-opacity"
            >
              <Plus size={15} /> قائمة جديدة
            </button>
          )}
        </div>
      </div>

      {/* My Lists */}
      {userId && (
        <div className="px-5 mb-6">
          <h2 className="text-sm font-bold text-muted-foreground mb-3">قوائمي</h2>
          {myLists.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">لا توجد قوائم بعد</p>
          ) : (
            <div className="flex flex-col gap-3">
              {myLists.map(list => (
                <div
                  key={list.id}
                  className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl cursor-pointer hover:shadow-md transition-shadow"
                  {...tappable(() => setSelectedList(list), list.title)}
                >
                  <img src={sizedImage(list.coverImage, IMG.thumb)} alt={list.title} className="w-16 h-16 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      {list.isPublic ? <Globe size={11} className="text-muted-foreground" /> : <Lock size={11} className="text-muted-foreground" />}
                      <h3 className="text-sm font-semibold text-foreground">{list.title}</h3>
                      {FEATURES.paidLists && list.isPaid && (
                        <span className="bg-accent/10 text-accent text-xs px-2 py-0.5 rounded-full font-bold">{list.price} ر.س</span>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5">{list.placeCount} أماكن</p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); toggleLike(list.id); }}
                    className="p-2 rounded-xl hover:bg-muted transition-colors"
                  >
                    <Heart size={15} className={likedLists.has(list.id) ? "fill-red-500 text-red-500" : "text-muted-foreground"} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Popular Lists */}
      <div className="px-5">
        <h2 className="text-sm font-bold text-muted-foreground mb-3">قوائم شائعة</h2>
        {popularLists.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-8">لا توجد قوائم عامة بعد</p>
        ) : (
          <div className="flex flex-col gap-4">
            {popularLists.map(list => (
              <div
                key={list.id}
                className="bg-card border border-border rounded-3xl overflow-hidden cursor-pointer hover:shadow-lg transition-all group"
                {...tappable(() => setSelectedList(list), list.title)}
              >
                <div className="relative h-36">
                  <img
                    src={sizedImage(list.coverImage, IMG.card)}
                    alt={list.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
          decoding="async"
          onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }}
        />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent" />
                  {FEATURES.paidLists && list.isPaid && (
                    <div className="absolute top-3 left-3 flex items-center gap-1 bg-accent text-white text-xs font-bold px-2.5 py-1 rounded-full shadow-sm">
                      {isLocked(list) && <Lock size={11} />}
                      {purchasedLists.has(list.id) ? "تم الشراء ✓" : `${list.price} ر.س`}
                    </div>
                  )}
                  <div className="absolute bottom-3 right-3 left-3">
                    <h3 className="text-white font-semibold">{list.title}</h3>
                    <p className="text-white/70 text-xs mt-0.5">{list.placeCount} أماكن</p>
                  </div>
                </div>
                <div className="p-4">
                  <p className="text-xs text-muted-foreground mb-3">{list.description}</p>
                  <div className="flex items-center justify-between">
                    <div className="flex gap-3">
                      <button
                        onClick={e => { e.stopPropagation(); toggleLike(list.id); }}
                        disabled={!userId}
                        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-red-500 transition-colors disabled:opacity-50"
                      >
                        <Heart size={13} className={likedLists.has(list.id) ? "fill-red-500 text-red-500" : ""} />
                        {list.likes + (likedLists.has(list.id) ? 1 : 0)}
                      </button>
                      <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <Bookmark size={13} />
                        {list.followers}
                      </span>
                    </div>
                    {list.userId === userId ? (
                      <span className="text-xs text-muted-foreground font-semibold">قائمتك</span>
                    ) : (
                      <button
                        onClick={e => { e.stopPropagation(); toggleFollow(list.id); }}
                        disabled={!userId}
                        className="flex items-center gap-1 text-xs text-accent font-semibold disabled:opacity-50"
                      >
                        <Bookmark size={12} /> {followedLists.has(list.id) ? "متابَع ✓" : "متابعة"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Create List Modal */}
      {showCreateModal && (
        <div className="absolute inset-0 z-50 flex items-end" dir="rtl" {...createSheet}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowCreateModal(false)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">قائمة جديدة</h3>
              <button onClick={() => setShowCreateModal(false)}>
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">اسم القائمة</label>
                <input
                  type="text"
                  value={newListName}
                  onChange={e => setNewListName(e.target.value)}
                  placeholder="مثل: كافيهات للعمل ☕"
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">وصف (اختياري)</label>
                <textarea
                  value={newListDesc}
                  onChange={e => setNewListDesc(e.target.value)}
                  placeholder="أضف وصفاً للقائمة..."
                  rows={3}
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                />
              </div>
              {isCreator && FEATURES.paidLists && (
                <div>
                  <label className="text-xs text-muted-foreground mb-2 block">البيع</label>
                  <div className="flex gap-3 items-center">
                    <button
                      onClick={() => setNewListPaid(v => !v)}
                      className={`flex-1 p-3 rounded-2xl border text-right transition-all ${
                        newListPaid ? "border-accent bg-accent/5 text-foreground" : "border-border bg-card text-foreground"
                      }`}
                    >
                      <span className="text-sm font-semibold">قائمة مدفوعة 💰</span>
                      <p className="text-xs text-muted-foreground mt-0.5">يشتريها المستخدمون لعرض أماكنها</p>
                    </button>
                    {newListPaid && (
                      <div className="w-28">
                        <input
                          type="number"
                          min="1"
                          value={newListPrice}
                          onChange={e => setNewListPrice(e.target.value)}
                          placeholder="السعر"
                          className="w-full bg-input-background border border-border rounded-2xl px-3 py-3 text-sm text-foreground text-center focus:outline-none focus:ring-2 focus:ring-accent/30"
                        />
                        <p className="text-[10px] text-muted-foreground text-center mt-1">ر.س</p>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground mb-2 block">الخصوصية</label>
                <div className="flex gap-3">
                  {[
                    { value: true, label: "عامة", icon: <Globe size={14} />, desc: "يراها الجميع" },
                    { value: false, label: "خاصة", icon: <Lock size={14} />, desc: "أنت فقط" },
                  ].map(opt => (
                    <button
                      key={String(opt.value)}
                      onClick={() => setNewListPublic(opt.value)}
                      className={`flex-1 p-3 rounded-2xl border text-right transition-all ${
                        newListPublic === opt.value
                          ? "border-accent bg-accent/5 text-foreground"
                          : "border-border bg-card text-foreground"
                      }`}
                    >
                      <div className="flex items-center gap-2 mb-0.5">
                        <span className={newListPublic === opt.value ? "text-accent" : "text-muted-foreground"}>
                          {opt.icon}
                        </span>
                        <span className="text-sm font-semibold">{opt.label}</span>
                      </div>
                      <p className="text-xs text-muted-foreground">{opt.desc}</p>
                    </button>
                  ))}
                </div>
              </div>
              <Button
                fullWidth
                onClick={createList}
                disabled={creatingList || !newListName.trim() || (newListPaid && !(parseFloat(newListPrice) > 0))}
              >
                <Check size={16} /> إنشاء القائمة
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
