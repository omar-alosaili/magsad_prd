import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { ArrowRight, Check } from "lucide-react";
import { supabase } from "../lib/supabase";
import { Button } from "./Button";
import { UsernameGate } from "./UsernameGate";
import { PLACE_IMAGE_FALLBACK } from "../lib/types";

// Round a real count down to a friendly "+" figure (e.g. 3213 -> "3,200+").
function friendlyCount(n: number): string {
  const rounded = n >= 1000 ? Math.floor(n / 100) * 100 : n >= 100 ? Math.floor(n / 10) * 10 : n;
  const formatted = rounded.toLocaleString("en-US");
  return n >= 100 ? `${formatted}+` : formatted;
}

type Props = { onComplete: () => void };
type View = "splash" | "login" | "register" | "otp" | "username" | "interests";

const BG_AUTH   = "https://images.unsplash.com/photo-1647532794514-3ee915a1ab11?w=900&h=1200&fit=crop&auto=format";
const BG_COFFEE = "https://images.unsplash.com/photo-1617995815236-7f06f6e53180?w=900&h=500&fit=crop&auto=format";

const INTERESTS = [
  { id: "coffee",    emoji: "☕", label: "قهوة مختصة",   img: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=300&h=200&fit=crop" },
  { id: "family",    emoji: "👨‍👩‍👧",  label: "عائلي",         img: "https://images.unsplash.com/photo-1414235077428-338989a2e8c0?w=300&h=200&fit=crop" },
  { id: "work",      emoji: "💻", label: "للعمل",         img: "https://images.unsplash.com/photo-1501339847302-ac426a4a7cbb?w=300&h=200&fit=crop" },
  { id: "breakfast", emoji: "🍳", label: "فطور",          img: "https://images.unsplash.com/photo-1533089860892-a7c6f0a88666?w=300&h=200&fit=crop" },
  { id: "outdoor",   emoji: "🌿", label: "جلسات خارجية",  img: "https://images.unsplash.com/photo-1521017432531-fbd92d768814?w=300&h=200&fit=crop" },
  { id: "new",       emoji: "✨", label: "أماكن جديدة",   img: "https://images.unsplash.com/photo-1509042239860-f550ce710b93?w=300&h=200&fit=crop" },
  { id: "quiet",     emoji: "🧘", label: "هادئ",          img: "https://images.unsplash.com/photo-1554118811-1e0d58224f24?w=300&h=200&fit=crop" },
  { id: "kids",      emoji: "👶", label: "للأطفال",       img: "https://images.unsplash.com/photo-1466978913421-dad2ebd01d17?w=300&h=200&fit=crop" },
];

const slideUp = {
  initial: { opacity: 0, y: 32 },
  animate: { opacity: 1, y: 0 },
  exit:    { opacity: 0, y: -16 },
  transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] },
};

/* Saudi mobile numbers: 9 digits starting with 5 (e.g. 5XXXXXXXX) */
const isValidSaudiPhone = (phone: string) => /^5\d{8}$/.test(phone);

/* Map raw Supabase auth errors to user-friendly Arabic messages */
const translateAuthError = (message: string): string => {
  const m = message.toLowerCase();
  if (m.includes("signups not allowed")) return "لا يوجد حساب بهذا الرقم — أنشئ حساباً جديداً أولاً";
  if (m.includes("provider")) return "تسجيل الدخول عبر الجوال غير متاح حالياً، جرّب لاحقاً";
  if (m.includes("invalid phone")) return "رقم الجوال غير صحيح";
  if (m.includes("rate limit") || m.includes("too many")) return "محاولات كثيرة، انتظر قليلاً ثم أعد المحاولة";
  if (m.includes("expired") || m.includes("token")) return "الرمز غير صحيح أو منتهي الصلاحية";
  if (m.includes("network") || m.includes("fetch")) return "تعذر الاتصال، تحقق من الإنترنت";
  return "حدث خطأ غير متوقع، حاول مرة أخرى";
};

/* Magsad logo icon — the "م" pin mark */
function AppIcon({ size = 80 }: { size?: number }) {
  return (
    <div
      style={{
        width: size, height: size,
        borderRadius: size * 0.26,
        background: "rgba(255,255,255,0.12)",
        border: "1px solid rgba(255,255,255,0.18)",
        display: "flex", alignItems: "center", justifyContent: "center",
        backdropFilter: "blur(8px)",
      }}
    >
      {/* location pin icon */}
      <svg width={size * 0.54} height={size * 0.62} viewBox="0 0 48 56" fill="none">
        {/* outer white circle */}
        <circle cx="24" cy="20" r="13" fill="white" fillOpacity="0.96" />
        {/* inner amber dot */}
        <circle cx="24" cy="20" r="6.5" fill="#C47B2B" />
        {/* pin stem */}
        <path d="M24 33 L24 50" stroke="white" strokeWidth="3.5" strokeLinecap="round" strokeOpacity="0.88" />
        {/* shadow base */}
        <ellipse cx="24" cy="52" rx="6" ry="1.5" fill="white" fillOpacity="0.25" />
      </svg>
    </div>
  );
}

export function OnboardingScreen({ onComplete }: Props) {
  const [view, setView]           = useState<View>("splash");
  const [isLogin, setIsLogin]     = useState(true);
  const [phone, setPhone]         = useState("");
  const [name, setName]           = useState("");
  const [otp, setOtp]             = useState(["","","","","",""]);
  const [interests, setInterests] = useState<Set<string>>(new Set());
  // Real catalogue stats for the splash — no hard-coded vanity numbers.
  const [stats, setStats] = useState<{ places: number; lists: number } | null>(null);

  useEffect(() => {
    let alive = true;
    Promise.all([
      supabase.from("places").select("id", { count: "exact", head: true }),
      supabase.from("lists").select("id", { count: "exact", head: true }).eq("is_public", true),
    ]).then(([p, l]) => {
      if (alive && p.count != null) setStats({ places: p.count, lists: l.count ?? 0 });
    }).catch(() => {/* leave stats null → the row simply doesn't render */});
    return () => { alive = false; };
  }, []);
  const [error, setError]         = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const toggleInterest = (id: string) =>
    setInterests(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const handleOtp = (val: string, i: number) => {
    // Accept a pasted / autofilled full code and spread it across the boxes.
    const digits = val.replace(/\D/g, "");
    if (digits.length > 1) {
      const next = [...otp];
      for (let k = 0; k < 6; k++) next[k] = digits[k] ?? "";
      setOtp(next);
      document.getElementById(`otp-${Math.min(digits.length, 6) - 1}`)?.focus();
      return;
    }
    const next = [...otp]; next[i] = digits; setOtp(next);
    if (digits && i < 5) document.getElementById(`otp-${i + 1}`)?.focus();
  };

  // Backspace on an empty box jumps to the previous one.
  const handleOtpKey = (e: React.KeyboardEvent<HTMLInputElement>, i: number) => {
    if (e.key === "Backspace" && !otp[i] && i > 0) {
      document.getElementById(`otp-${i - 1}`)?.focus();
    }
  };

  const sendOtp = async () => {
    setError(null);
    if (!isValidSaudiPhone(phone)) { setError("أدخل رقم جوال صحيح يبدأ بـ 5 (٩ أرقام)"); return; }
    if (!isLogin && !name.trim()) { setError("أدخل اسمك أولاً"); return; }
    setSubmitting(true);
    const { error } = await supabase.auth.signInWithOtp({
      phone: `+966${phone}`,
      // Login must NOT auto-create ghost accounts: an unknown phone on the
      // login path used to silently sign up with an empty name. Register
      // is the only path that creates accounts (with the name attached).
      options: isLogin ? { shouldCreateUser: false } : { data: { name: name.trim() } },
    });
    setSubmitting(false);
    if (error) { setError(translateAuthError(error.message)); return; }
    setView("otp");
  };

  const confirmOtp = async () => {
    setError(null);
    setSubmitting(true);
    const { error } = await supabase.auth.verifyOtp({ phone: `+966${phone}`, token: otp.join(""), type: "sms" });
    setSubmitting(false);
    if (error) { setError(translateAuthError(error.message)); return; }
    // New registrations pick their username next; returning users who
    // predate mandatory usernames are gated in App instead.
    isLogin ? onComplete() : setView("username");
  };

  const finishInterests = async () => {
    const { data: { user } } = await supabase.auth.getUser();
    if (user && interests.size > 0) {
      await supabase.from("user_interests").upsert(
        Array.from(interests).map(interest_id => ({ user_id: user.id, interest_id }))
      );
    }
    onComplete();
  };

  /* ────────── SPLASH ────────── */
  if (view === "splash") {
    return (
      <div className="h-full flex flex-col relative overflow-hidden" dir="rtl">

        {/* background photo — Riyadh cafe outdoor tables at night */}
        <img
          src="https://images.unsplash.com/photo-1726873800099-53f5496281e0?w=900&h=1600&fit=crop&auto=format"
          alt="مقاهي الرياض"
          className="absolute inset-0 w-full h-full object-cover"
          onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }}
        />

        {/* multi-layer dark overlay: top subtle, bottom strong to keep content readable */}
        <div
          className="absolute inset-0"
          style={{
            background:
              "linear-gradient(to bottom, rgba(20,8,3,0.45) 0%, rgba(20,8,3,0.25) 30%, rgba(20,8,3,0.6) 58%, rgba(20,8,3,0.93) 78%, rgba(20,8,3,0.98) 100%)",
          }}
        />

        {/* warm amber tint to reinforce brand color */}
        <div
          className="absolute inset-0"
          style={{ background: "rgba(100,40,5,0.28)", mixBlendMode: "multiply" }}
        />

        {/* center content: icon + title */}
        <div className="relative flex-1 flex flex-col items-center justify-center px-8 text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.55, ease: [0.22, 1, 0.36, 1] }}
            className="mb-5"
          >
            <AppIcon size={88} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.15, duration: 0.5 }}
          >
            <h1
              className="text-white mb-1"
              style={{ fontSize: 38, fontWeight: 800, fontFamily: "'Noto Kufi Arabic'", letterSpacing: "-0.5px" }}
            >
              مقصد
            </h1>
            <p className="mb-5" style={{ color: "rgba(255,255,255,0.45)", fontSize: 14 }}>Magsad</p>
            {/* Tagline: staggered word-by-word entrance, accent separators */}
            <p className="text-white font-bold mb-3 whitespace-nowrap" dir="rtl" style={{ fontSize: 20 }}>
              {["اكتشف", "احفظ", "اقصد"].map((word, i) => (
                <motion.span
                  key={word}
                  className="inline-block"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.35 + i * 0.2, duration: 0.45 }}
                >
                  {word}
                  {i < 2 && <span className="mx-2.5" style={{ color: "var(--accent)" }}>·</span>}
                </motion.span>
              ))}
            </p>
            <p className="text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)", maxWidth: 260, margin: "0 auto" }}>
              منصتك المحلية لاكتشاف أفضل الكافيهات والمطاعم في الرياض
            </p>
          </motion.div>
        </div>

        {/* stats — real catalogue figures, only shown once loaded */}
        {stats && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.5 }}
            className="relative flex justify-around px-12 mb-10"
          >
            {[
              { value: friendlyCount(stats.places), label: "مكان" },
              { value: friendlyCount(stats.lists), label: "قائمة" },
            ].map(s => (
              <div key={s.label} className="text-center">
                <p className="text-white font-bold" style={{ fontSize: 22 }}>{s.value}</p>
                <p className="text-xs mt-0.5" style={{ color: "rgba(255,255,255,0.55)" }}>{s.label}</p>
              </div>
            ))}
          </motion.div>
        )}

        {/* buttons */}
        <motion.div
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.4, duration: 0.5 }}
          className="relative px-6 pb-12 flex flex-col gap-3"
        >
          <button
            onClick={() => { setIsLogin(false); setView("register"); }}
            className="w-full py-4 rounded-2xl font-bold text-base active:scale-[0.98] transition-transform"
            style={{ background: "#FFFFFF", color: "#2C1810" }}
          >
            إنشاء حساب جديد
          </button>
          <button
            onClick={() => { setIsLogin(true); setView("login"); }}
            className="w-full py-4 rounded-2xl font-semibold text-base active:scale-[0.98] transition-transform"
            style={{
              background: "rgba(255,255,255,0.12)",
              border: "1px solid rgba(255,255,255,0.25)",
              color: "#FFFFFF",
            }}
          >
            تسجيل الدخول
          </button>
          <button
            onClick={onComplete}
            className="text-sm text-center pt-1 transition-colors"
            style={{ color: "rgba(255,255,255,0.4)" }}
          >
            تصفح بدون تسجيل
          </button>
        </motion.div>
      </div>
    );
  }

  /* ────────── LOGIN / REGISTER (phone only) ────────── */
  if (view === "login" || view === "register") {
    return (
      <div className="h-full flex flex-col overflow-hidden bg-background">
        {/* top image */}
        <div className="relative flex-shrink-0" style={{ height: "36%" }}>
          <img src={BG_AUTH} alt="" className="w-full h-full object-cover" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
          <div
            className="absolute inset-0"
            style={{ background: "linear-gradient(to bottom, rgba(44,24,16,0.45) 0%, rgba(44,24,16,0.1) 50%, var(--background) 100%)" }}
          />
          <button
            onClick={() => setView("splash")}
            className="absolute top-14 right-5 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
          >
            <ArrowRight size={18} className="text-white" />
          </button>
          <div className="absolute bottom-5 right-5" dir="rtl">
            <p className="text-white font-extrabold" style={{ fontSize: 24, fontFamily: "'Noto Kufi Arabic'" }}>
              {isLogin ? "أهلاً بعودتك" : "انضم لمقصد"}
            </p>
            <p className="text-white/55 text-sm mt-0.5">
              {isLogin ? "سجل الدخول لتتابع مقصدك" : "اكتشف الرياض معنا"}
            </p>
          </div>
        </div>

        {/* form */}
        <div className="flex-1 overflow-y-auto px-5 pt-5 pb-8" dir="rtl">
          <AnimatePresence mode="wait">
            <motion.div key={view} {...slideUp} className="flex flex-col gap-4">
              {!isLogin && (
                <div>
                  <label className="text-xs text-muted-foreground block mb-1.5">الاسم</label>
                  <input
                    value={name} onChange={e => setName(e.target.value)}
                    placeholder="اسمك الكريم"
                    className="w-full bg-input-background border border-border rounded-2xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-all"
                  />
                </div>
              )}

              <div>
                <label className="text-xs text-muted-foreground block mb-1.5">رقم الجوال</label>
                {/* Phone row is LTR: country code on the left, then the number */}
                <div className="flex gap-2" dir="ltr">
                  {/* dir=ltr: in the RTL layout the bidi algorithm renders "+966" as "966+" */}
                  <div dir="ltr" className="flex items-center gap-1.5 px-3 py-3.5 bg-input-background border border-border rounded-2xl text-sm font-medium flex-shrink-0 text-foreground">
                    🇸🇦 <span className="text-muted-foreground">+966</span>
                  </div>
                  <input
                    type="tel" inputMode="numeric" value={phone}
                    onChange={e => setPhone(e.target.value.replace(/\D/g, "").replace(/^0+/, "").slice(0, 9))}
                    placeholder="5XXXXXXXX" style={{ direction: "ltr" }}
                    className="flex-1 bg-input-background border border-border rounded-2xl px-4 py-3.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-accent/30 focus:border-accent/60 transition-all"
                  />
                </div>
              </div>

              {error && (
                <p className="text-xs text-center text-destructive -mb-1">{error}</p>
              )}

              <Button
                fullWidth
                onClick={sendOtp}
                loading={submitting}
                disabled={submitting || !isValidSaudiPhone(phone) || (!isLogin && !name.trim())}
                className="mt-1"
              >
                إرسال رمز التحقق
              </Button>

              <p className="text-center text-sm text-muted-foreground pb-2">
                {isLogin ? "ما عندك حساب؟ " : "عندك حساب؟ "}
                <button onClick={() => setIsLogin(!isLogin)} className="text-accent font-bold">
                  {isLogin ? "أنشئ حساباً" : "سجل الدخول"}
                </button>
              </p>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    );
  }

  /* ────────── OTP ────────── */
  if (view === "otp") {
    return (
      <div className="h-full flex flex-col bg-background overflow-hidden" dir="rtl">
        <div className="relative flex-shrink-0" style={{ height: "26%" }}>
          <img src={BG_COFFEE} alt="" className="w-full h-full object-cover" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
          <div className="absolute inset-0" style={{ background: "linear-gradient(to bottom, rgba(44,24,16,0.55) 0%, var(--background) 100%)" }} />
          <button
            onClick={() => setView(isLogin ? "login" : "register")}
            className="absolute top-14 right-5 w-9 h-9 rounded-full bg-black/30 backdrop-blur-sm flex items-center justify-center border border-white/20"
          >
            <ArrowRight size={18} className="text-white" />
          </button>
        </div>

        <div className="flex-1 px-6 pt-6">
          <motion.div {...slideUp}>
            <h1 className="text-2xl font-bold text-foreground mb-1">تحقق من جوالك</h1>
            <p className="text-sm text-muted-foreground mb-8">
              أرسلنا رمز تحقق لـ <span className="text-foreground font-semibold">{phone || "رقمك"}</span>
            </p>

            <div className="flex gap-2 justify-center mb-5" style={{ direction: "ltr" }}>
              {otp.map((d, i) => (
                <input
                  key={i} id={`otp-${i}`} type="tel" inputMode="numeric"
                  autoComplete={i === 0 ? "one-time-code" : "off"}
                  aria-label={`الرقم ${(i + 1).toLocaleString("en-US")} من رمز التحقق`}
                  autoFocus={i === 0} maxLength={6} value={d}
                  onChange={e => handleOtp(e.target.value, i)}
                  onKeyDown={e => handleOtpKey(e, i)}
                  className="w-12 h-14 text-center text-xl font-bold rounded-2xl border-2 bg-card text-foreground focus-visible:ring-2 focus-visible:ring-accent focus:outline-none transition-all"
                  style={{ borderColor: d ? "var(--accent)" : "var(--border)" }}
                />
              ))}
            </div>

            {error && (
              <p className="text-xs text-center text-destructive mb-4">{error}</p>
            )}

            <p className="text-center text-sm text-muted-foreground mb-8">
              لم تستلم الرمز؟{" "}
              <button onClick={sendOtp} className="text-accent font-bold">إعادة الإرسال</button>
            </p>

            <Button
              fullWidth
              onClick={confirmOtp}
              loading={submitting}
              disabled={otp.some(d => !d) || submitting}
            >
              تأكيد الرمز
            </Button>
          </motion.div>
        </div>
      </div>
    );
  }

  /* ────────── INTERESTS ────────── */
  if (view === "username") {
    return <UsernameGate withProgress onDone={() => setView("interests")} />;
  }

  if (view === "interests") {
    return (
      <div className="h-full flex flex-col bg-background overflow-hidden" dir="rtl">
        <div className="px-5 pt-14 pb-4 flex-shrink-0">
          <motion.div {...slideUp}>
            <div className="flex items-center gap-1.5 mb-5">
              {[0,1,2,3,4].map(i => (
                <div key={i} className="flex-1 h-1 rounded-full" style={{ background: i === 4 ? "var(--accent)" : "var(--muted)" }} />
              ))}
            </div>
            <h1 className="text-2xl font-bold text-foreground mb-1">ما اللي يهمك؟</h1>
            <p className="text-sm text-muted-foreground">اختر ما يناسبك ونرشح لك الأماكن</p>
          </motion.div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-2">
          <div className="grid grid-cols-2 gap-3">
            {INTERESTS.map((item, i) => {
              const selected = interests.has(item.id);
              return (
                <motion.button
                  key={item.id}
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ delay: i * 0.045 }}
                  onClick={() => toggleInterest(item.id)}
                  className="relative rounded-2xl overflow-hidden text-right"
                  style={{ height: 108 }}
                >
                  <img src={item.img} alt={item.label} className="absolute inset-0 w-full h-full object-cover" onError={e => { const t = e.currentTarget; if (t.src !== PLACE_IMAGE_FALLBACK) t.src = PLACE_IMAGE_FALLBACK; }} />
                  <div
                    className="absolute inset-0 transition-all duration-200"
                    style={{
                      background: selected
                        ? "rgba(196,123,43,0.68)"
                        : "linear-gradient(to top, rgba(10,4,2,0.78) 0%, rgba(10,4,2,0.18) 100%)",
                    }}
                  />
                  {selected && (
                    <div className="absolute top-2.5 left-2.5 w-6 h-6 rounded-full bg-white flex items-center justify-center shadow-sm">
                      <Check size={13} className="text-accent" strokeWidth={3} />
                    </div>
                  )}
                  <div className="absolute bottom-3 right-3">
                    <span className="text-lg leading-none">{item.emoji}</span>
                    <p className="text-white text-xs font-bold leading-tight mt-0.5">{item.label}</p>
                  </div>
                  {selected && (
                    <div className="absolute inset-0 rounded-2xl border-2" style={{ borderColor: "var(--accent)" }} />
                  )}
                </motion.button>
              );
            })}
          </div>
        </div>

        <div className="px-5 pb-8 pt-4 flex-shrink-0">
          <motion.button
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.38 }}
            onClick={finishInterests}
            className="w-full py-4 rounded-2xl font-bold text-base active:scale-[0.98] transition-transform"
            style={{ background: "var(--primary)", color: "var(--primary-foreground)" }}
          >
            {interests.size > 0 ? `ابدأ مع ${interests.size} اهتمام ←` : "تخطي"}
          </motion.button>
        </div>
      </div>
    );
  }

  return null;
}
