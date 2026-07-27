import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

// Retrofit for the hand-rolled overlays that already have their own markup:
// spread the returned props onto the overlay root and it gains dialog
// semantics, Escape-to-close, focus-in on open, focus restore on close and a
// contained Tab loop — without restructuring the JSX. New sheets should use
// the <Sheet> component below instead.
export function useSheetA11y(open: boolean, onClose: () => void, label: string) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    ref.current?.focus();
    return () => { if (restoreTo.current?.isConnected) restoreTo.current.focus(); };
  }, [open]);

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const f = ref.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!f?.length) return;
    const first = f[0], last = f[f.length - 1];
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === ref.current)) {
      e.preventDefault(); last.focus();
    }
  };

  return { ref, role: "dialog" as const, "aria-modal": true, "aria-label": label, tabIndex: -1, onKeyDown };
}

type Props = {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  // Long forms need to scroll inside the sheet rather than grow past the frame
  scroll?: boolean;
  // Hide the default header when a screen draws its own
  hideHeader?: boolean;
};

let sheetSeq = 0;

// Bottom-sheet dialog. The app had 13 hand-rolled overlays: only two carried
// dialog semantics and only two handled Escape, so a keyboard user who opened
// one was stranded with no way out. This centralises the parts that are easy
// to forget: dialog role, labelled title, Escape to close, focus moved in on
// open, focus restored to the trigger on close, and a Tab loop kept inside.
export function Sheet({ open, onClose, title, children, scroll = false, hideHeader = false }: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreTo = useRef<HTMLElement | null>(null);
  const titleId = useRef(`sheet-title-${++sheetSeq}`);

  useEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    // Focus the panel itself: focusing the first control instead would pop
    // the mobile keyboard open before the user has chosen anything.
    panelRef.current?.focus();
    return () => {
      // Only restore if the trigger is still in the document
      if (restoreTo.current?.isConnected) restoreTo.current.focus();
    };
  }, [open]);

  if (!open) return null;

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { e.stopPropagation(); onClose(); return; }
    if (e.key !== "Tab") return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([disabled]), select, textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    );
    if (!focusable?.length) return;
    const first = focusable[0], last = focusable[focusable.length - 1];
    // Wrap at both ends so Tab can never land behind the overlay
    if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && (document.activeElement === first || document.activeElement === panelRef.current)) {
      e.preventDefault(); last.focus();
    }
  };

  return (
    <div className="absolute inset-0 z-50 flex items-end" dir="rtl" onKeyDown={onKeyDown}>
      <div className="absolute inset-0 bg-black/40" onClick={onClose} aria-hidden="true" />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId.current}
        tabIndex={-1}
        className={`relative w-full bg-card rounded-t-3xl p-6 outline-none ${scroll ? "max-h-[70vh] overflow-y-auto" : ""}`}
        style={{ paddingBottom: "max(1.5rem, env(safe-area-inset-bottom, 0px))" }}
      >
        {hideHeader ? (
          // Still needs an accessible name even when visually hidden
          <h3 id={titleId.current} className="sr-only">{title}</h3>
        ) : (
          <div className="flex items-center justify-between mb-4">
            <h3 id={titleId.current} className="text-base font-bold">{title}</h3>
            <button onClick={onClose} aria-label="إغلاق">
              <X size={20} className="text-muted-foreground" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>
  );
}
