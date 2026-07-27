import { useEffect, useState } from "react";
import { tappable } from "../lib/a11y";
import { motion, AnimatePresence } from "motion/react";
import { X, Bell, Bookmark, Heart, Shield, Tag } from "lucide-react";
import { getNotifications, markAllRead, markRead } from "../lib/notifications";
import { toast } from "../lib/toast";
import { PLACE_IMAGE_FALLBACK, type Notification, type NotificationType } from "../lib/types";

type Props = {
  open: boolean;
  onClose: () => void;
  userId: string | null;
  onPlaceClick?: (id: string) => void;
};

const ICON_BG: Record<NotificationType, { icon: JSX.Element; bg: string }> = {
  offer: { icon: <Tag size={16} className="text-accent" />, bg: "bg-accent/10" },
  follow: { icon: <Heart size={16} className="text-red-500" />, bg: "bg-red-50" },
  save: { icon: <Bookmark size={16} className="text-primary" />, bg: "bg-primary/8" },
  verify: { icon: <Shield size={16} className="text-success" />, bg: "bg-green-50" },
  new: { icon: <Bell size={16} className="text-warning" />, bg: "bg-amber-50" },
};

export function NotificationsPanel({ open, onClose, userId, onPlaceClick }: Props) {
  const [notifications, setNotifications] = useState<Notification[]>([]);

  useEffect(() => {
    if (open && userId) getNotifications(userId).then(setNotifications).catch(console.error);
  }, [open, userId]);

  const handleMarkAllRead = () => {
    if (!userId) return;
    const prevNotifications = notifications;
    setNotifications(prev => prev.map(n => ({ ...n, unread: false })));
    markAllRead(userId)
      .then(() => toast.success("تم تعليم كل الإشعارات كمقروءة"))
      .catch(() => {
        setNotifications(prevNotifications);
        toast.error("تعذّر تعليم الإشعارات كمقروءة — حاول مجدداً");
      });
  };

  const handleClickNotification = (notif: Notification) => {
    if (notif.unread) {
      setNotifications(prev => prev.map(n => (n.id === notif.id ? { ...n, unread: false } : n)));
      markRead(notif.id).catch(() => {
        setNotifications(prev => prev.map(n => (n.id === notif.id ? { ...n, unread: true } : n)));
        toast.error("تعذّر تعليم الإشعار كمقروء — حاول مجدداً");
      });
    }
    if (notif.relatedPlaceId && onPlaceClick) onPlaceClick(notif.relatedPlaceId);
  };

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/30 backdrop-blur-sm"
            onClick={onClose}
          />
          <motion.div
            initial={{ x: "-100%", opacity: 0 }}
            animate={{ x: 0, opacity: 1 }}
            exit={{ x: "-100%", opacity: 0 }}
            transition={{ type: "spring", damping: 28, stiffness: 280 }}
            className="absolute top-0 right-0 bottom-0 z-50 bg-background shadow-2xl overflow-hidden flex flex-col"
            style={{ width: "90%", maxWidth: 380 }}
            dir="rtl"
          >
            <div className="flex items-center justify-between px-5 pt-14 pb-4 border-b border-border bg-card">
              <div>
                <h2 className="text-base font-bold text-foreground">الإشعارات</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {notifications.filter(n => n.unread).length} جديد
                </p>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={handleMarkAllRead} className="text-xs text-accent font-semibold">تعليم الكل مقروء</button>
                <button
                  onClick={onClose}
                  aria-label="إغلاق الإشعارات"
                  className="w-8 h-8 rounded-full bg-muted flex items-center justify-center"
                >
                  <X size={16} className="text-foreground" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              {notifications.length === 0 ? (
                <div className="text-center py-16 text-muted-foreground text-sm">لا توجد إشعارات</div>
              ) : (
                notifications.map((notif, i) => (
                  <motion.div
                    key={notif.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: i * 0.05 }}
                    {...tappable(() => handleClickNotification(notif), notif.title)}
                    className={`flex items-start gap-3 px-5 py-4 border-b border-border cursor-pointer hover:bg-muted/50 transition-colors relative ${
                      notif.unread ? "bg-accent/3" : ""
                    }`}
                    style={{ backgroundColor: notif.unread ? "rgba(196,123,43,0.03)" : undefined }}
                  >
                    {notif.unread && (
                      <div className="absolute top-4 left-4 w-2 h-2 rounded-full bg-accent" />
                    )}
                    <div className="relative flex-shrink-0">
                      {notif.image && (
                        <img
                          src={notif.image}
                          alt=""
                          className="w-12 h-12 rounded-2xl object-cover"
          onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }}
        />
                      )}
                      <div className={`absolute -bottom-1 -right-1 w-6 h-6 rounded-full ${ICON_BG[notif.type].bg} flex items-center justify-center border-2 border-background`}>
                        {ICON_BG[notif.type].icon}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-foreground leading-snug">{notif.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5 leading-relaxed">{notif.body}</p>
                      <p className="text-xs text-muted-foreground mt-1.5">{notif.time}</p>
                    </div>
                  </motion.div>
                ))
              )}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
