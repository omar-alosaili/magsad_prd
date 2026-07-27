import { useEffect, useRef, useState } from "react";
import { tappable } from "../lib/a11y";
import { motion } from "motion/react";
import {
  ArrowRight, Bookmark, Share2, MapPin, Clock, Star, Wifi, Users, Baby,
  Trees, Car, ExternalLink, ChevronLeft, Plus, X, Check, Camera, Flag
} from "lucide-react";
import { type Place, type List, displayRating, isRecentlyAdded } from "./data";
import { Button } from "./Button";
import { getPlaceById, invalidatePlacesCache } from "../lib/places";
import { getListsContainingPlace, getMyLists, addPlaceToList } from "../lib/lists";
import { getReviewsForPlace, addReview, uploadReviewPhoto, MAX_REVIEW_PHOTOS, MAX_PHOTO_BYTES } from "../lib/reviews";
import { getVisitStatus, setVisitStatus, type VisitStatus } from "../lib/visitedPlaces";
import {
  submitPlaceReport, PLACE_REPORT_REASONS, type PlaceReportReason,
  submitReviewReport, REVIEW_REPORT_REASONS, type ReviewReportReason,
} from "../lib/placeReports";
import { toast } from "../lib/toast";
import { OpeningHours } from "./OpeningHours";
import type { Review } from "../lib/types";
import { sizedImage, IMG, PLACE_IMAGE_FALLBACK, originalImage } from "../lib/types";
import { useSheetA11y } from "./Sheet";

type Props = {
  placeId: string;
  userId: string | null;
  onBack: () => void;
  savedPlaces: Set<string>;
  onSave: (id: string) => void;
  onListClick: (id: string) => void;
};

const priceMap = { 1: "＄ اقتصادي", 2: "＄＄ متوسط", 3: "＄＄＄ مرتفع" };

export function PlacePage({ placeId, userId, onBack, savedPlaces, onSave, onListClick }: Props) {
  const [place, setPlace] = useState<Place | null>(null);
  // A shared ?p= link to a deleted/quarantined/mistyped place used to render
  // null forever: a blank full-screen with no back button and no tab bar.
  const [placeMissing, setPlaceMissing] = useState(false);
  const [placeLists, setPlaceLists] = useState<List[]>([]);
  const [myLists, setMyLists] = useState<List[]>([]);
  const [reviews, setReviews] = useState<Review[]>([]);
  const [activeImage, setActiveImage] = useState(0);
  const [showSaveModal, setShowSaveModal] = useState(false);
  const [visitStatus, setLocalVisitStatus] = useState<VisitStatus | null>(null);
  const [tab, setTab] = useState<"info" | "reviews" | "lists">("info");
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [reviewRating, setReviewRating] = useState(5);
  const [reviewComment, setReviewComment] = useState("");
  const [reviewSubmitting, setReviewSubmitting] = useState(false);
  const [reviewsFailed, setReviewsFailed] = useState(false);
  const [reviewPhotos, setReviewPhotos] = useState<string[]>([]);
  const [photoUploading, setPhotoUploading] = useState(false);
  const [showReportModal, setShowReportModal] = useState(false);
  const [reportReason, setReportReason] = useState<PlaceReportReason>("closed");
  const [reportSubmitting, setReportSubmitting] = useState(false);
  // Review reporting — which review is being reported (null = modal closed)
  const [reportingReview, setReportingReview] = useState<Review | null>(null);
  const [reviewReportReason, setReviewReportReason] = useState<ReviewReportReason>("offensive");
  const [reviewReportSubmitting, setReviewReportSubmitting] = useState(false);

  // The viewer's own review, if any — submitting again edits it.
  const myReview = userId ? reviews.find(r => r.userId === userId) : undefined;

  // In-flight guard: rapid taps raced the UPSERT against the DELETE and
  // could silently drop the user's last choice (same guard as handleSave).
  const visitInFlight = useRef(false);
  const visitTouched = useRef(false);
  const saveSheet = useSheetA11y(showSaveModal, () => setShowSaveModal(false), "احفظ في قائمة");

  useEffect(() => {
    // Reset per-place UI state so navigating place→place doesn't carry
    // over the previous place's tab, image, or half-typed review draft.
    setTab("info");
    setActiveImage(0);
    setShowReviewForm(false);
    setReviewRating(5);
    setReviewComment("");
    setReviewPhotos([]);
    setReviewsFailed(false);
    setPlaceMissing(false);
    getPlaceById(placeId)
      .then(p => { setPlace(p); if (!p) setPlaceMissing(true); })
      .catch(() => setPlaceMissing(true));
    getListsContainingPlace(placeId).then(setPlaceLists).catch(console.error);
    getReviewsForPlace(placeId).then(setReviews).catch(() => setReviewsFailed(true));
    setLocalVisitStatus(null);
    visitTouched.current = false;
    if (userId) {
      getMyLists(userId).then(setMyLists).catch(console.error);
      // Ignore the fetched status if the user already toggled while it was
      // in flight — a slow response must not blank their optimistic choice.
      getVisitStatus(userId, placeId)
        .then(s => { if (!visitTouched.current) setLocalVisitStatus(s); })
        .catch(console.error);
    } else {
      setMyLists([]);
    }
  }, [placeId, userId]);

  const toggleVisitStatus = (status: VisitStatus) => {
    if (!userId) { toast.info("سجّل الدخول لتسجيل زياراتك"); return; }
    if (visitInFlight.current) return;
    visitTouched.current = true;
    const prev = visitStatus;
    const next = visitStatus === status ? null : status;
    setLocalVisitStatus(next);
    visitInFlight.current = true;
    setVisitStatus(userId, placeId, next)
      .catch(() => {
        setLocalVisitStatus(prev);
        toast.error("تعذّر تحديث حالة الزيارة — حاول مجدداً");
      })
      .finally(() => { visitInFlight.current = false; });
  };

  const addPhotoFile = (file: File | null | undefined) => {
    if (!file || !userId || photoUploading) return;
    if (reviewPhotos.length >= MAX_REVIEW_PHOTOS) { toast.info(`الحد الأقصى ${MAX_REVIEW_PHOTOS} صور`); return; }
    if (file.size > MAX_PHOTO_BYTES) { toast.error("الصورة أكبر من 5MB — اختر صورة أصغر"); return; }
    setPhotoUploading(true);
    uploadReviewPhoto(userId, file)
      .then(url => setReviewPhotos(prev => [...prev, url]))
      .catch(() => toast.error("تعذّر رفع الصورة — حاول مجدداً"))
      .finally(() => setPhotoUploading(false));
  };

  const submitReview = () => {
    if (!userId || !reviewComment.trim() || reviewSubmitting) return;
    const isEdit = !!myReview;
    setReviewSubmitting(true);
    addReview({ placeId, userId, rating: reviewRating, comment: reviewComment.trim(), photos: reviewPhotos })
      .then(review => {
        // Replace an edited review instead of duplicating it in the list
        setReviews(prev => [review, ...prev.filter(r => r.id !== review.id)]);
        setShowReviewForm(false);
        setReviewComment("");
        setReviewRating(5);
        setReviewPhotos([]);
        toast.success(isEdit ? "تم تحديث تقييمك" : "تم نشر تقييمك، شكراً لك");
        // The rating trigger just changed places.rating/review_count —
        // refetch so the blended header rating doesn't go stale, and drop
        // the shared catalog cache so other screens pick it up too.
        invalidatePlacesCache();
        getPlaceById(placeId).then(p => { if (p) setPlace(p); }).catch(() => {});
      })
      .catch(() => toast.error("تعذّر نشر التقييم — حاول مجدداً"))
      .finally(() => setReviewSubmitting(false));
  };

  const sendReport = () => {
    if (!userId || reportSubmitting) return;
    setReportSubmitting(true);
    submitPlaceReport(placeId, userId, reportReason)
      .then(result => {
        setShowReportModal(false);
        if (result === "already") toast.info("سبق أن أبلغت عن هذا المكان — البلاغ قيد المراجعة");
        else toast.success("شكراً، وصلنا بلاغك وسنراجعه");
      })
      .catch(() => toast.error("تعذّر إرسال البلاغ — حاول مجدداً"))
      .finally(() => setReportSubmitting(false));
  };

  const openReviewReport = (review: Review) => {
    if (!userId) { toast.info("سجّل دخولك للإبلاغ عن المراجعات"); return; }
    setReviewReportReason("offensive");
    setReportingReview(review);
  };

  const sendReviewReport = () => {
    if (!userId || !reportingReview || reviewReportSubmitting) return;
    setReviewReportSubmitting(true);
    submitReviewReport(reportingReview.id, userId, reviewReportReason)
      .then(result => {
        setReportingReview(null);
        if (result === "already") toast.info("سبق أن أبلغت عن هذه المراجعة — البلاغ قيد المراجعة");
        else toast.success("شكراً، وصلنا بلاغك وسنراجعه");
      })
      .catch(() => toast.error("تعذّر إرسال البلاغ — حاول مجدداً"))
      .finally(() => setReviewReportSubmitting(false));
  };

  const sharePlace = () => {
    if (!place) return;
    const url = `${window.location.origin}/?p=${place.id}`;
    if (navigator.share) navigator.share({ title: place.name, url }).catch(() => {});
    else navigator.clipboard.writeText(url)
      .then(() => toast.success("تم نسخ رابط المكان"))
      .catch(() => toast.error("تعذّر نسخ الرابط"));
  };

  const saveToList = (listId: string) => {
    addPlaceToList(listId, place!.id)
      .then(result => {
        if (result === "exists") {
          toast.info("المكان موجود في هذه القائمة مسبقاً");
          return;
        }
        toast.success("تمت إضافة المكان إلى القائمة");
        // keep the modal's place counts honest without a refetch
        setMyLists(prev => prev.map(l =>
          l.id === listId ? { ...l, placeCount: l.placeCount + 1, placeIds: [...l.placeIds, place!.id] } : l,
        ));
      })
      .catch(() => toast.error("تعذّرت إضافة المكان إلى القائمة — حاول مجدداً"));
    // Ensure saved — never toggle: adding an already-saved place to a
    // second list must not silently unsave it.
    if (!savedPlaces.has(place!.id)) onSave(place!.id);
    setShowSaveModal(false);
  };

  if (!place) {
    if (!placeMissing) return null; // still loading — the parent shows a spinner
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-background px-8" dir="rtl">
        <p className="text-sm text-muted-foreground text-center">لم نعثر على هذا المكان — قد يكون حُذف أو تغيّر الرابط</p>
        <button onClick={onBack} className="px-6 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold">
          العودة للرئيسية
        </button>
      </div>
    );
  }


  return (
    <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
      {/* Images Carousel */}
      <div className="relative h-72 bg-muted">
        <img
          src={sizedImage(place.images[activeImage], IMG.hero)}
          alt={place.name}
          className="w-full h-full object-cover"
          onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }}
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />

        {/* Back Button */}
        <button
          onClick={onBack}
          aria-label="رجوع"
          className="absolute top-14 right-5 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md"
        >
          <ArrowRight size={20} className="text-foreground" />
        </button>

        {/* Action Buttons */}
        <div className="absolute top-14 left-5 flex gap-2">
          <button
            onClick={sharePlace}
            aria-label="مشاركة المكان"
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md"
          >
            <Share2 size={16} className="text-foreground" />
          </button>
          {/* Guests can't have lists — onSave shows the login nudge
              instead of opening a dead-end modal. */}
          <button
            onClick={() => (userId ? setShowSaveModal(true) : onSave(place.id))}
            aria-label="حفظ المكان"
            aria-pressed={savedPlaces.has(place.id)}
            className="w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md"
          >
            <Bookmark
              size={16}
              className={savedPlaces.has(place.id) ? "fill-accent text-accent" : "text-foreground"}
            />
          </button>
        </div>

        {/* Image Dots */}
        {place.images.length > 1 && (
          <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-1.5">
            {place.images.map((_, i) => (
              <button
                key={i}
                onClick={() => setActiveImage(i)}
                aria-label={`الصورة ${(i + 1).toLocaleString("en-US")}`}
                aria-current={i === activeImage}
                className={`rounded-full transition-all ${
                  i === activeImage ? "w-5 h-1.5 bg-white" : "w-1.5 h-1.5 bg-white/50"
                }`}
              />
            ))}
          </div>
        )}

        {/* Badges */}
        <div className="absolute bottom-8 right-4 flex gap-2">
          {isRecentlyAdded(place) && (
            <span className="bg-accent text-white text-xs px-2.5 py-1 rounded-full font-medium">جديد</span>
          )}
          {place.isVerified && (
            <span className="bg-primary text-primary-foreground text-xs px-2.5 py-1 rounded-full font-medium">✓ موثق</span>
          )}
        </div>
      </div>

      {/* Place Info */}
      <div className="px-5 py-5">
        <div className="flex items-start justify-between mb-2">
          <div>
            <h1 className="text-2xl font-bold text-foreground">{place.name}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {place.category ? `${place.type} · ${place.category}` : place.type}
            </p>
          </div>
          <span
            className={`text-sm px-3 py-1.5 rounded-full font-medium flex-shrink-0 mt-1 ${
              place.isOpen ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
            }`}
          >
            {place.isOpen ? "مفتوح" : "مغلق"}
          </span>
        </div>

        <div className="flex items-center gap-4 mb-4">
          <div className="flex items-center gap-1">
            <Star size={15} className="fill-rating text-rating" />
            <span className="font-semibold text-foreground">{displayRating(place).rating}</span>
            <span className="text-muted-foreground text-sm">({displayRating(place).count} تقييم)</span>
          </div>
          <span className="text-sm text-muted-foreground">{priceMap[place.priceLevel]}</span>
        </div>

        <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
          <MapPin size={14} className="text-accent flex-shrink-0" />
          <span>{place.address}</span>
        </div>
        <OpeningHours value={place.openingHours} isOpen={place.isOpen} />

        {/* Quick Actions */}
        <div className="flex gap-3 mb-6">
          {/* Enabled for guests too — the tap shows the login nudge instead
              of a dead dimmed control (same pattern as save/review/follow). */}
          <button
            onClick={() => toggleVisitStatus("visited")}
            aria-pressed={visitStatus === "visited"}
            className={`flex-1 py-3 rounded-2xl text-sm font-semibold border transition-all flex items-center justify-center gap-2 ${
              visitStatus === "visited"
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-foreground"
            }`}
          >
            {visitStatus === "visited" ? <Check size={15} /> : null}
            {visitStatus === "visited" ? "زرته ✓" : "زرته"}
          </button>
          <button
            onClick={() => toggleVisitStatus("want_to_visit")}
            aria-pressed={visitStatus === "want_to_visit"}
            className={`flex-1 py-3 rounded-2xl text-sm font-semibold border transition-all flex items-center justify-center gap-2 ${
              visitStatus === "want_to_visit"
                ? "bg-accent text-white border-accent"
                : "bg-card border-border text-foreground"
            }`}
          >
            {visitStatus === "want_to_visit" ? <Check size={15} /> : null}
            {visitStatus === "want_to_visit" ? "أرغب بالزيارة ✓" : "أرغب بالزيارة"}
          </button>
        </div>

        {/* Maps Button — query_place_id opens the actual Google listing
            (name, photos, reviews); the lat/lng query is the fallback pin
            for admin-created places without a Google ID. */}
        <a
          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${place.latitude},${place.longitude}`)}${place.googlePlaceId ? `&query_place_id=${encodeURIComponent(place.googlePlaceId)}` : ""}`}
          target="_blank"
          rel="noopener noreferrer"
          className="w-full py-3 rounded-2xl bg-muted text-foreground text-sm font-semibold flex items-center justify-center gap-2 mb-6 hover:bg-secondary transition-colors"
        >
          <MapPin size={15} className="text-accent" />
          فتح الاتجاهات في الخريطة
          <ExternalLink size={13} className="text-muted-foreground" />
        </a>

        {/* Features Tags */}
        <div className="flex flex-wrap gap-2 mb-6">
          {place.isWorkFriendly && (
            <span className="flex items-center gap-1.5 text-sm bg-muted px-3 py-1.5 rounded-xl text-foreground">
              <Wifi size={13} className="text-accent" /> مناسب للعمل
            </span>
          )}
          {place.isFamilyFriendly && (
            <span className="flex items-center gap-1.5 text-sm bg-muted px-3 py-1.5 rounded-xl text-foreground">
              <Users size={13} className="text-accent" /> عائلي
            </span>
          )}
          {place.isKidsFriendly && (
            <span className="flex items-center gap-1.5 text-sm bg-muted px-3 py-1.5 rounded-xl text-foreground">
              <Baby size={13} className="text-accent" /> مناسب للأطفال
            </span>
          )}
          {place.hasOutdoorSeating && (
            <span className="flex items-center gap-1.5 text-sm bg-muted px-3 py-1.5 rounded-xl text-foreground">
              <Trees size={13} className="text-accent" /> جلسات خارجية
            </span>
          )}
          {place.hasParking && (
            <span className="flex items-center gap-1.5 text-sm bg-muted px-3 py-1.5 rounded-xl text-foreground">
              <Car size={13} className="text-accent" /> مواقف
            </span>
          )}
        </div>

        {/* Tabs */}
        <div className="flex gap-1 bg-muted p-1 rounded-2xl mb-5">
          {(["info", "reviews", "lists"] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 rounded-xl text-sm font-medium transition-all ${
                tab === t ? "bg-card text-foreground shadow-sm" : "text-muted-foreground"
              }`}
            >
              {t === "info" ? "المعلومات" : t === "reviews" ? "التقييمات" : "القوائم"}
            </button>
          ))}
        </div>

        {tab === "info" && (
          <div>
            {/* Google-synced places carry no description — render nothing
                rather than an empty block that reads as a broken page. */}
            {place.description.trim() && (
              <p className="text-sm text-foreground leading-relaxed mb-4">{place.description}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {place.tags.map(tag => (
                <span key={tag} className="text-xs bg-secondary text-secondary-foreground px-3 py-1 rounded-full">
                  #{tag}
                </span>
              ))}
            </div>
            {place.orderLink && (
              <a
                href={place.orderLink}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-4 flex items-center justify-center gap-2 w-full py-3 rounded-2xl bg-accent text-white text-sm font-semibold hover:opacity-90 transition-opacity"
              >
                اطلب الآن <ExternalLink size={14} />
              </a>
            )}
            <button
              onClick={() => (userId ? setShowReportModal(true) : toast.info("سجّل الدخول للإبلاغ عن مكان"))}
              className="mt-5 w-full text-center text-xs text-muted-foreground underline underline-offset-2 py-1"
            >
              الإبلاغ عن مشكلة في هذا المكان
            </button>
          </div>
        )}

        {tab === "reviews" && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <p className="text-sm text-muted-foreground">{reviews.length} تقييم</p>
              {userId ? (
                <button
                  onClick={() => setShowReviewForm(v => {
                    // Editing: prefill the form with the existing review
                    if (!v && myReview) { setReviewRating(myReview.rating); setReviewComment(myReview.comment); setReviewPhotos(myReview.photos); }
                    return !v;
                  })}
                  className="flex items-center gap-1 text-sm text-accent font-medium"
                >
                  <Plus size={14} /> {myReview ? "عدّل تقييمك" : "أضف تقييمك"}
                </button>
              ) : (
                <button
                  onClick={() => toast.info("سجّل الدخول لإضافة تقييم")}
                  className="flex items-center gap-1 text-sm text-accent font-medium"
                >
                  <Plus size={14} /> أضف تقييمك
                </button>
              )}
            </div>
            {showReviewForm && (
              <div className="bg-card border border-border rounded-2xl p-4 mb-4">
                <div className="flex gap-1 mb-3" style={{ direction: "ltr" }} role="radiogroup" aria-label="التقييم بالنجوم">
                  {[1, 2, 3, 4, 5].map(n => (
                    <button
                      key={n}
                      onClick={() => setReviewRating(n)}
                      role="radio"
                      aria-checked={reviewRating === n}
                      aria-label={`${n} من 5 نجوم`}
                    >
                      <Star size={20} className={n <= reviewRating ? "fill-rating text-rating" : "text-muted"} />
                    </button>
                  ))}
                </div>
                <textarea
                  maxLength={1500}
                  value={reviewComment}
                  onChange={e => setReviewComment(e.target.value)}
                  placeholder="شاركنا تجربتك..."
                  rows={3}
                  className="w-full bg-input-background border border-border rounded-2xl px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 resize-none mb-1"
                />
                {!reviewComment.trim() && (
                  <p className="text-xs text-muted-foreground mb-2">اكتب تعليقاً قصيراً لنشر تقييمك</p>
                )}
                {/* First-party photos — the long-term answer to the Google photo moat */}
                <div className="flex items-center gap-2 mb-3 flex-wrap">
                  {reviewPhotos.map(url => (
                    <div key={url} className="relative">
                      <img src={url} alt="صورة مرفقة" className="w-14 h-14 rounded-xl object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                      <button
                        onClick={() => setReviewPhotos(prev => prev.filter(p => p !== url))}
                        aria-label="إزالة الصورة"
                        className="absolute -top-1.5 -left-1.5 w-5 h-5 rounded-full bg-foreground text-background flex items-center justify-center"
                      >
                        <X size={11} />
                      </button>
                    </div>
                  ))}
                  {reviewPhotos.length < MAX_REVIEW_PHOTOS && (
                    <label className={`w-14 h-14 rounded-xl border border-dashed border-accent/50 flex items-center justify-center cursor-pointer text-accent ${photoUploading ? "opacity-50" : ""}`}>
                      {photoUploading
                        ? <span className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
                        : <Camera size={18} />}
                      <input
                        type="file"
                        accept="image/*"
                        className="hidden"
                        disabled={photoUploading}
                        onChange={e => { addPhotoFile(e.target.files?.[0]); e.target.value = ""; }}
                      />
                    </label>
                  )}
                </div>
                <Button
                  fullWidth
                  size="md"
                  onClick={submitReview}
                  loading={reviewSubmitting}
                  disabled={!reviewComment.trim() || reviewSubmitting}
                >
                  {myReview ? "تحديث التقييم" : "نشر التقييم"}
                </Button>
              </div>
            )}
            {reviewsFailed ? (
              <div className="text-center py-8 text-muted-foreground text-sm">تعذّر تحميل التقييمات — تأكد من اتصالك</div>
            ) : reviews.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">لا توجد تقييمات بعد</div>
            ) : (
              <div className="flex flex-col gap-4">
                {reviews.map(review => (
                  <div key={review.id} className="bg-card border border-border rounded-2xl p-4">
                    <div className="flex items-center gap-3 mb-3">
                      {review.avatar && (
                        <img src={sizedImage(review.avatar, IMG.thumb)} alt={review.user} className="w-9 h-9 rounded-full object-cover" loading="lazy" decoding="async" onError={e => { e.currentTarget.style.display = "none"; }} />
                      )}
                      <div>
                        <p className="text-sm font-semibold text-foreground">{review.user}</p>
                        <div className="flex items-center gap-2">
                          <div className="flex gap-0.5">
                            {[...Array(5)].map((_, i) => (
                              <Star key={i} size={11} className={i < review.rating ? "fill-rating text-rating" : "text-muted"} />
                            ))}
                          </div>
                          <span className="text-xs text-muted-foreground">{review.date}</span>
                        </div>
                      </div>
                      {review.userId !== userId && (
                        <button
                          onClick={() => openReviewReport(review)}
                          aria-label={`الإبلاغ عن مراجعة ${review.user}`}
                          className="mr-auto p-1.5 text-muted-foreground/60 hover:text-danger transition-colors"
                        >
                          <Flag size={14} />
                        </button>
                      )}
                    </div>
                    <p className="text-sm text-foreground leading-relaxed">{review.comment}</p>
                    {review.photos.length > 0 && (
                      <div className="flex gap-2 mt-2.5">
                        {review.photos.map(url => (
                          <a key={url} href={url} target="_blank" rel="noopener noreferrer">
                            <img src={url} alt={`صورة من ${review.user}`} className="w-20 h-20 rounded-xl object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {tab === "lists" && (
          <div>
            <p className="text-sm text-muted-foreground mb-4">المكان في {placeLists.length} قوائم</p>
            {placeLists.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">لم يُضف بعد لأي قائمة</div>
            ) : (
              <div className="flex flex-col gap-3">
                {placeLists.map(list => (
                  <div
                    key={list.id}
                    className="flex items-center gap-3 p-3 bg-card border border-border rounded-2xl cursor-pointer hover:border-accent/30 transition-colors"
                    {...tappable(() => onListClick(list.id), list.title)}
                  >
                    <img src={sizedImage(list.coverImage, IMG.thumb)} alt={list.title} className="w-14 h-14 rounded-xl object-cover flex-shrink-0" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                    <div className="flex-1 min-w-0">
                      <h3 className="text-sm font-semibold text-foreground">{list.title}</h3>
                      <p className="text-xs text-muted-foreground mt-0.5">{list.placeCount} أماكن · {list.followers} متابع</p>
                    </div>
                    <ChevronLeft size={16} className="text-muted-foreground rotate-180" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Report Modal */}
      {showReportModal && (
        <div
          className="absolute inset-0 z-50 flex items-end"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="report-modal-title"
          onKeyDown={e => { if (e.key === "Escape") setShowReportModal(false); }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowReportModal(false)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 id="report-modal-title" className="text-base font-bold">الإبلاغ عن {place.name}</h3>
              <button onClick={() => setShowReportModal(false)} aria-label="إغلاق">
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-2 mb-4" role="radiogroup" aria-label="سبب البلاغ">
              {PLACE_REPORT_REASONS.map(r => (
                <button
                  key={r.id}
                  onClick={() => setReportReason(r.id)}
                  role="radio"
                  aria-checked={reportReason === r.id}
                  className={`text-right text-sm px-4 py-3 rounded-2xl border transition-colors ${
                    reportReason === r.id ? "border-accent bg-accent/10 text-foreground font-semibold" : "border-border text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button fullWidth size="md" onClick={sendReport} loading={reportSubmitting} disabled={reportSubmitting}>
              إرسال البلاغ
            </Button>
          </div>
        </div>
      )}

      {/* Review Report Modal */}
      {reportingReview && (
        <div
          className="absolute inset-0 z-50 flex items-end"
          dir="rtl"
          role="dialog"
          aria-modal="true"
          aria-labelledby="review-report-modal-title"
          // Focus the dialog on mount — onKeyDown only fires when focus is
          // inside it, so Escape would otherwise be dead until first tab/tap.
          tabIndex={-1}
          ref={el => el?.focus()}
          onKeyDown={e => { if (e.key === "Escape") setReportingReview(null); }}
        >
          <div className="absolute inset-0 bg-black/40" onClick={() => setReportingReview(null)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6">
            <div className="flex items-center justify-between mb-4">
              <h3 id="review-report-modal-title" className="text-base font-bold">الإبلاغ عن مراجعة {reportingReview.user}</h3>
              <button onClick={() => setReportingReview(null)} aria-label="إغلاق">
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-2 mb-4" role="radiogroup" aria-label="سبب البلاغ">
              {REVIEW_REPORT_REASONS.map(r => (
                <button
                  key={r.id}
                  onClick={() => setReviewReportReason(r.id)}
                  role="radio"
                  aria-checked={reviewReportReason === r.id}
                  className={`text-right text-sm px-4 py-3 rounded-2xl border transition-colors ${
                    reviewReportReason === r.id ? "border-accent bg-accent/10 text-foreground font-semibold" : "border-border text-foreground"
                  }`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            <Button fullWidth size="md" onClick={sendReviewReport} loading={reviewReportSubmitting} disabled={reviewReportSubmitting}>
              إرسال البلاغ
            </Button>
          </div>
        </div>
      )}

      {/* Save Modal */}
      {showSaveModal && (
        <div className="absolute inset-0 z-50 flex items-end" dir="rtl" {...saveSheet}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowSaveModal(false)} />
          <div className="relative w-full bg-card rounded-t-3xl p-6 max-h-[70vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-base font-bold">احفظ في قائمة</h3>
              <button onClick={() => setShowSaveModal(false)}>
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {userId && myLists.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-2">لا توجد قوائم بعد، أنشئ واحدة من تبويب القوائم</p>
              )}
              {myLists.map(list => {
                const inList = list.placeIds.includes(place.id);
                return (
                  <button
                    key={list.id}
                    onClick={() => saveToList(list.id)}
                    className="flex items-center gap-3 p-3 rounded-2xl border border-border hover:border-accent/40 transition-colors text-right"
                  >
                    <img src={sizedImage(list.coverImage, IMG.thumb)} alt={list.title} className="w-12 h-12 rounded-xl object-cover" loading="lazy" decoding="async" onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }} />
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold truncate">{list.title}</p>
                      <p className="text-xs text-muted-foreground">{list.placeCount} أماكن</p>
                    </div>
                    {inList && <span className="flex-shrink-0 text-xs text-success font-semibold">محفوظ هنا ✓</span>}
                  </button>
                );
              })}
              <button
                onClick={() => { setShowSaveModal(false); onListClick(""); }}
                className="flex items-center gap-3 p-3 rounded-2xl border border-dashed border-accent/40 text-accent hover:bg-accent/5 transition-colors"
              >
                <div className="w-12 h-12 rounded-xl bg-accent/10 flex items-center justify-center">
                  <Plus size={20} className="text-accent" />
                </div>
                <span className="text-sm font-semibold">قائمة جديدة</span>
              </button>
              {savedPlaces.has(place.id) && (
                <button
                  onClick={() => { onSave(place.id); setShowSaveModal(false); }}
                  className="text-sm font-semibold text-destructive py-2"
                >
                  إزالة من المحفوظات
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
