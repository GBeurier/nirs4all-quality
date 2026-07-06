import { HelpCircle, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';

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
  const c = pick(content, lang);

  return (
    <span className={`relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`${tr('Expliquer', 'Explain')} : ${c.title}`}
        aria-expanded={open}
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border text-muted-foreground transition hover:bg-muted hover:text-foreground"
      >
        <HelpCircle size={13} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div
            role="dialog"
            aria-label={c.title}
            className={`absolute top-6 z-50 ${wide ? 'w-[34rem]' : 'w-80'} max-h-[72vh] max-w-[92vw] overflow-auto rounded-xl border border-border bg-popover p-4 text-left shadow-lg ${align === 'right' ? 'right-0' : 'left-0'}`}
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
        </>
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
