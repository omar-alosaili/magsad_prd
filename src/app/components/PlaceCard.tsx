import { Bookmark, Star, MapPin, Wifi, Users, Baby, Trees } from "lucide-react";
import { Place, displayRating, isRecentlyAdded } from "./data";
import { tappable } from "../lib/a11y";
import { sizedImage, IMG } from "../lib/types";

type Props = {
  place: Place;
  onSave?: (id: string) => void;
  saved?: boolean;
  onClick?: () => void;
  compact?: boolean;
};

const priceMap = { 1: "＄", 2: "＄＄", 3: "＄＄＄" };

export function PlaceCard({ place, onSave, saved, onClick, compact }: Props) {
  const { rating, count } = displayRating(place);
  if (compact) {
    return (
      <div
        className="flex gap-3 p-3 bg-card rounded-2xl border border-border cursor-pointer hover:shadow-md transition-shadow"
        {...(onClick ? tappable(onClick, place.name) : {})}
        dir="rtl"
      >
        <img
          src={sizedImage(place.image, IMG.thumb)}
          alt={place.name}
          className="w-20 h-20 rounded-xl object-cover flex-shrink-0"
          loading="lazy"
          decoding="async"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-foreground truncate">{place.name}</h3>
              <p className="text-xs text-muted-foreground mt-0.5">{place.type} · {place.district}</p>
            </div>
            <button
              onClick={(e) => { e.stopPropagation(); onSave?.(place.id); }}
              aria-label={saved ? "إزالة من المحفوظات" : "حفظ المكان"}
              aria-pressed={saved}
              className="flex-shrink-0 p-1.5 rounded-lg hover:bg-muted transition-colors"
            >
              <Bookmark
                size={16}
                className={saved ? "fill-accent text-accent" : "text-muted-foreground"}
              />
            </button>
          </div>
          <div className="flex items-center gap-2 mt-2">
            <div className="flex items-center gap-1">
              <Star size={12} className="fill-rating text-rating" />
              <span className="text-xs text-foreground">{rating}</span>
            </div>
            <span className="text-xs text-muted-foreground">{priceMap[place.priceLevel]}</span>
            <span
              className={`text-xs px-1.5 py-0.5 rounded-full ${
                place.isOpen ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
              }`}
            >
              {place.isOpen ? "مفتوح" : "مغلق"}
            </span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="bg-card rounded-3xl overflow-hidden border border-border cursor-pointer hover:shadow-lg transition-all group"
      {...(onClick ? tappable(onClick, place.name) : {})}
      dir="rtl"
    >
      <div className="relative">
        <img
          src={sizedImage(place.image, IMG.card)}
          alt={place.name}
          className="w-full h-52 object-cover group-hover:scale-105 transition-transform duration-500"
          loading="lazy"
          decoding="async"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent" />

        <div className="absolute top-3 right-3 flex gap-2">
          {isRecentlyAdded(place) && (
            <span className="bg-accent text-white text-xs px-2.5 py-1 rounded-full font-medium">
              جديد
            </span>
          )}
          {place.isVerified && (
            <span className="bg-primary text-primary-foreground text-xs px-2.5 py-1 rounded-full font-medium">
              ✓ موثق
            </span>
          )}
        </div>

        <button
          onClick={(e) => { e.stopPropagation(); onSave?.(place.id); }}
          aria-label={saved ? "إزالة من المحفوظات" : "حفظ المكان"}
          aria-pressed={saved}
          className="absolute top-3 left-3 w-10 h-10 rounded-full bg-white/90 backdrop-blur-sm flex items-center justify-center shadow-sm hover:bg-white transition-colors"
        >
          <Bookmark
            size={16}
            className={saved ? "fill-accent text-accent" : "text-foreground"}
          />
        </button>

        <div className="absolute bottom-3 right-3 left-3">
          <h3 className="text-white font-semibold text-base leading-tight">{place.name}</h3>
          <div className="flex items-center gap-1 mt-1">
            <MapPin size={11} className="text-white/80" />
            <span className="text-white/80 text-xs">{place.district}</span>
          </div>
        </div>
      </div>

      <div className="p-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1">
              <Star size={13} className="fill-rating text-rating" />
              <span className="text-sm font-semibold">{rating}</span>
              <span className="text-xs text-muted-foreground">({count})</span>
            </div>
            <span className="text-sm text-muted-foreground">{priceMap[place.priceLevel]}</span>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-medium ${
              place.isOpen ? "bg-success-soft text-success" : "bg-danger-soft text-danger"
            }`}
          >
            {place.isOpen ? "مفتوح الآن" : "مغلق"}
          </span>
        </div>

        <div className="flex items-center gap-2 mt-3 flex-wrap">
          {place.isWorkFriendly && (
            <span className="flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-1 rounded-lg">
              <Wifi size={10} /> للعمل
            </span>
          )}
          {place.isFamilyFriendly && (
            <span className="flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-1 rounded-lg">
              <Users size={10} /> عائلي
            </span>
          )}
          {place.isKidsFriendly && (
            <span className="flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-1 rounded-lg">
              <Baby size={10} /> أطفال
            </span>
          )}
          {place.hasOutdoorSeating && (
            <span className="flex items-center gap-1 text-xs bg-muted text-muted-foreground px-2 py-1 rounded-lg">
              <Trees size={10} /> خارجي
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
