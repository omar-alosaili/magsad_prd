import { useState } from "react";
import { APIProvider, Map as GoogleMap, AdvancedMarker } from "@vis.gl/react-google-maps";
import { X, MapPin, Check, AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { toast } from "../lib/toast";
import { previewMapPlace, importMapPlace, type MapPickResult } from "../lib/googleSync";
import { useSheetA11y } from "./Sheet";

const GOOGLE_MAPS_KEY =
  (import.meta.env.VITE_GOOGLE_MAPS_API_KEY as string | undefined) ||
  "AIzaSyDZ8z953e8wTsY69xTPkILItNBxNE8du0Q";
const RIYADH_CENTER = { lat: 24.7136, lng: 46.6753 };

type Props = { onClose: () => void; onImported: () => void };

// Add a missing place by tapping it on Google Maps. Google's own POI icons
// carry a placeId on click, so the admin picks the real Google identity
// instead of typing a name and coordinates by hand — which means the row
// lands with the same shape, quality score and photos the monthly sync
// would have produced.
export function AdminMapPicker({ onClose, onImported }: Props) {
  const [picked, setPicked] = useState<MapPickResult | null>(null);
  const [pinned, setPinned] = useState<{ lat: number; lng: number } | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);
  const sheet = useSheetA11y(true, onClose, "إضافة مكان من الخريطة");

  const handleMapClick = (ev: {
    detail: { placeId?: string | null; latLng?: { lat: number; lng: number } | null };
    stop?: () => void;
  }) => {
    const placeId = ev.detail?.placeId;
    // Suppress Google's own POI bubble — it renders "Place info couldn't
    // load" over our map because we never asked it to fetch details.
    ev.stop?.();
    if (!placeId) {
      // Tapping empty map (a road, a building with no listing) gives no id.
      toast.info("اضغط على اسم أو أيقونة المكان نفسه على الخريطة");
      return;
    }
    if (ev.detail.latLng) setPinned(ev.detail.latLng);
    setLoading(true);
    setPicked(null);
    previewMapPlace(placeId)
      .then(setPicked)
      .catch(() => toast.error("تعذّر جلب بيانات المكان — حاول مجدداً"))
      .finally(() => setLoading(false));
  };

  const confirmImport = () => {
    if (!picked || importing || picked.alreadyExists) return;
    setImporting(true);
    importMapPlace(picked.place.googlePlaceId)
      .then(r => {
        toast.success(
          r.status === "published"
            ? `تمت إضافة «${r.name}» ونُشر (جودة ${r.qualityScore})`
            : `تمت إضافة «${r.name}» — جودة ${r.qualityScore}، بحاجة لمراجعة`,
        );
        setPicked(null);
        setPinned(null);
        onImported();
      })
      .catch(e => {
        toast.error(e?.message === "duplicate" ? "هذا المكان مضاف بالفعل" : "تعذّرت الإضافة — حاول مجدداً");
      })
      .finally(() => setImporting(false));
  };

  const p = picked?.place;

  return (
    <div className="absolute inset-0 z-50 flex flex-col bg-background" dir="rtl" {...sheet}>
      <div className="flex items-center justify-between px-5 pt-14 pb-3 border-b border-border flex-shrink-0">
        <div>
          <h3 className="text-base font-bold text-foreground">إضافة مكان من الخريطة</h3>
          <p className="text-xs text-muted-foreground mt-0.5">اضغط على المكان مباشرةً على خريطة قوقل</p>
        </div>
        <button onClick={onClose} aria-label="إغلاق" className="w-9 h-9 rounded-full bg-muted flex items-center justify-center">
          <X size={18} className="text-foreground" />
        </button>
      </div>

      <div className="flex-1 relative">
        <APIProvider apiKey={GOOGLE_MAPS_KEY}>
          <GoogleMap
            defaultCenter={RIYADH_CENTER}
            defaultZoom={14}
            gestureHandling="greedy"
            disableDefaultUI
            zoomControl
            mapId="magsad-admin-picker"
            onClick={handleMapClick}
            style={{ width: "100%", height: "100%" }}
          >
            {pinned && (
              <AdvancedMarker position={pinned}>
                <div className="w-7 h-7 rounded-full bg-accent border-2 border-white shadow-lg flex items-center justify-center">
                  <MapPin size={14} className="text-white" />
                </div>
              </AdvancedMarker>
            )}
          </GoogleMap>
        </APIProvider>

        {loading && (
          <div className="absolute inset-x-0 bottom-0 bg-card border-t border-border p-4 text-center">
            <span className="text-sm text-muted-foreground">جارٍ جلب بيانات المكان…</span>
          </div>
        )}

        {p && !loading && (
          <div
            className="absolute inset-x-0 bottom-0 bg-card border-t border-border p-5 max-h-[55%] overflow-y-auto"
            style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom, 0px))" }}
          >
            <h4 className="text-base font-bold text-foreground">{p.name || "(بدون اسم)"}</h4>
            <p className="text-xs text-muted-foreground mt-1">{p.address}</p>

            <div className="flex flex-wrap gap-2 mt-3 text-xs">
              <span className="px-2.5 py-1 rounded-lg bg-muted text-foreground">{p.type}</span>
              <span className="px-2.5 py-1 rounded-lg bg-muted text-foreground">{p.district}</span>
              {p.rating != null && (
                <span className="px-2.5 py-1 rounded-lg bg-muted text-foreground">
                  ★ {p.rating} ({(p.reviewCount ?? 0).toLocaleString("en-US")})
                </span>
              )}
              <span className="px-2.5 py-1 rounded-lg bg-muted text-foreground">
                {p.photoCount.toLocaleString("en-US")} صور
              </span>
              {p.hasHours && <span className="px-2.5 py-1 rounded-lg bg-muted text-foreground">أوقات العمل ✓</span>}
              {(p.website || p.phone) && <span className="px-2.5 py-1 rounded-lg bg-muted text-foreground">وسيلة تواصل ✓</span>}
            </div>

            {picked.alreadyExists && (
              <div className="flex items-start gap-2 mt-4 p-3 rounded-xl bg-danger-soft">
                <AlertTriangle size={15} className="text-danger flex-shrink-0 mt-0.5" />
                <p className="text-xs text-danger">
                  هذا المكان مضاف بالفعل باسم «{picked.alreadyExists.name}»
                </p>
              </div>
            )}
            {!picked.alreadyExists && picked.outsideArea && (
              <div className="flex items-start gap-2 mt-4 p-3 rounded-xl bg-warning-soft">
                <AlertTriangle size={15} className="text-warning flex-shrink-0 mt-0.5" />
                <p className="text-xs text-warning">
                  يبعد {picked.distanceKm.toLocaleString("en-US")} كم عن مركز الرياض — تأكد أنه ضمن نطاق الخدمة
                </p>
              </div>
            )}
            {p.businessStatus && p.businessStatus !== "OPERATIONAL" && (
              <div className="flex items-start gap-2 mt-3 p-3 rounded-xl bg-danger-soft">
                <AlertTriangle size={15} className="text-danger flex-shrink-0 mt-0.5" />
                <p className="text-xs text-danger">تشير قوقل إلى أن هذا المكان مغلق</p>
              </div>
            )}

            <div className="flex gap-2 mt-4">
              <Button
                fullWidth
                size="md"
                onClick={confirmImport}
                loading={importing}
                disabled={importing || !!picked.alreadyExists}
              >
                <Check size={15} /> إضافة إلى المقصد
              </Button>
              <button
                onClick={() => { setPicked(null); setPinned(null); }}
                className="px-4 rounded-2xl bg-muted text-foreground text-sm font-medium"
              >
                إلغاء
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
