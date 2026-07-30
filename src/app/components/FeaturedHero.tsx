import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { Bookmark, X } from "lucide-react";
import { tappable } from "../lib/a11y";
import { displayRating, type Place } from "./data";
import { sizedImage, IMG, PLACE_IMAGE_FALLBACK, originalImage } from "../lib/types";
import { useSheetA11y } from "./Sheet";

type Props = {
  places: Place[]; // admin-featured, priority-ordered
  savedPlaces: Set<string>;
  onSave: (id: string) => void;
  onPlaceClick: (id: string) => void;
};

// The home "وين مقصدك اليوم؟" hero — an admin-curated showcase of specific
// places (fed by the promotions "نشر مكان" flow). One place shows as a
// static hero; several auto-rotate as a swipeable carousel with dots.
// «اكتشف» opens the full featured selection as a list — tapping the card
// itself opens the place currently showing.
export function FeaturedHero({ places, savedPlaces, onSave, onPlaceClick }: Props) {
  const count = places.length;
  const [idx, setIdx] = useState(0);
  const [showList, setShowList] = useState(false);
  // Hooks must precede the early return below (Rules of Hooks)
  const listSheet = useSheetA11y(showList, () => setShowList(false), "مميز هذا الأسبوع");
  const active = count > 0 ? places[idx % count] : null;

  // Auto-advance a multi-place showcase. Reset the timer whenever the index
  // changes (manual nav) so a tap doesn't get cut short. Paused while the
  // list sheet is open — rotating under an open sheet is disorienting.
  useEffect(() => {
    if (count <= 1 || showList) return;
    const t = setInterval(() => setIdx(i => (i + 1) % count), 5000);
    return () => clearInterval(t);
  }, [count, idx, showList]);

  if (!active) return null;

  const openPlace = (id: string) => {
    setShowList(false);
    onPlaceClick(id);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.12, ease: [0.22, 1, 0.36, 1] }}
      className="px-5 mb-8"
    >
      <div
        className="relative h-56 rounded-3xl overflow-hidden cursor-pointer"
        {...tappable(() => onPlaceClick(active.id), active.name)}
      >
        <AnimatePresence>
          <motion.img
            key={active.id}
            src={active.image}
            alt={active.name}
            className="absolute inset-0 w-full h-full object-cover"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.6 }}
          />
        </AnimatePresence>
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />

        <div className="absolute top-4 right-4">
          <span className="bg-accent text-white text-xs px-3 py-1.5 rounded-full font-semibold shadow-lg">
            ⭐ مميز هذا الأسبوع
          </span>
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onSave(active.id); }}
          aria-label={`حفظ ${active.name}`}
          className="absolute top-4 left-4 w-9 h-9 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-md"
        >
          <Bookmark size={16} className={savedPlaces.has(active.id) ? "fill-accent text-accent" : "text-foreground"} />
        </button>

        <div className="absolute bottom-4 right-4 left-4">
          <div className="flex items-end justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-white text-xl font-bold truncate">{active.name}</h2>
              <p className="text-white/70 text-sm mt-1">
                {active.district}{active.googleRating ? ` · ★ ${active.googleRating}` : ""}
              </p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); setShowList(true); }}
              aria-label="عرض قائمة الأماكن المميزة"
              className="flex-shrink-0 bg-white/20 backdrop-blur-sm border border-white/30 rounded-2xl px-3 py-1.5 hover:bg-white/30 transition-colors"
            >
              <span className="text-white text-xs font-semibold">اكتشف ←</span>
            </button>
          </div>

          {count > 1 && (
            <div className="flex items-center gap-1.5 mt-3">
              {places.map((p, i) => (
                <button
                  key={p.id}
                  onClick={(e) => { e.stopPropagation(); setIdx(i); }}
                  aria-label={`المكان ${i + 1} من ${count}`}
                  aria-current={i === idx % count}
                  className={`h-1.5 rounded-full transition-all ${i === idx % count ? "w-5 bg-white" : "w-1.5 bg-white/50"}`}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* The featured selection as a browsable list */}
      {showList && (
        <div className="absolute inset-0 z-50 flex items-end" dir="rtl" {...listSheet}>
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowList(false)} />
          <div
            className="relative w-full bg-card rounded-t-3xl p-6 max-h-[70vh] overflow-y-auto"
            style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))" }}
          >
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">⭐ مميز هذا الأسبوع</h3>
              <button onClick={() => setShowList(false)} aria-label="إغلاق">
                <X size={20} className="text-muted-foreground" />
              </button>
            </div>
            <div className="flex flex-col gap-3">
              {places.map(p => (
                <div
                  key={p.id}
                  className="flex items-center gap-3 p-3 bg-background border border-border rounded-2xl cursor-pointer hover:border-accent/30 transition-colors"
                  {...tappable(() => openPlace(p.id), p.name)}
                >
                  <img
                    src={sizedImage(p.image, IMG.thumb)}
                    alt={p.name}
                    className="w-16 h-16 rounded-xl object-cover flex-shrink-0"
                    loading="lazy"
                    decoding="async"
                    onError={e => { const t = e.currentTarget; const o = originalImage(t.src); if (t.src !== o) { t.src = o; } else if (t.src !== PLACE_IMAGE_FALLBACK) { t.src = PLACE_IMAGE_FALLBACK; } }}
                  />
                  <div className="flex-1 min-w-0">
                    <h4 className="text-sm font-semibold text-foreground truncate">{p.name}</h4>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {p.district} · ★ {displayRating(p).rating}
                    </p>
                  </div>
                  <button
                    onClick={e => { e.stopPropagation(); onSave(p.id); }}
                    aria-label={`حفظ ${p.name}`}
                    className="w-9 h-9 rounded-full bg-muted flex items-center justify-center flex-shrink-0"
                  >
                    <Bookmark size={15} className={savedPlaces.has(p.id) ? "fill-accent text-accent" : "text-foreground"} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </motion.div>
  );
}
