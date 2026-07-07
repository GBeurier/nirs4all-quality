// Ecosystem drag-and-drop dataset zone — same interaction/visual language as
// nirs4all-studio, web.nirs4all.org (studio-lite) and io.nirs4all.org: a teal
// dashed target with a spectral hairline, drag-active fill, click + keyboard
// pickers, and a browser-only privacy note. React-18 safe (local drag state).
import { useRef, useState } from 'react';
import { AlertTriangle, FileText, Loader2, ShieldCheck, Upload } from 'lucide-react';

import { useTr } from '@/i18n';

export interface DropzoneProps {
  onFiles: (files: File[]) => void;
  title?: string;
  hint?: React.ReactNode;
  accept?: string;
  multiple?: boolean;
  busy?: boolean;
  error?: string | null;
  note?: string | null;
  /** compact = a smaller secondary zone (e.g. the reference CSV). */
  compact?: boolean;
  /** show the "runs entirely in your browser" reassurance line. */
  privacy?: boolean;
}

export function Dropzone({
  onFiles, title, hint, accept = '.csv,.txt,.tsv', multiple = false,
  busy = false, error = null, note = null, compact = false, privacy = false,
}: DropzoneProps) {
  const tr = useTr();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const emit = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    onFiles(Array.from(list));
  };

  return (
    <div className="space-y-2">
      <div
        role="button"
        tabIndex={0}
        aria-disabled={busy}
        onDragOver={(e) => { e.preventDefault(); if (!busy) setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => { e.preventDefault(); setDragging(false); if (!busy) emit(e.dataTransfer.files); }}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && !busy) { e.preventDefault(); inputRef.current?.click(); } }}
        className={[
          'group relative flex flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border-2 border-dashed text-center outline-none transition-colors',
          compact ? 'p-5' : 'p-8',
          busy ? 'pointer-events-none opacity-70' : '',
          dragging
            ? 'border-primary bg-primary/[0.06]'
            : 'border-border bg-muted/40 hover:border-primary/60 hover:bg-primary/[0.03]',
        ].join(' ')}
      >
        {/* spectral hairline at the top edge (io.nirs4all.org signature) */}
        <span className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[linear-gradient(90deg,var(--teal-d),var(--teal-l),var(--cyan),var(--green))] opacity-90" />
        <span
          className={[
            'flex items-center justify-center rounded-full transition-colors',
            compact ? 'h-10 w-10' : 'h-14 w-14',
            dragging ? 'bg-primary text-primary-foreground' : 'bg-primary/10 text-primary',
          ].join(' ')}
        >
          {busy ? <Loader2 className={compact ? 'h-5 w-5 animate-spin' : 'h-7 w-7 animate-spin'} />
                : <Upload className={compact ? 'h-5 w-5' : 'h-7 w-7'} />}
        </span>
        <div className="space-y-0.5">
          <p className={compact ? 'text-sm font-medium text-foreground' : 'text-lg font-semibold text-foreground'}>
            {busy ? tr('Lecture du fichier…', 'Reading file…') : (title ?? tr('Déposez vos spectres ici', 'Drop your spectra here'))}
          </p>
          <p className="text-xs text-muted-foreground">
            {hint ?? (
              <>{tr('ou ', 'or ')}<span className="font-medium text-primary">{tr('parcourir', 'browse')}</span>{tr(' — CSV / TXT', ' — CSV / TXT')}</>
            )}
          </p>
        </div>
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(e) => { emit(e.target.files); e.target.value = ''; }}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-2.5 text-xs text-destructive">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{error}</span>
        </div>
      )}
      {note && !error && (
        <div className="flex items-start gap-2 rounded-xl border border-success/30 bg-success/5 p-2.5 text-xs text-success">
          <FileText className="mt-0.5 h-3.5 w-3.5 shrink-0" /><span>{note}</span>
        </div>
      )}
      {privacy && (
        <div className="flex items-center justify-center gap-1.5 text-[11px] text-muted-foreground">
          <ShieldCheck className="h-3.5 w-3.5 text-success" />
          <span>{tr('Tout se passe dans votre navigateur — aucun fichier n’est envoyé.', 'Runs entirely in your browser — no files are uploaded.')}</span>
        </div>
      )}
    </div>
  );
}
