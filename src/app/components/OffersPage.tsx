import { useEffect, useState } from "react";
import { tappable } from "../lib/a11y";
import { Clock, Tag } from "lucide-react";
import type { Offer, Place } from "./data";
import { getActiveOffers } from "../lib/offers";
import { getPlaces } from "../lib/places";
import { updateProfile } from "../lib/profile";
import { toast } from "../lib/toast";
import { PLACE_IMAGE_FALLBACK, originalImage } from "../lib/types";

type Props = {
  userId: string | null;
  onPlaceClick: (id: string) => void;
};

export function OffersPage({ userId, onPlaceClick }: Props) {
  const [offers, setOffers] = useState<Offer[]>([]);
  const [places, setPlaces] = useState<Place[]>([]);
  const [notifEnabled, setNotifEnabled] = useState(
    () => "Notification" in window && Notification.permission === "granted"
  );
  const [notifError, setNotifError] = useState<string | null>(null);

  useEffect(() => {
    getActiveOffers().then(setOffers).catch(console.error);
    getPlaces().then(setPlaces).catch(console.error);
  }, []);

  const enableNotifications = async () => {
    setNotifError(null);
    if (!("Notification" in window)) {
      setNotifError("متصفحك لا يدعم الإشعارات");
      return;
    }
    const permission = await Notification.requestPermission();
    if (permission === "granted") {
      setNotifEnabled(true);
      if (userId) updateProfile(userId, { notification_opt_in: true }).catch(() => toast.error("تعذّر حفظ تفضيل الإشعارات — حاول مجدداً"));
    } else {
      setNotifError("الإشعارات محظورة — فعّلها من إعدادات المتصفح ثم أعد المحاولة");
    }
  };

  const activeOffers = offers.map(offer => ({
    offer,
    place: places.find(p => p.id === offer.placeId),
  })).filter((o): o is { offer: Offer; place: Place } => !!o.place);

  return (
    <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm px-5 pt-14 pb-4">
        <h1 className="text-xl font-bold text-foreground">العروض</h1>
        <p className="text-sm text-muted-foreground mt-0.5">{activeOffers.length} عرض نشط الآن</p>
      </div>

      {/* Banner */}
      <div className="mx-5 mb-6 rounded-3xl overflow-hidden relative h-32"
        style={{ background: "linear-gradient(135deg, #2C1810 0%, #C47B2B 100%)" }}>
        <div className="absolute inset-0 flex items-center justify-between px-6">
          <div>
            <p className="text-white/70 text-xs mb-1">عروض حصرية</p>
            <h2 className="text-white text-lg font-bold">وفّر أكثر اليوم 🎁</h2>
            <p className="text-white/60 text-xs mt-1">من كافيهات ومطاعم موثقة</p>
          </div>
          <div className="text-6xl opacity-30">🎫</div>
        </div>
      </div>

      {/* Offer Cards */}
      {activeOffers.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">لا توجد عروض نشطة حالياً</p>
      ) : (
        <div className="px-5 flex flex-col gap-4">
          {activeOffers.map(({ offer, place }) => (
            <div
              key={offer.id}
              className="bg-card border border-border rounded-3xl overflow-hidden cursor-pointer hover:shadow-lg transition-all group"
              {...tappable(() => onPlaceClick(place.id), `${offer.title} — ${place.name}`)}
            >
              <div className="relative h-40">
                <img
                  src={place.image}
                  alt={place.name}
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
          onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }}
        />
                <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

                {offer.discount && (
                  <div className="absolute top-3 right-3 bg-accent text-white font-bold px-3 py-1.5 rounded-full text-sm">
                    {offer.discount} خصم
                  </div>
                )}

                <div className="absolute bottom-3 right-3">
                  <span className="bg-white/20 backdrop-blur-sm text-white text-xs px-2.5 py-1 rounded-full">
                    {place.isVerified ? "✓ موثق" : place.name}
                  </span>
                </div>
              </div>

              <div className="p-4">
                <div className="flex items-start justify-between gap-3 mb-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">{place.name} · {place.district}</p>
                    <h3 className="text-base font-bold text-foreground leading-tight">{offer.title}</h3>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground leading-relaxed mb-3">{offer.description}</p>

                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <Clock size={12} className="text-accent" />
                    <span>ينتهي {offer.endDate}</span>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onPlaceClick(place.id); }}
                    className="flex items-center gap-1.5 bg-primary text-primary-foreground px-4 py-2 rounded-full text-xs font-semibold hover:opacity-90 transition-opacity"
                  >
                    <Tag size={11} /> عرض المكان
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="px-5 mt-6 mb-2">
        <div className="bg-muted rounded-2xl p-4 text-center">
          <p className="text-sm text-muted-foreground">
            🔔 فعّل الإشعارات لتصلك العروض فور نشرها
          </p>
          {notifEnabled ? (
            <p className="mt-2 text-success text-sm font-semibold">الإشعارات مفعّلة ✓</p>
          ) : (
            <>
              <button onClick={enableNotifications} className="mt-2 text-accent text-sm font-semibold">تفعيل الإشعارات</button>
              {notifError && <p className="mt-2 text-destructive text-xs">{notifError}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
