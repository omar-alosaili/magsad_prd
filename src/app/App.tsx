import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session } from "@supabase/supabase-js";
import { motion, AnimatePresence } from "motion/react";
import { Home, Search, List, User, Tag } from "lucide-react";
import { supabase } from "./lib/supabase";
import type { Profile } from "./lib/types";
import { getSavedPlaceIds, toggleSavedPlace } from "./lib/savedPlaces";
import { confirmListPurchase } from "./lib/lists";
import { getProfileByUsername } from "./lib/profile";
import { toast } from "./lib/toast";
import { FEATURES } from "./lib/features";
import { ToastHost } from "./components/ToastHost";
import { OnboardingScreen } from "./components/OnboardingScreen";
import { UsernameGate } from "./components/UsernameGate";
import { HomePage } from "./components/HomePage";

// Everything beyond the first paint (home / onboarding) loads on demand;
// warmTabChunks() prefetches the tab screens right after startup so the
// first tab switch is still instant.
const ExplorePage = lazy(() =>
  import("./components/ExplorePage").then(m => ({ default: m.ExplorePage }))
);
const ListsPage = lazy(() =>
  import("./components/ListsPage").then(m => ({ default: m.ListsPage }))
);
const ProfilePage = lazy(() =>
  import("./components/ProfilePage").then(m => ({ default: m.ProfilePage }))
);
const OffersPage = lazy(() =>
  import("./components/OffersPage").then(m => ({ default: m.OffersPage }))
);
const PlacePage = lazy(() =>
  import("./components/PlacePage").then(m => ({ default: m.PlacePage }))
);

function warmTabChunks() {
  // Fire-and-forget; a failed prefetch just means Suspense fetches later.
  import("./components/ExplorePage").catch(() => {});
  import("./components/ListsPage").catch(() => {});
  import("./components/ProfilePage").catch(() => {});
  import("./components/OffersPage").catch(() => {});
  import("./components/PlacePage").catch(() => {});
}

// Owner/admin/creator screens are rarely reached — split them out of the main bundle
const BusinessDashboard = lazy(() =>
  import("./components/BusinessDashboard").then(m => ({ default: m.BusinessDashboard }))
);
const AdminPanel = lazy(() =>
  import("./components/AdminPanel").then(m => ({ default: m.AdminPanel }))
);
const CreatorDashboard = lazy(() =>
  import("./components/CreatorDashboard").then(m => ({ default: m.CreatorDashboard }))
);
const PublicProfile = lazy(() =>
  import("./components/PublicProfile").then(m => ({ default: m.PublicProfile }))
);

const GUEST_MODE_KEY = "magsad_guest_mode";
const CHUNK_RELOAD_KEY = "magsad_chunk_reload";

// Lazy screens can fail to load — most commonly a mid-session user after a
// redeploy: the old hashed chunk URL falls through the SPA rewrite to
// index.html, the import rejects, and React 18 would unmount the whole
// root (permanent white screen). Catch it here: auto-reload once per
// session to pick up the fresh hashes, else show a retry screen.
class ScreenErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  componentDidCatch(err: unknown) {
    const msg = String((err as Error)?.message ?? err);
    if (/import|chunk|module|fetch/i.test(msg) && !sessionStorage.getItem(CHUNK_RELOAD_KEY)) {
      sessionStorage.setItem(CHUNK_RELOAD_KEY, "1");
      window.location.reload();
    }
  }
  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4 bg-background px-8" dir="rtl">
        <p className="text-sm text-muted-foreground text-center">تعذّر تحميل الصفحة — تأكد من اتصالك بالإنترنت</p>
        <button
          onClick={() => { sessionStorage.removeItem(CHUNK_RELOAD_KEY); window.location.reload(); }}
          className="px-6 py-2.5 rounded-2xl bg-primary text-primary-foreground text-sm font-semibold"
        >
          إعادة المحاولة
        </button>
      </div>
    );
  }
}

// Suspense fallback while a lazy screen's chunk downloads (deep links, taps
// before the warm prefetch lands) — a spinner, never a blank frame.
const screenLoader = (
  <div className="h-full flex items-center justify-center bg-background">
    <div className="w-8 h-8 rounded-full animate-spin" style={{ border: "3px solid var(--muted)", borderTopColor: "var(--accent)" }} />
  </div>
);

type Screen =
  | { type: "home" }
  | { type: "explore" }
  | { type: "lists" }
  | { type: "profile" }
  | { type: "offers" }
  | { type: "place"; id: string }
  | { type: "business" }
  | { type: "admin" }
  | { type: "creator" }
  | { type: "user"; profile: Profile };

type Tab = "home" | "explore" | "lists" | "offers" | "profile";

const FONT = "'Noto Kufi Arabic', 'Noto Sans Arabic', sans-serif";

export default function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined); // undefined = still loading
  const [profile, setProfile] = useState<Profile | null>(null);
  // Explicit onboarding state — NOT derived from the session. During
  // registration the session is created at OTP verification, before the
  // interests step; deriving "onboarded" from it swapped screens mid-flow
  // and wedged the AnimatePresence transition (blank screen).
  const [onboarded, setOnboarded] = useState(() => localStorage.getItem(GUEST_MODE_KEY) === "1");
  const [screen, setScreen] = useState<Screen>({ type: "home" });
  const [activeTab, setActiveTab] = useState<Tab>("home");
  const [savedPlaces, setSavedPlaces] = useState<Set<string>>(new Set());
  const [exploreQuery, setExploreQuery] = useState("");
  // Deep-link intent captured once on load (?p= place, ?list= list).
  // Held until the app is onboarded, then applied.
  const [deepLink, setDeepLink] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("p")) return { kind: "place" as const, id: p.get("p")! };
    if (p.get("list")) return { kind: "list" as const, id: p.get("list")! };
    if (p.get("u")) return { kind: "user" as const, id: p.get("u")! }; // username
    return null;
  });
  const [pendingListId, setPendingListId] = useState<string | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      if (data.session) setOnboarded(true); // returning user skips onboarding
    });
    const { data: sub } = supabase.auth.onAuthStateChange((event, newSession) => {
      setSession(newSession);
      if (event === "SIGNED_OUT") setOnboarded(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // A real session supersedes guest mode
  useEffect(() => {
    if (session?.user) localStorage.removeItem(GUEST_MODE_KEY);
  }, [session?.user?.id]);

  // Prefetch the lazy tab screens once the first paint is done.
  useEffect(() => {
    const t = setTimeout(warmTabChunks, 2500);
    return () => clearTimeout(t);
  }, []);

  // Deep-link: a shared place/list link should open its content directly.
  // If the visitor isn't onboarded yet, drop them into guest mode so the
  // shared content is visible immediately (they can sign up later).
  useEffect(() => {
    if (!deepLink || session === undefined) return; // wait for auth to resolve
    if (!onboarded) { setOnboarded(true); return; } // enter as guest, re-run
    window.history.replaceState({}, "", window.location.pathname);
    // Consume the intent: without this, the effect re-fires on every auth
    // token refresh (session identity changes) and yanks the user back to
    // the deep-linked screen mid-browse.
    setDeepLink(null);
    if (deepLink.kind === "place") {
      setActiveTab("home");
      setScreen({ type: "place", id: deepLink.id });
    } else if (deepLink.kind === "list") {
      setPendingListId(deepLink.id);
      setActiveTab("lists");
      setScreen({ type: "lists" });
    } else {
      // ?u=username → open that user's public profile
      getProfileByUsername(deepLink.id)
        .then(p => { if (p) setScreen({ type: "user", profile: p }); })
        .catch(console.error);
    }
  }, [deepLink, onboarded, session]);

  // Called by OnboardingScreen at the actual end of its flow: guest
  // browsing, login success, or registration after the interests step.
  const completeOnboarding = async () => {
    const { data } = await supabase.auth.getSession();
    if (!data.session) localStorage.setItem(GUEST_MODE_KEY, "1"); // guest browsing
    // AWAIT the profile re-fetch so the username picked during onboarding
    // is in state before the app shell renders — otherwise every fresh
    // registrant sees the username gate flash once more.
    await refreshProfile();
    setOnboarded(true);
  };

  // Leaving guest mode returns the user to the onboarding/auth screens
  const exitGuestMode = () => {
    localStorage.removeItem(GUEST_MODE_KEY);
    setOnboarded(false);
    setActiveTab("home");
    setScreen({ type: "home" });
  };

  const handleLogout = () => {
    // Only navigate once the session is actually gone: pretending to sign out
    // while the session survives is a real risk on a shared phone.
    supabase.auth.signOut()
      .then(({ error }) => {
        if (error) throw error;
        setActiveTab("home");
        setScreen({ type: "home" });
      })
      .catch(() => toast.error("تعذّر تسجيل الخروج — تحقق من اتصالك وحاول مجدداً"));
  };

  const refreshProfile = (): Promise<void> => {
    if (!session?.user) { setProfile(null); return Promise.resolve(); }
    return supabase.from("profiles").select("*").eq("id", session.user.id).maybeSingle()
      .then(({ data, error }) => {
        // On a FAILED fetch keep the profile we already have: flipping to
        // null would fail-open the username gate and silently demote
        // admins/owners mid-session. Only a real "no row" clears it.
        if (error) { console.error(error); return; }
        setProfile(data as Profile | null);
      });
  };

  useEffect(() => { refreshProfile(); }, [session?.user?.id]);

  useEffect(() => {
    // On sign-out, clear the previous user's saves so the next viewer
    // doesn't inherit filled bookmarks.
    if (!session?.user) { setSavedPlaces(new Set()); return; }
    getSavedPlaceIds(session.user.id).then(setSavedPlaces).catch(console.error);
  }, [session?.user?.id]);

  // Returning from Moyasar's hosted checkout: verify the purchase
  // server-side, then land the buyer on their (now unlocked) lists.
  useEffect(() => {
    if (!FEATURES.paidLists) return;
    if (!session?.user) return;
    const purchaseId = new URLSearchParams(window.location.search).get("purchase_id");
    if (!purchaseId) return;
    window.history.replaceState({}, "", window.location.pathname);
    confirmListPurchase(purchaseId)
      .catch(console.error)
      .finally(() => {
        setActiveTab("lists");
        setScreen({ type: "lists" });
      });
  }, [session?.user?.id]);

  useEffect(() => {
    if (screen.type === "business" && !profile?.owned_place_id) setScreen({ type: activeTab });
    if (screen.type === "admin" && profile?.role !== "admin") setScreen({ type: activeTab });
    if (screen.type === "creator" && !(profile?.is_creator && FEATURES.paidLists)) setScreen({ type: activeTab });
  }, [screen.type, profile]);

  const savesInFlight = useRef<Set<string>>(new Set());
  const handleSave = (id: string) => {
    // Guests get the login nudge only — no optimistic toggle that would
    // fill the bookmark for a save that is never persisted.
    if (!session?.user) { toast.info("سجّل الدخول لحفظ الأماكن"); return; }
    // Ignore taps while this place's toggle is still writing, so a rapid
    // double-tap can't race INSERT/DELETE and desync UI from DB.
    if (savesInFlight.current.has(id)) return;
    const wasSaved = savedPlaces.has(id);
    const applyToggle = (add: boolean) => setSavedPlaces(prev => {
      const next = new Set(prev);
      if (add) next.add(id); else next.delete(id);
      return next;
    });
    applyToggle(!wasSaved);
    savesInFlight.current.add(id);
    toggleSavedPlace(session.user.id, id, wasSaved)
      .catch(() => {
        applyToggle(wasSaved); // roll back the optimistic change
        toast.error("تعذّر حفظ التغيير — تأكد من اتصالك وحاول مجدداً");
      })
      .finally(() => savesInFlight.current.delete(id));
  };

  const navigate = (tab: Tab) => {
    setActiveTab(tab);
    setScreen({ type: tab });
  };

  const goToPlace = (id: string) => setScreen({ type: "place", id });
  const goToList = () => { setActiveTab("lists"); setScreen({ type: "lists" }); };
  const goToListById = (id: string) => { setPendingListId(id); setActiveTab("lists"); setScreen({ type: "lists" }); };
  const goToUser = (p: Profile) => setScreen({ type: "user", profile: p });
  const goBack = () => setScreen({ type: activeTab });
  const onSearch = (q: string) => { setExploreQuery(q); navigate("explore"); };

  const isFullScreen =
    screen.type === "place" || screen.type === "business" || screen.type === "admin" ||
    screen.type === "creator" || screen.type === "user";

  // Usernames are mandatory (search/share identity), and so is a display
  // name (the old login path auto-created nameless accounts). Accounts
  // missing either get gated until complete. Waits for the profile row to
  // load so the gate never flashes for complete profiles.
  const needsUsername = !!session?.user && profile !== null && (!profile.username || !(profile.name ?? "").trim());

  const tabs: { key: Tab; icon: React.ReactNode; label: string }[] = [
    { key: "home",    icon: <Home size={21} />,   label: "الرئيسية" },
    { key: "explore", icon: <Search size={21} />, label: "اكتشف" },
    { key: "offers",  icon: <Tag size={21} />,    label: "العروض" },
    { key: "lists",   icon: <List size={21} />,   label: "القوائم" },
    { key: "profile", icon: <User size={21} />,   label: "حسابي" },
  ];

  const renderScreen = () => {
    switch (screen.type) {
      case "home":
        return (
          <HomePage
            onPlaceClick={goToPlace}
            onListClick={goToList}
            onListSelect={goToListById}
            onUserClick={goToUser}
            onSearch={onSearch}
            onSeeAllOffers={() => navigate("offers")}
            onSeeAllLists={() => navigate("lists")}
            savedPlaces={savedPlaces}
            onSave={handleSave}
            currentUser={profile}
          />
        );
      case "explore":
        return <ExplorePage onPlaceClick={goToPlace} onUserClick={goToUser} currentUserId={session?.user?.id ?? null} savedPlaces={savedPlaces} onSave={handleSave} initialQuery={exploreQuery} />;
      case "lists":
        return <ListsPage userId={session?.user?.id ?? null} isCreator={profile?.is_creator ?? false} onPlaceClick={goToPlace} savedPlaces={savedPlaces} onSave={handleSave} initialListId={pendingListId} onInitialListConsumed={() => setPendingListId(null)} />;
      case "profile":
        return (
          <ProfilePage
            userId={session?.user?.id ?? null}
            currentUser={profile}
            onPlaceClick={goToPlace}
            onListClick={goToList}
            onUserClick={goToUser}
            savedPlaces={savedPlaces}
            onLoginClick={exitGuestMode}
            onProfileUpdated={refreshProfile}
            onLogout={handleLogout}
          />
        );
      case "offers":
        return <OffersPage userId={session?.user?.id ?? null} onPlaceClick={goToPlace} />;
      case "place":
        return <PlacePage placeId={screen.id} userId={session?.user?.id ?? null} onBack={goBack} savedPlaces={savedPlaces} onSave={handleSave} onListClick={(id) => (id ? goToListById(id) : goToList())} />;
      case "business":
        return profile?.owned_place_id && session?.user ? (
          <BusinessDashboard userId={session.user.id} placeId={profile.owned_place_id} onBack={goBack} />
        ) : null;
      case "admin":
        return profile?.role === "admin" && session?.user ? (
          <AdminPanel userId={session.user.id} onBack={goBack} />
        ) : null;
      case "creator":
        return FEATURES.paidLists && profile?.is_creator && session?.user ? (
          <CreatorDashboard userId={session.user.id} onBack={goBack} />
        ) : null;
      case "user":
        return (
          <PublicProfile
            profile={screen.profile}
            viewerId={session?.user?.id ?? null}
            isAdmin={profile?.role === "admin"}
            onBack={goBack}
            onPlaceClick={goToPlace}
            onListClick={(list) => goToListById(list.id)}
          />
        );
    }
  };

  return (
    <div className="size-full flex items-center justify-center bg-[#1a1a1a]">
      <div
        className="relative flex flex-col bg-background overflow-hidden shadow-2xl"
        style={{
          fontFamily: FONT,
          width: "100%",
          maxWidth: 430,
          height: "100%",
          maxHeight: 900,
        }}
      >
        {/* Content. The onboarding <-> app swap is a plain conditional:
            putting both in one AnimatePresence made the app wait on the
            onboarding exit animation, which could wedge mid-transition and
            leave a zombie onboarding screen over a blank app. Screen-to-
            screen transitions inside the app keep their animation. */}
        <div className="flex-1 flex flex-col overflow-hidden relative">
          {!onboarded ? (
            <div className="flex-1 flex flex-col absolute inset-0">
              <OnboardingScreen onComplete={completeOnboarding} />
            </div>
          ) : needsUsername ? (
            /* Accounts that predate mandatory usernames pick one before
               continuing — usernames are the search/share identity. */
            <div className="flex-1 flex flex-col absolute inset-0">
              <UsernameGate onDone={refreshProfile} onLogout={handleLogout} />
            </div>
          ) : (
            <AnimatePresence mode="wait">
              <motion.div
                key={screen.type}
                className="flex-1 flex flex-col absolute inset-0"
                initial={{ opacity: 0, y: isFullScreen ? 30 : 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: isFullScreen ? 30 : -8 }}
                transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <ScreenErrorBoundary>
                  <Suspense fallback={screenLoader}>{renderScreen()}</Suspense>
                </ScreenErrorBoundary>
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        {/* Bottom Tab Bar */}
        {onboarded && !isFullScreen && !needsUsername && (
          <div
            className="flex-shrink-0 bg-card/96 backdrop-blur-sm border-t border-border z-20"
            dir="rtl"
            // Keep the tabs clear of the iPhone home-bar / gesture area
            style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
          >
            <div className="flex items-center justify-around px-1 pt-2 pb-1">
              {tabs.map(tab => {
                const active = activeTab === tab.key;
                return (
                  <button
                    key={tab.key}
                    onClick={() => navigate(tab.key)}
                    className="flex flex-col items-center gap-1 px-3 py-1.5 rounded-2xl transition-colors relative"
                    style={{ color: active ? "var(--primary)" : "var(--muted-foreground)" }}
                  >
                    {active && (
                      <motion.div
                        layoutId="tab-bg"
                        className="absolute inset-0 rounded-2xl"
                        style={{ background: "rgba(44,24,16,0.06)" }}
                        transition={{ type: "spring", damping: 28, stiffness: 300 }}
                      />
                    )}
                    <motion.div
                      animate={{ scale: active ? 1.12 : 1 }}
                      transition={{ type: "spring", damping: 20, stiffness: 300 }}
                      className="relative z-10"
                    >
                      {tab.icon}
                    </motion.div>
                    <span className="text-xs font-medium leading-none relative z-10">{tab.label}</span>
                    {active && (
                      <motion.div
                        layoutId="tab-dot"
                        className="w-1 h-1 rounded-full bg-accent mt-0.5 relative z-10"
                        transition={{ type: "spring", damping: 28, stiffness: 300 }}
                      />
                    )}
                  </button>
                );
              })}
            </div>

            {/* Quick Access Row */}
            {(profile?.owned_place_id || profile?.role === "admin" || (profile?.is_creator && FEATURES.paidLists)) && (
              <div className="flex gap-2 px-4 pb-4 pt-1" dir="rtl">
                {profile?.is_creator && FEATURES.paidLists && (
                  <button
                    onClick={() => setScreen({ type: "creator" })}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-medium hover:bg-secondary transition-colors"
                  >
                    💰 لوحتي
                  </button>
                )}
                {profile?.owned_place_id && (
                  <button
                    onClick={() => setScreen({ type: "business" })}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-muted text-muted-foreground text-xs font-medium hover:bg-secondary transition-colors"
                  >
                    🏪 لوحة المكان
                  </button>
                )}
                {profile?.role === "admin" && (
                  <button
                    onClick={() => setScreen({ type: "admin" })}
                    className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-xl bg-primary/8 text-primary text-xs font-medium hover:bg-primary/15 transition-colors"
                    style={{ backgroundColor: "rgba(44,24,16,0.06)" }}
                  >
                    🛡️ لوحة الإدارة
                  </button>
                )}
              </div>
            )}
          </div>
        )}

        {/* Global toast layer — positioned within the phone frame */}
        <ToastHost />
      </div>
    </div>
  );
}
