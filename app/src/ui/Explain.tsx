import { HelpCircle, X } from 'lucide-react';
import { useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

import { pick, useLang, useTr, type Localized } from '@/i18n';

// The pedagogical "?" affordance (design §P4), now scientific: it gives the
// plain-language intro (what / why / takeaway) AND hosts real evidence — numbers
// and mini-dataviz — passed as `children`. Bilingual (FR/EN). The technician gets
// the conclusion up front and full access to the stats behind it.

export interface ExplanationContent {
  title: string;
  what: string;
  why: string;
  details?: string;
  takeaway?: string;
  methods?: string[];
}

export function Explain({
  content,
  children,
  className,
  align = 'left',
  wide = false,
}: {
  content: Localized<ExplanationContent>;
  /** rich scientific detail (real numbers + charts) — shown under "Details & statistics" */
  children?: ReactNode;
  className?: string;
  align?: 'left' | 'right';
  wide?: boolean;
}) {
  const { lang } = useLang();
  const tr = useTr();
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top?: number; bottom?: number }>({ left: 0, top: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);
  const c = pick(content, lang);

  // Position the popover with a PORTAL + fixed coords so ancestor overflow:hidden
  // (e.g. .card) can never clip it, and it stays within the viewport.
  const toggle = () => {
    if (!open) {
      const r = btnRef.current?.getBoundingClientRect();
      if (r) {
        const w = wide ? 544 : 320;
        const left = Math.max(8, Math.min(align === 'right' ? r.right - w : r.left, window.innerWidth - w - 8));
        const below = r.bottom < window.innerHeight * 0.6;
        setPos(below ? { left, top: r.bottom + 6 } : { left, bottom: window.innerHeight - r.top + 6 });
      }
    }
    setOpen((o) => !o);
  };

  return (
    <span className={`inline-flex ${className ?? ''}`}>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        aria-label={`${tr('Expliquer', 'Explain')} : ${c.title}`}
        aria-expanded={open}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <HelpCircle size={13} />
      </button>
      {open && createPortal(
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={c.title}
            style={{ position: 'fixed', left: pos.left, ...(pos.top != null ? { top: pos.top } : {}), ...(pos.bottom != null ? { bottom: pos.bottom } : {}) }}
            className={`z-[61] ${wide ? 'w-[34rem]' : 'w-80'} max-h-[72vh] max-w-[92vw] overflow-auto rounded-xl border border-border bg-popover p-4 text-left shadow-lg`}
          >
            <div className="mb-2 flex items-start justify-between gap-2">
              <span className="font-medium leading-tight">{c.title}</span>
              <button onClick={() => setOpen(false)} aria-label={tr('Fermer', 'Close')} className="text-muted-foreground hover:text-foreground">
                <X size={15} />
              </button>
            </div>
            <Section label={tr('Ce qui a été fait', 'What was done')}>{c.what}</Section>
            <Section label={tr('Pourquoi', 'Why')}>{c.why}</Section>
            {children ? (
              <Section label={tr('Détails & statistiques', 'Details & statistics')}>{children}</Section>
            ) : c.details ? (
              <Section label={tr('Détails', 'Details')}>{c.details}</Section>
            ) : null}
            {c.takeaway ? <Section label={tr('À retenir', 'Takeaway')} accent>{c.takeaway}</Section> : null}
            {c.methods && c.methods.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1 border-t border-border pt-2">
                <span className="mr-1 text-[10px] uppercase text-muted-foreground">{tr('méthodes', 'methods')} :</span>
                {c.methods.map((m) => (
                  <span key={m} className="rounded bg-muted px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">{m}</span>
                ))}
              </div>
            ) : null}
          </div>
        </>,
        document.body,
      )}
    </span>
  );
}

function Section({ label, children, accent }: { label: string; children: ReactNode; accent?: boolean }) {
  return (
    <div className="mb-2 last:mb-0">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm leading-snug ${accent ? 'font-medium text-primary' : ''}`}>{children}</div>
    </div>
  );
}
