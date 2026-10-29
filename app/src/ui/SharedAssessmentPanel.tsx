import { useState } from 'react';
import {
  adaptSharedAssessment, compareSharedAssessments, metricAvailable,
  type AssessmentContext, type SharedAssessment, type SharedMetric,
} from '@/lib/sharedAssessment';
import { useTr } from '@/i18n';

function valueText(metric: SharedMetric): string {
  return metricAvailable(metric) ? JSON.stringify(metric.value) : 'N/A';
}
export function SharedAssessmentPanel({ assessment, onChange }: { assessment: SharedAssessment | null; onChange: (value: SharedAssessment | null) => void }) {
  const tr = useTr();
  const [error, setError] = useState('');
  const [producer, setProducer] = useState<'preflight' | 'domains'>('preflight');
  const [expectedContext, setExpectedContext] = useState<AssessmentContext | undefined>();
  const [ownerFindings, setOwnerFindings] = useState<unknown>();
  const [comparison, setComparison] = useState<SharedAssessment | null>(null);
  const compare = assessment && comparison ? compareSharedAssessments(assessment, comparison) : null;
  async function importJson(file: File | undefined, kind: 'assessment' | 'context' | 'findings' | 'comparison') {
    if (!file) return;
    try {
      const json: unknown = JSON.parse(await file.text());
      if (kind === 'assessment') {
        onChange(adaptSharedAssessment(json, producer, { expectedContext }));
        setOwnerFindings(undefined); setComparison(null);
      } else if (kind === 'comparison') {
        setComparison(adaptSharedAssessment(json, producer, { expectedContext }));
      } else {
        if (!assessment) throw new Error('Import an Assessment before its context or projected findings.');
        const nextContext = kind === 'context' ? json as AssessmentContext : expectedContext;
        const nextFindings = kind === 'findings' ? json : ownerFindings;
        const result = adaptSharedAssessment(assessment.envelope, producer, { expectedContext: nextContext, findings: nextFindings });
        onChange(result); setExpectedContext(nextContext); setOwnerFindings(nextFindings);
      }
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); }
  }
  const upload = (kind: 'assessment' | 'context' | 'findings' | 'comparison') => async (e: React.ChangeEvent<HTMLInputElement>) => {
    await importJson(e.target.files?.[0], kind); e.target.value = '';
  };
  return <section className="mb-4 card p-4" aria-label={tr('Évaluation scientifique partagée', 'Shared scientific assessment')}>
    <p className="mb-2 text-sm">{tr('Importer une évaluation ou un rapport natif versionné avec sa provenance et ses statuts de disponibilité.', 'Import a versioned assessment or native report with its provenance and availability states.')}</p>
    <label>{tr('Producteur déclaré des anciens rapports', 'Declared producer for legacy reports')} <select value={producer} onChange={(e) => setProducer(e.target.value as typeof producer)}><option value="preflight">Preflight</option><option value="domains">Domains</option></select></label>
    <label className="ml-3">{tr('Évaluation / rapport JSON', 'Assessment / report JSON')} <input type="file" accept=".json,application/json" onChange={upload('assessment')} /></label>
    {error && <p role="alert">{error}</p>}
    {assessment && <>
      <p className="mt-3">{assessment.declaredProducer ?? `${assessment.producer} (${tr('déclaré à l’import', 'declared by importer')})`} · {assessment.engineVersion} · {assessment.protocolVersion} · {assessment.status}</p>
      <p>{tr('Les valeurs indisponibles restent N/A avec leur raison ; elles ne deviennent pas zéro. Les libellés de confiance ne sont pas des probabilités ni une couverture prédictive.', 'Unavailable values remain N/A with their reasons; they never become zero. Confidence labels are neither probabilities nor predictive coverage.')}</p>
      <p>{tr('Validité des mesures, applicabilité au domaine, performance du modèle et incertitude prédictive sont des questions distinctes. Les définitions et actions ci-dessous restent celles des protocoles du producteur.', 'Measurement validity, domain applicability, model performance and prediction uncertainty are distinct questions. The definitions and actions below retain the producer’s protocol meanings.')}</p>
      <p className="mt-2" role="status">{assessment.contextBinding === 'matched'
        ? tr('Contexte conforme au manifeste attendu fourni. Cette comparaison ne certifie pas l’identité du producteur.', 'Context matches the supplied expected manifest. This comparison does not authenticate the producer.')
        : tr('Rapport externe : son association aux données courantes n’est pas vérifiée. Aucun feu de fiabilité du projet n’est déduit de ce rapport.', 'External report: association with the current data is unverified. No project reliability decision is inferred from this report.')}</p>
      {assessment.context ? <>
        <table className="my-3 text-xs"><caption>{tr('Identité des données et populations déclarées', 'Declared data and population identity')}</caption><tbody>{Object.entries(assessment.context).map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td className="break-all">{value ?? 'N/A'}</td></tr>)}</tbody></table>
        <label className="block my-2">{tr('Manifeste de contexte attendu (indépendant du rapport)', 'Expected context manifest (independent of the report)')} <input type="file" accept=".json,application/json" onChange={upload('context')} /></label>
        <label className="block my-2">{tr('Constats projetés du producteur (JSON)', 'Producer-projected findings (JSON)')} <input type="file" accept=".json,application/json" onChange={upload('findings')} /></label>
      </> : assessment.nativeTaskContext ? <>
        <table className="my-3 text-xs"><caption>{tr('Contexte natif Domains — identités originales, sans conversion en Assessment', 'Native Domains context — original identities, without Assessment conversion')}</caption><tbody>{Object.entries(assessment.nativeTaskContext).map(([key, value]) => <tr key={key}><th scope="row">{key}</th><td className="break-all">{value === null ? 'N/A' : typeof value === 'object' ? JSON.stringify(value) : value}</td></tr>)}</tbody></table>
        <p>{tr('Le hash de tâche assainie et le hash X d’apprentissage restent distincts d’un hash de données source. Les populations train/test sont celles du rapport natif ; une référence absente ne devient pas une référence apprise.', 'The sanitized task hash and fitted X hash remain distinct from a source data hash. Train/test populations come from the native report; an absent reference never becomes a learned reference.')}</p>
      </> : <p>{tr('Ce rapport ancien ne fournit pas les identités dataset/contenu/contexte et populations d’apprentissage/évaluation. La comparaison qualifiée est indisponible.', 'This legacy report does not supply dataset/content/context and fit/evaluation population identities. Qualified comparison is unavailable.')}</p>}
      <div className="overflow-auto"><table className="text-xs"><caption>{tr('Mesures, disponibilité et provenance du rapport importé', 'Imported measurements, availability and provenance')}</caption><thead><tr>{['Metric / protocol', 'Source / target / view / population', 'Availability / native status / reason', 'Value / unit', 'Evidence kind / confidence / coverage / strength', 'Parameters / denominators'].map((label) => <th scope="col" key={label}>{label}</th>)}</tr></thead><tbody>{assessment.metrics.map((metric, i) => <tr key={i}><td>{metric.metric_id} / {metric.protocol_version}</td><td>{[metric.source_id, metric.target_id, metric.view_id, metric.population_id, metric.context_id].map((v) => v ?? 'N/A').join(' / ')}</td><td>{metric.availability ?? metric.status} / {metric.native_status ?? metric.status} / {metric.reason_code ?? '—'}</td><td>{valueText(metric)} {metric.unit}</td><td>{metric.kind ?? 'N/A'} / {metric.confidence_status ?? 'unknown'} / {metric.evidence_coverage ?? 'N/A'} / {metric.signal_strength ?? 'N/A'}</td><td><pre>{JSON.stringify(metric.parameters)}</pre><pre>{JSON.stringify(metric.denominators)}</pre></td></tr>)}</tbody></table></div>
      <ul className="my-3">{assessment.findings.map((finding, i) => <li className="mb-2" key={i}>
        {finding.severity} · {finding.kind} · {finding.confidence_status} · {finding.message} — {finding.action}
        {typeof finding.calibration_consequence === 'string' && <p>{finding.calibration_consequence}</p>}
        <p>{tr('Couverture des preuves / force du signal', 'Evidence coverage / signal strength')}: {finding.evidence_coverage ?? 'N/A'} / {finding.signal_strength ?? 'N/A'}</p>
        <ul>{finding.evidenceMatches.map((match, j) => <li key={j}>{JSON.stringify(match.identity)} · {match.metrics.length === 0 ? tr('N/A : preuve native non résolue', 'N/A: unresolved native evidence') : match.metrics.length > 1 ? tr(`${match.metrics.length} contextes de paramètres distincts ; aucune valeur unique n’est supposée.`, `${match.metrics.length} distinct parameter contexts; no unique scalar is assumed.`) : tr('une mesure native', 'one native measurement')}<ul>{match.metrics.map((m, k) => <li key={k}>{JSON.stringify(m.parameters)} · {m.status} · {m.reason_code ?? '—'}</li>)}</ul></li>)}</ul>
        {finding.unresolvedEvidence.length > 0 && <p>{tr('Preuves non résolues / non projetées', 'Unresolved / unprojected evidence')}: {finding.unresolvedEvidence.join(', ')}</p>}
      </li>)}</ul>
      <ul>{assessment.limitations.map((limitation, i) => <li key={i}>{limitation}</li>)}</ul>
      <label className="block my-3">{tr('Comparer une autre évaluation', 'Compare another assessment')} <input type="file" accept=".json,application/json" onChange={upload('comparison')} /></label>
      {compare && (!compare.comparable ? <p role="status">{tr('Comparaison indisponible : ', 'Comparison unavailable: ')}{compare.reason}</p> : <div className="overflow-auto"><table className="text-xs"><caption>{tr('Comparaison à contexte, protocole, paramètres, unités et dénominateurs identiques', 'Comparison with identical context, protocol, parameters, units and denominators')}</caption><thead><tr><th scope="col">Metric / parameters</th><th scope="col">{tr('Rapport actuel', 'Current report')}</th><th scope="col">{tr('Autre rapport', 'Other report')}</th></tr></thead><tbody>{compare.pairs.map(({ identity, left, right }) => <tr key={identity}><th scope="row">{left.metric_id} · {JSON.stringify(left.parameters)}</th><td>{valueText(left)} · {left.availability ?? left.status} · {left.reason_code ?? '—'}</td><td>{valueText(right)} · {right.availability ?? right.status} · {right.reason_code ?? '—'}</td></tr>)}</tbody></table>{compare.pairs.length === 0 && <p>{tr('Aucune mesure n’a un protocole et une provenance comparables.', 'No measurements share a comparable protocol and provenance.')}</p>}</div>)}
      <details className="my-3"><summary>{tr('Rapport natif original', 'Original native report')}</summary><pre className="overflow-auto text-xs">{JSON.stringify(assessment.report, null, 2)}</pre></details>
      <button className="btn-outline mt-3" onClick={() => { onChange(null); setComparison(null); setOwnerFindings(undefined); setExpectedContext(undefined); setError(''); }}>{tr('Revenir au dépistage local', 'Return to local screening')}</button>
    </>}
  </section>;
}
