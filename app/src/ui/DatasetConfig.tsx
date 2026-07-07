// Column-role configuration panel (io.nirs4all.org-style): after files are
// dropped, the user assigns each descriptive column a role — sample-id (groups
// replicates), target (y), metadata, or ignore — and sees a live preview of the
// assembled dataset. The spectral columns are auto-detected from the header.
import { Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  analyzeFiles, assembleDataset, previewCounts,
  type AssembleResult, type ColRole, type DatasetAnalysis, type LeadingColumn, type RawFile,
} from '@/lib/dataset';
import { useTr } from '@/i18n';

export interface DatasetConfigMeta { targetName: string; withRef: number; samples: number }

export function DatasetConfig({ files, projectId, onChange }: {
  files: RawFile[];
  projectId: string;
  onChange: (result: AssembleResult | null, meta: DatasetConfigMeta | null) => void;
}) {
  const tr = useTr();
  // Parse can be heavy (large/sparse corpora) → defer it so the spinner paints
  // before the main thread blocks.
  const [analysis, setAnalysis] = useState<DatasetAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(true);
  useEffect(() => {
    setAnalyzing(true); setAnalysis(null);
    const t = setTimeout(() => {
      try { setAnalysis(analyzeFiles(files)); } catch { setAnalysis(null); }
      setAnalyzing(false);
    }, 30);
    return () => clearTimeout(t);
  }, [files]);

  const [leading, setLeading] = useState<LeadingColumn[]>([]);
  useEffect(() => { setLeading(analysis ? analysis.leading.map((c) => ({ ...c })) : []); }, [analysis]);

  const preview = useMemo(() => (analysis ? previewCounts(analysis, leading) : null), [analysis, leading]);

  useEffect(() => {
    if (!analysis) { onChange(null, null); return; }
    const r = assembleDataset(projectId, analysis, leading);
    const withRef = r.samples.filter((s) => s.reference?.value != null).length;
    onChange(r, { targetName: analysis.targetName, withRef, samples: r.samples.length });
    // onChange is a stable setter from the parent; deps are the config inputs
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysis, leading, projectId]);

  if (analyzing) {
    return (
      <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {tr('Analyse du jeu de données…', 'Analyzing the dataset…')}
      </div>
    );
  }
  if (!analysis) {
    return <p className="mt-2 text-xs text-destructive">{tr('Fichier illisible ou sans colonne spectrale.', 'Unreadable file or no spectral column.')}</p>;
  }

  const setRole = (index: number, role: ColRole) => setLeading((prev) => prev.map((c) => (c.index === index ? { ...c, role } : c)));

  return (
    <div className="mt-3 space-y-3 rounded-lg border border-border bg-muted/30 p-3">
      {leading.length > 0 ? (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground/80">{tr('Rôle des colonnes', 'Column roles')}</div>
          <div className="space-y-1.5">
            {leading.map((c) => (
              <div key={c.index} className="flex items-center gap-2">
                <span className="w-36 shrink-0 truncate font-mono text-xs" title={c.name}>{c.name}</span>
                <select
                  className="rounded-md border border-border bg-card px-2 py-1 text-xs"
                  value={c.role}
                  onChange={(e) => setRole(c.index, e.target.value as ColRole)}
                >
                  <option value="id">{tr('Identifiant (regroupe les répétitions)', 'Sample id (groups replicates)')}</option>
                  <option value="target" disabled={!!analysis.separateTarget}>{tr('Cible y', 'Target y')}</option>
                  <option value="metadata">{tr('Métadonnée', 'Metadata')}</option>
                  <option value="ignore">{tr('Ignorer', 'Ignore')}</option>
                </select>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {tr('Tout est spectral (pas de colonne descriptive). Les répétitions = lignes partageant le même identifiant ; ajoutez un fichier y pour la cible.',
            'All columns are spectral (no descriptive column). Replicates = rows sharing the same id; add a y file for the target.')}
        </p>
      )}

      <div className="flex flex-wrap gap-1.5">
        <span className="n4-pill n4-pill--teal">{preview?.features} {tr('longueurs d’onde', 'wavelengths')} · {analysis.axisUnit}</span>
        <span className="n4-pill n4-pill--muted">{preview?.samples} {tr('échantillons', 'samples')}</span>
        <span className="n4-pill n4-pill--muted">{preview?.replicates} {tr('spectres', 'spectra')}</span>
        <span className={`n4-pill ${preview && preview.withRef > 0 ? 'n4-pill--green' : 'n4-pill--amber'}`}>{preview?.withRef} {tr('avec cible', 'with target')}</span>
        {analysis.separateTarget && <span className="n4-pill n4-pill--teal">{tr('cible depuis fichier y', 'target from y file')}</span>}
        {analysis.metaFile && <span className="n4-pill n4-pill--teal">{tr('id + métadonnées via', 'id + metadata via')} {analysis.metaFile}</span>}
        {analysis.capped && <span className="n4-pill n4-pill--amber">{tr(`limité à ${analysis.capped} / ${analysis.totalRows} (navigateur)`, `capped at ${analysis.capped} / ${analysis.totalRows} (browser)`)}</span>}
      </div>
    </div>
  );
}
