import { useEffect, useState } from "react";
import { ArrowRight, Wallet, TrendingUp, ShoppingBag, Clock } from "lucide-react";
import {
  CREATOR_SHARE, getCreatorSales, getMyPayouts, requestPayout,
  type CreatorSale, type PayoutRequest,
} from "../lib/creator";

type Props = { userId: string; onBack: () => void };

const PAYOUT_STATUS: Record<PayoutRequest["status"], { label: string; cls: string }> = {
  pending: { label: "قيد المعالجة", cls: "bg-warning-soft text-warning" },
  paid:    { label: "تم التحويل ✓", cls: "bg-success-soft text-success" },
  rejected:{ label: "مرفوض", cls: "bg-danger-soft text-danger" },
};

function timeAgo(iso: string): string {
  const mins = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 60) return `منذ ${Math.max(1, mins)} دقيقة`;
  if (mins < 60 * 24) return `منذ ${Math.floor(mins / 60)} ساعة`;
  return `منذ ${Math.floor(mins / (60 * 24))} يوم`;
}

export function CreatorDashboard({ userId, onBack }: Props) {
  const [sales, setSales] = useState<CreatorSale[]>([]);
  const [payouts, setPayouts] = useState<PayoutRequest[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [payoutMsg, setPayoutMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = () => {
    getCreatorSales(userId).then(setSales).catch(console.error);
    getMyPayouts(userId).then(setPayouts).catch(console.error);
  };
  useEffect(load, [userId]);

  const gross = sales.reduce((s, x) => s + x.amount, 0);
  const net = Math.round(gross * CREATOR_SHARE * 100) / 100;
  const requested = payouts.filter(p => p.status !== "rejected").reduce((s, p) => s + p.amount, 0);
  const available = Math.max(0, Math.round((net - requested) * 100) / 100);

  // Per-list breakdown
  const byList = new Map<string, { title: string; count: number; total: number }>();
  for (const s of sales) {
    const entry = byList.get(s.listId) ?? { title: s.listTitle, count: 0, total: 0 };
    entry.count += 1;
    entry.total += s.amount;
    byList.set(s.listId, entry);
  }

  const handleRequestPayout = () => {
    if (available <= 0) return;
    setRequesting(true);
    setPayoutMsg(null);
    requestPayout(userId, available)
      .then(() => {
        setPayoutMsg({ ok: true, text: "تم إرسال طلب السحب — سيتم التحويل خلال أيام العمل" });
        load();
      })
      .catch(e => { console.error(e); setPayoutMsg({ ok: false, text: "تعذر إرسال الطلب — حاول مرة أخرى" }); })
      .finally(() => setRequesting(false));
  };

  const stats = [
    { label: "عدد المبيعات", value: sales.length.toLocaleString("en-US"), icon: <ShoppingBag size={16} className="text-accent" /> },
    { label: "إجمالي الإيرادات", value: `${gross.toLocaleString("en-US")} ر.س`, icon: <TrendingUp size={16} className="text-accent" /> },
    { label: "صافي أرباحك (٨٠٪)", value: `${net.toLocaleString("en-US")} ر.س`, icon: <Wallet size={16} className="text-accent" /> },
    { label: "قيد السحب/محوَّل", value: `${requested.toLocaleString("en-US")} ر.س`, icon: <Clock size={16} className="text-accent" /> },
  ];

  return (
    <div className="flex-1 overflow-y-auto pb-24" dir="rtl">
      <div className="sticky top-0 z-20 bg-background/95 backdrop-blur-sm px-5 pt-14 pb-4">
        <div className="flex items-center gap-3">
          <button onClick={onBack} aria-label="رجوع" className="w-9 h-9 rounded-full bg-card border border-border flex items-center justify-center">
            <ArrowRight size={18} className="text-foreground" />
          </button>
          <div>
            <h1 className="text-lg font-bold text-foreground">لوحتي</h1>
            <p className="text-xs text-muted-foreground">مبيعات قوائمك وأرباحك</p>
          </div>
        </div>
      </div>

      <div className="px-5">
        {/* Stats */}
        <div className="grid grid-cols-2 gap-3 mb-5">
          {stats.map(s => (
            <div key={s.label} className="bg-card border border-border rounded-2xl p-4">
              <div className="flex items-center gap-2 mb-1">{s.icon}<span className="text-xs text-muted-foreground">{s.label}</span></div>
              <p className="text-lg font-bold text-foreground">{s.value}</p>
            </div>
          ))}
        </div>

        {/* Balance + payout request */}
        <div className="bg-primary text-primary-foreground rounded-3xl p-5 mb-6">
          <p className="text-xs opacity-80 mb-1">الرصيد المتاح للسحب</p>
          <p className="text-3xl font-bold mb-4">{available.toLocaleString("en-US")} <span className="text-base font-medium">ر.س</span></p>
          {payoutMsg && (
            <p className={`text-xs mb-3 ${payoutMsg.ok ? "text-green-300" : "text-red-300"}`}>{payoutMsg.text}</p>
          )}
          <button
            onClick={handleRequestPayout}
            disabled={available <= 0 || requesting}
            className="w-full py-3 rounded-2xl bg-white/15 border border-white/25 text-sm font-bold disabled:opacity-40 active:scale-[0.98] transition-transform"
          >
            {requesting ? "جارٍ الإرسال..." : "طلب سحب الرصيد 💸"}
          </button>
        </div>

        {/* Per-list breakdown */}
        <h2 className="text-sm font-bold text-foreground mb-3">مبيعات القوائم</h2>
        {byList.size === 0 ? (
          <div className="text-center py-8 bg-card border border-border rounded-2xl mb-6">
            <p className="text-3xl mb-2">📈</p>
            <p className="text-sm text-muted-foreground">لا مبيعات بعد — أنشئ قائمة مدفوعة وشاركها</p>
          </div>
        ) : (
          <div className="flex flex-col gap-2 mb-6">
            {[...byList.values()].map(l => (
              <div key={l.title} className="flex items-center justify-between bg-card border border-border rounded-2xl px-4 py-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">{l.title}</p>
                  <p className="text-xs text-muted-foreground">{l.count.toLocaleString("en-US")} عملية شراء</p>
                </div>
                <span className="text-sm font-bold text-accent">{l.total.toLocaleString("en-US")} ر.س</span>
              </div>
            ))}
          </div>
        )}

        {/* Recent sales */}
        {sales.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-foreground mb-3">آخر المبيعات</h2>
            <div className="flex flex-col gap-2 mb-6">
              {sales.slice(0, 10).map(s => (
                <div key={s.id} className="flex items-center justify-between bg-card border border-border rounded-2xl px-4 py-3">
                  <div>
                    <p className="text-sm text-foreground">{s.buyerName} <span className="text-muted-foreground">اشترى</span> {s.listTitle}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(s.purchasedAt)}</p>
                  </div>
                  <span className="text-sm font-bold text-foreground">{s.amount.toLocaleString("en-US")} ر.س</span>
                </div>
              ))}
            </div>
          </>
        )}

        {/* Payout history */}
        {payouts.length > 0 && (
          <>
            <h2 className="text-sm font-bold text-foreground mb-3">طلبات السحب</h2>
            <div className="flex flex-col gap-2">
              {payouts.map(p => (
                <div key={p.id} className="flex items-center justify-between bg-card border border-border rounded-2xl px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-foreground">{p.amount.toLocaleString("en-US")} ر.س</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{timeAgo(p.createdAt)}</p>
                  </div>
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${PAYOUT_STATUS[p.status].cls}`}>
                    {PAYOUT_STATUS[p.status].label}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
