import { useEffect, useRef, useState } from "react";
import { ArrowRight, Bookmark, Star, Plus, Check, X, ChevronLeft, Image as ImageIcon, Sparkles } from "lucide-react";
import type { Place, List } from "./data";
import { getPlaceById, updatePlace, getSavedCountForPlace, getRecentReviewCount } from "../lib/places";
import { getListsContainingPlace } from "../lib/lists";
import { getMyPromotions, requestPromotion, withdrawPromotionRequest, PLACEMENT_LABELS, SELECTABLE_PLACEMENTS, type Promotion, type PromotionPlacement } from "../lib/promotions";
import { getOffersForPlace, createOffer, updateOffer, deactivateOffer, type OfferWithStatus } from "../lib/offers";
import { uploadPlacePhoto } from "../lib/storage";
import { updateProfile } from "../lib/profile";
import { toast } from "../lib/toast";
import { Button } from "./Button";
import { useSheetA11y } from "./Sheet";

type Props = { userId: string; placeId: string; onBack: () => void };

export function BusinessDashboard({ userId, placeId, onBack }: Props) {
  const [place, setPlace] = useState<Place | null>(null);
  const [promotions, setPromotions] = useState<Promotion[]>([]);
  const [showPromoModal, setShowPromoModal] = useState(false);
  const [promoPlacement, setPromoPlacement] = useState<PromotionPlacement>("home_featured");
  const [promoNote, setPromoNote] = useState("");
  const [promoSending, setPromoSending] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"overview" | "offers" | "settings">("overview");
  const [savedCount, setSavedCount] = useState(0);
  const [recentReviews, setRecentReviews] = useState(0);
  const [listsContaining, setListsContaining] = useState<List[]>([]);
  const [offers, setOffers] = useState<OfferWithStatus[]>([]);

  const [showOfferModal, setShowOfferModal] = useState(false);
  const [editingOfferId, setEditingOfferId] = useState<string | null>(null);
  const [offerTitle, setOfferTitle] = useState("");
  const [offerDesc, setOfferDesc] = useState("");
  const [offerDiscount, setOfferDiscount] = useState("");
  const [offerEndDate, setOfferEndDate] = useState("");

  const [showEditPlaceModal, setShowEditPlaceModal] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editAddress, setEditAddress] = useState("");
  const [editOpeningHours, setEditOpeningHours] = useState("");
  const [editOrderLink, setEditOrderLink] = useState("");
  const [editBookingLink, setEditBookingLink] = useState("");

  const [uploading, setUploading] = useState(false);
  const [notifEnabled, setNotifEnabled] = useState(false);
  const sheet1 = useSheetA11y(showOfferModal, () => setShowOfferModal(false), "عرض جديد");
  const sheet2 = useSheetA11y(showEditPlaceModal, () => setShowEditPlaceModal(false), "تعديل بيانات المكان");
  const sheet3 = useSheetA11y(showPromoModal, () => setShowPromoModal(false), "طلب ترويج");
  const [formError, setFormError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = () => {
    getPlaceById(placeId).then(setPlace).catch(console.error);
    getSavedCountForPlace(placeId).then(setSavedCount).catch(console.error);
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    getRecentReviewCount(placeId, sevenDaysAgo).then(setRecentReviews).catch(console.error);
    getListsContainingPlace(placeId).then(setListsContaining).catch(console.error);
    getOffersForPlace(placeId).then(setOffers).catch(console.error);
    getMyPromotions(placeId).then(setPromotions).catch(console.error);
  };

  useEffect(load, [placeId]);

  // A placement already has a live/queued request — don't let the owner
  // stack duplicates (the DB also guards active dupes via a unique index).
  const placementTaken = (pl: PromotionPlacement) =>
    promotions.some(p => p.placement === pl && (p.status === "pending" || p.status === "active"));

  const submitPromotion = () => {
    if (promoSending) return;
    if (placementTaken(promoPlacement)) { setPromoError("لديك طلب قائم لهذا القسم بالفعل"); return; }
    setPromoSending(true);
    setPromoError(null);
    requestPromotion({ placeId, ownerId: userId, placement: promoPlacement, note: promoNote })
      .then(() => { setShowPromoModal(false); setPromoNote(""); getMyPromotions(placeId).then(setPromotions).catch(console.error); toast.success("تم إرسال طلب الترويج — سيراجعه الفريق"); })
      .catch(() => setPromoError("تعذّر إرسال الطلب — حاول مرة أخرى"))
      .finally(() => setPromoSending(false));
  };

  const withdrawPromotion = (id: string) => {
    withdrawPromotionRequest(id)
      .then(() => { getMyPromotions(placeId).then(setPromotions).catch(console.error); toast.success("تم سحب طلب الترويج"); })
      .catch(() => toast.error("تعذّر سحب الطلب — حاول مجدداً"));
  };

  useEffect(() => {
    if (place) {
      setEditName(place.name);
      setEditDescription(place.description);
      setEditAddress(place.address);
      setEditOpeningHours(place.openingHours);
      setEditOrderLink(place.orderLink ?? "");
      setEditBookingLink(place.bookingLink ?? "");
    }
  }, [place]);

  if (!place) return null;

  const openCreateOffer = () => {
    setEditingOfferId(null);
    setOfferTitle(""); setOfferDesc(""); setOfferDiscount(""); setOfferEndDate("");
    setFormError(null);
    setShowOfferModal(true);
  };

  const openEditOffer = (offer: OfferWithStatus) => {
    setFormError(null);
    setEditingOfferId(offer.id);
    setOfferTitle(offer.title);
    setOfferDesc(offer.description);
    setOfferDiscount(offer.discount ?? "");
    setOfferEndDate(offer.endDate);
    setShowOfferModal(true);
  };

  const submitOffer = () => {
    if (!offerTitle.trim() || !offerEndDate) return;
    setFormError(null);
    const action = editingOfferId
      ? updateOffer(editingOfferId, { title: offerTitle, description: offerDesc, discount: offerDiscount || null, end_date: offerEndDate })
      : createOffer({ placeId, createdBy: userId, title: offerTitle, description: offerDesc, discount: offerDiscount || undefined, endDate: offerEndDate });
    action
      .then(() => { setShowOfferModal(false); getOffersForPlace(placeId).then(setOffers).catch(console.error); toast.success(editingOfferId ? "تم حفظ التعديل على العرض" : "تم نشر العرض"); })
      .catch(e => { console.error(e); setFormError("تعذر حفظ العرض — حاول مرة أخرى"); });
  };

  const stopOffer = (id: string) => {
    deactivateOffer(id)
      .then(() => { getOffersForPlace(placeId).then(setOffers).catch(console.error); toast.success("تم إيقاف العرض"); })
      .catch(() => toast.error("تعذّر إيقاف العرض — حاول مجدداً"));
  };

  const saveEditPlace = () => {
    setFormError(null);
    updatePlace(place.id, {
      name: editName,
      description: editDescription,
      address: editAddress,
      opening_hours: editOpeningHours,
      order_link: editOrderLink || null,
      booking_link: editBookingLink || null,
    })
      .then(() => { setShowEditPlaceModal(false); load(); toast.success("تم حفظ التغييرات"); })
      .catch(e => { console.error(e); setFormError("تعذر حفظ التغييرات — حاول مرة أخرى"); });
  };

  const handlePhotoUpload = async (file: File) => {
    setUploading(true);
    try {
      const url = await uploadPlacePhoto(userId, place.id, file);
      await updatePlace(place.id, { images: [...place.images, url], image: place.image || url });
      load();
      toast.success("تمت إضافة الصورة");
    } catch (e) {
      console.error(e);
      toast.error("تعذّر رفع الصورة — حاول مجدداً");
    } finally {
      setUploading(false);
    }
  };

  const enableNotifications = async () => {
    if (!("Notification" in window)) return;
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotifEnabled(true);
      updateProfile(userId, { notification_opt_in: true }).catch(() => {
        setNotifEnabled(false);
        toast.error("تعذّر تفعيل الإشعارات — حاول مجدداً");
      });
    }
  };

  const activeOffers = offers.filter(o => o.isActive);

  const stats = [
    { label: "حفظوا المكان", value: savedCount.toLocaleString("en-US") },
    { label: "تقييمات جديدة (٧ أيام)", value: recentReviews.toLocaleString("en-US") },
    { label: "في قوائم المستخدمين", value: listsContaining.length.toLocaleString("en-US") },
    { label: "التقييم العام", value: place.rating.toLocaleString("en-US") },
  ];


  return (
    <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm px-5 pt-14 pb-4">
        <div className="flex items-center gap-3 mb-4">
          <button onClick={onBack} aria-label="رجوع" className="w-9 h-9 rounded-full bg-card border border-border flex items-center justify-center">
            <ArrowRight size={18} className="text-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-foreground">لوحة تحكم المكان</h1>
            <p className="text-xs text-muted-foreground">{place.name} {place.isVerified && "· موثق ✓"}</p>
          </div>
        </div>

        <div className="flex gap-1 bg-muted p-1 rounded-2xl">
          {(["overview", "offers", "settings"] as const).map(t => (
            <button
              key={t}
              onClick={() => setActiveTab(t)}
              className={`flex-1 py-2 rounded-xl text-xs font-medium transition-all ${
                activeTab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t === "overview" ? "الإحصائيات" : t === "offers" ? "العروض" : "الإعدادات"}
            </button>
          ))}
        </div>
      </div>

      <div className="px-5">
        {activeTab === "overview" && (
          <>
            {/* Place Card */}
            <div className="bg-card border border-border rounded-2xl overflow-hidden mb-5">
              <img src={place.image} alt={place.name} className="w-full h-36 object-cover" />
              <div className="p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold">{place.name}</h2>
                    <p className="text-xs text-muted-foreground">{place.district} · {place.type}</p>
                  </div>
                  <div className="flex items-center gap-1">
                    <Star size={14} className="fill-rating text-rating" />
                    <span className="text-sm font-semibold">{place.rating}</span>
                    <span className="text-xs text-muted-foreground">({place.reviewCount})</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Stats Grid */}
            <div className="grid grid-cols-2 gap-3 mb-6">
              {stats.map(stat => (
                <div key={stat.label} className="bg-card border border-border rounded-2xl p-4">
                  <p className="text-xs text-muted-foreground mb-1 leading-tight">{stat.label}</p>
                  <p className="text-2xl font-bold text-foreground">{stat.value}</p>
                </div>
              ))}
            </div>

            {/* List Insights */}
            <div className="bg-card border border-border rounded-2xl p-4 mb-5">
              <h3 className="text-sm font-bold mb-3 flex items-center gap-2">
                <Bookmark size={14} className="text-accent" />
                القوائم التي أُضيف فيها مكانك
              </h3>
              {listsContaining.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-3">لم يُضف بعد لأي قائمة عامة</p>
              ) : (
                <div className="flex flex-col gap-2">
                  {listsContaining.map(list => (
                    <div key={list.id} className="flex items-center justify-between">
                      <span className="text-sm text-foreground">{list.title}</span>
                      <span className="text-sm font-semibold text-accent">{list.followers.toLocaleString("en-US")} متابع</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Promotion */}
            <div className="bg-card border border-border rounded-2xl p-4 mb-5">
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-sm font-bold flex items-center gap-2">
                  <Sparkles size={14} className="text-accent" />
                  الترويج في الواجهة الرئيسية
                </h3>
                <button onClick={() => { setPromoError(null); setShowPromoModal(true); }} className="text-xs font-semibold text-accent">
                  طلب ترويج +
                </button>
              </div>
              {promotions.length === 0 ? (
                <p className="text-xs text-muted-foreground text-center py-3">
                  اطلب إبراز مكانك في «وين مقصدك اليوم؟» أعلى الصفحة الرئيسية. يراجع الفريق الطلب قبل النشر.
                </p>
              ) : (
                <div className="flex flex-col gap-2">
                  {promotions.map(p => {
                    const label =
                      p.status === "active" ? { t: "نشط", c: "text-success" } :
                      p.status === "pending" ? { t: "قيد المراجعة", c: "text-warning" } :
                      p.status === "rejected" ? { t: "مرفوض", c: "text-destructive" } :
                      { t: "متوقف", c: "text-muted-foreground" };
                    return (
                      <div key={p.id} className="flex items-center justify-between border-b border-border last:border-0 pb-2 last:pb-0">
                        <div>
                          <p className="text-sm text-foreground">{PLACEMENT_LABELS[p.placement]}</p>
                          <p className={`text-xs font-semibold ${label.c}`}>{label.t}</p>
                        </div>
                        {p.status === "pending" && (
                          <button onClick={() => withdrawPromotion(p.id)} className="text-xs text-muted-foreground">
                            سحب الطلب
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}

        {activeTab === "offers" && (
          <>
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-sm font-bold text-muted-foreground">العروض الحالية</h2>
              <button
                onClick={openCreateOffer}
                className="flex items-center gap-1.5 bg-accent text-white px-3 py-2 rounded-full text-xs font-semibold"
              >
                <Plus size={13} /> عرض جديد
              </button>
            </div>

            {offers.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <p className="text-3xl mb-2">🎁</p>
                <p className="text-sm">أضف عروضاً لجذب المزيد من العملاء</p>
              </div>
            ) : (
              offers.map(offer => (
                <div key={offer.id} className="bg-card border border-border rounded-2xl p-4 mb-4">
                  <div className="flex items-start justify-between mb-2">
                    <div>
                      <h3 className="text-sm font-semibold">{offer.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">ينتهي {offer.endDate}</p>
                    </div>
                    <span className={`text-xs px-2 py-0.5 rounded-full ${offer.isActive ? "bg-success-soft text-success" : "bg-muted text-muted-foreground"}`}>
                      {offer.isActive ? "نشط" : "متوقف"}
                    </span>
                  </div>
                  {offer.isActive && (
                    <div className="flex gap-2 mt-3">
                      <button onClick={() => openEditOffer(offer)} className="flex-1 py-2 rounded-xl bg-muted text-foreground text-xs font-medium">تعديل</button>
                      <button onClick={() => stopOffer(offer.id)} className="flex-1 py-2 rounded-xl bg-danger-soft text-danger text-xs font-medium">إيقاف</button>
                    </div>
                  )}
                </div>
              ))
            )}
          </>
        )}

        {activeTab === "settings" && (
          <div className="flex flex-col gap-3">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) handlePhotoUpload(f); e.target.value = ""; }}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="flex items-center justify-between p-4 bg-card border border-border rounded-2xl hover:border-accent/30 transition-colors disabled:opacity-50"
            >
              <span className="text-sm font-medium text-foreground flex items-center gap-2">
                <ImageIcon size={15} className="text-accent" />
                {uploading ? "جارٍ الرفع..." : "تحديث صور المكان"}
              </span>
              <ChevronLeft size={16} className="text-muted-foreground rotate-180" />
            </button>

            <button
              onClick={() => { setFormError(null); setShowEditPlaceModal(true); }}
              className="flex items-center justify-between p-4 bg-card border border-border rounded-2xl hover:border-accent/30 transition-colors"
            >
              <span className="text-sm font-medium text-foreground">تعديل بيانات المكان وأوقات العمل والروابط</span>
              <ChevronLeft size={16} className="text-muted-foreground rotate-180" />
            </button>

            <button disabled className="flex items-center justify-between p-4 bg-card border border-border rounded-2xl opacity-50">
              <span className="text-sm font-medium text-foreground">إضافة المنيو</span>
              <span className="text-xs text-muted-foreground">قريباً</span>
            </button>

            <button
              onClick={enableNotifications}
              className="flex items-center justify-between p-4 bg-card border border-border rounded-2xl hover:border-accent/30 transition-colors"
            >
              <span className="text-sm font-medium text-foreground">إعدادات الإشعارات</span>
              <span className="text-xs text-accent font-semibold">{notifEnabled ? "مفعّلة ✓" : "تفعيل"}</span>
            </button>
          </div>
        )}
      </div>

      {/* Offer Modal */}
      {showOfferModal && (
        <div className="absolute inset-0 z-50 flex items-end" dir="rtl" {...sheet1}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowOfferModal(false)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">{editingOfferId ? "تعديل العرض" : "عرض جديد"}</h3>
              <button onClick={() => setShowOfferModal(false)}>
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">عنوان العرض</label>
                <input
                  type="text"
                  value={offerTitle}
                  onChange={e => setOfferTitle(e.target.value)}
                  placeholder="مثل: ٢٠٪ على كل المشروبات"
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">التفاصيل</label>
                <textarea
                  value={offerDesc}
                  onChange={e => setOfferDesc(e.target.value)}
                  rows={3}
                  placeholder="وصف العرض وشروطه..."
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">نسبة الخصم (اختياري)</label>
                <input
                  type="text"
                  value={offerDiscount}
                  onChange={e => setOfferDiscount(e.target.value)}
                  placeholder="مثل: ٢٠٪"
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">تاريخ الانتهاء</label>
                <input
                  type="date"
                  value={offerEndDate}
                  onChange={e => setOfferEndDate(e.target.value)}
                  className="w-full bg-input-background border border-border rounded-2xl px-3 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30"
                />
              </div>
              {formError && <p className="text-xs text-center text-destructive">{formError}</p>}
              <button
                disabled={!offerTitle.trim() || !offerEndDate}
                onClick={submitOffer}
                className="w-full py-3.5 rounded-2xl bg-accent text-white text-sm font-semibold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <Check size={16} /> {editingOfferId ? "حفظ التعديل" : "نشر العرض"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Place Modal */}
      {showEditPlaceModal && (
        <div className="absolute inset-0 z-50 flex items-end" dir="rtl" {...sheet2}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowEditPlaceModal(false)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6 max-h-[80vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">تعديل بيانات المكان</h3>
              <button onClick={() => setShowEditPlaceModal(false)}>
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">الاسم</label>
                <input type="text" value={editName} onChange={e => setEditName(e.target.value)} className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">الوصف</label>
                <textarea value={editDescription} onChange={e => setEditDescription(e.target.value)} rows={3} className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">العنوان</label>
                <input type="text" value={editAddress} onChange={e => setEditAddress(e.target.value)} className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">أوقات العمل</label>
                <input type="text" value={editOpeningHours} onChange={e => setEditOpeningHours(e.target.value)} placeholder="مثل: ٧ص - ١١م" className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">رابط الطلب</label>
                <input type="text" value={editOrderLink} onChange={e => setEditOrderLink(e.target.value)} placeholder="https://..." className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">رابط الحجز</label>
                <input type="text" value={editBookingLink} onChange={e => setEditBookingLink(e.target.value)} placeholder="https://..." className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30" />
              </div>
              {formError && <p className="text-xs text-center text-destructive">{formError}</p>}
              <Button
                fullWidth
                onClick={saveEditPlace}
                disabled={!editName.trim()}
              >
                حفظ التغييرات
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Promotion Request Modal */}
      {showPromoModal && (
        <div className="absolute inset-0 z-50 flex items-end" dir="rtl" {...sheet3}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowPromoModal(false)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">طلب ترويج</h3>
              <button onClick={() => setShowPromoModal(false)}><X size={20} className="text-muted-foreground" /></button>
            </div>
            <div className="flex flex-col gap-4">
              <div>
                <label className="text-xs text-muted-foreground mb-2 block">القسم المطلوب</label>
                <div className="flex flex-col gap-2">
                  {SELECTABLE_PLACEMENTS.map(pl => (
                    <button
                      key={pl}
                      onClick={() => setPromoPlacement(pl)}
                      className={`w-full text-right px-4 py-3 rounded-2xl border text-sm transition-colors ${
                        promoPlacement === pl ? "bg-primary text-primary-foreground border-primary" : "bg-input-background border-border text-foreground"
                      }`}
                    >
                      {PLACEMENT_LABELS[pl]}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs text-muted-foreground mb-1.5 block">لماذا يستحق مكانك الترويج؟ (اختياري)</label>
                <textarea
                  value={promoNote}
                  onChange={e => setPromoNote(e.target.value)}
                  rows={3}
                  placeholder="مثال: افتتحنا فرعاً جديداً، أو لدينا تجربة مميزة..."
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none"
                />
              </div>
              <p className="text-xs text-muted-foreground">يراجع فريق مقصد الطلب قبل ظهوره للمستخدمين.</p>
              {promoError && <p className="text-xs text-destructive text-center">{promoError}</p>}
              <Button
                fullWidth
                onClick={submitPromotion}
                loading={promoSending}
                disabled={promoSending || placementTaken(promoPlacement)}
              >
                {placementTaken(promoPlacement) ? "طلب قائم لهذا القسم" : "إرسال الطلب"}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
