import { useState } from 'react';
import { adaptSharedAssessment, type SharedAssessment } from '@/lib/sharedAssessment';
import { useTr } from '@/i18n';

export function SharedAssessmentPanel({ assessment, onChange }: { assessment: SharedAssessment | null; onChange: (value: SharedAssessment | null) => void }) {
  const tr = useTr();
  const [error, setError] = useState('');
  const [producer, setProducer] = useState<'preflight' | 'domains'>('preflight');
  return <section className="mb-4 card p-4" aria-label={tr('Évaluation scientifique partagée', 'Shared scientific assessment')}>
    <p className="mb-2 text-sm">{tr('Importer un rapport versionné pour afficher les résultats et leur provenance sans les recalculer. Vérifiez que ses sources et populations correspondent au projet.', 'Import a versioned report to display results and provenance without recomputation. Check that its sources and populations match the project.')}</p>
    <label>{tr('Producteur', 'Producer')} <select value={producer} onChange={(e) => setProducer(e.target.value as typeof producer)}><option value="preflight">Preflight</option><option value="domains">Domains (QualificationReport v1)</option></select></label>
    <label className="ml-3">{tr('Rapport JSON', 'JSON report')} <input type="file" accept=".json,application/json" onChange={async (e) => {
      const file = e.target.files?.[0]; if (!file) return;
      try { onChange(adaptSharedAssessment(JSON.parse(await file.text()), producer)); setError(''); }
      catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
      e.target.value = '';
    }} /></label>
    {error && <p role="alert">{error}</p>}
    {assessment && <>
      <p className="mt-3">{assessment.producer} · {assessment.engineVersion} · {assessment.protocolVersion} · {assessment.status}</p>
      <p>{tr('Les valeurs indisponibles gardent leur statut ; aucune absence de preuve n’est remplacée par zéro.', 'Unavailable values retain their status; absent evidence is never replaced with zero.')}</p>
      <div className="overflow-auto"><table className="text-xs"><caption>{tr('Mesures et contexte scientifique du rapport importé', 'Imported measurements and scientific context')}</caption><thead><tr>{['Metric / protocol', 'Source / target / view / population', 'Status / reason', 'Value / unit'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{assessment.metrics.map((metric, i) => <tr key={i}><td>{metric.metric_id} / {metric.protocol_version}</td><td>{[metric.source_id, metric.target_id, metric.view_id, metric.population_id].map((v) => v ?? '—').join(' / ')}</td><td>{metric.status} / {metric.reason_code ?? '—'}</td><td>{metric.status === 'computed' ? JSON.stringify(metric.value) : '—'} {metric.unit}</td></tr>)}</tbody></table></div>
      <ul>{assessment.findings.map((finding, i) => <li key={i}>{finding.severity} · {finding.confidence} · {finding.message} — {finding.action} ({finding.evidence.join(', ')})</li>)}</ul>
      <ul>{assessment.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul>
      <button className="btn-outline mt-3" onClick={() => onChange(null)}>{tr('Revenir au dépistage local', 'Return to local screening')}</button>
    </>}
  </section>;
}
