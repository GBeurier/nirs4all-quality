/** Consumer transport for the owner's real Domains Report v1. This is not an
 * Assessment/QualificationReport rename and does not compute a diagnostic. */
import type { SharedAssessment, SharedFinding, SharedMetric, Availability } from './sharedAssessment';
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
function text(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing Domains ${name}.`);
  return v;
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (object(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
const digest = (v: unknown): v is string => typeof v === 'string' && /^[a-f\d]{64}$/i.test(v);
function ids(v: unknown): string[] | null {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0) && new Set(v).size === v.length ? [...v] : null;
}
function context(v: unknown): Record<string, unknown> {
  if (!object(v)) throw new Error('Missing native Domains context.');
  for (const f of ['dataset_id','content_version','source_id','split_id']) text(v[f], f);
  if (v.target_id !== null && v.target_id !== undefined) text(v.target_id, 'target_id');
  return clone({ ...v, target_id: v.target_id ?? null });
}
function identity(m: SharedMetric): string {
  return stable([m.metric_id,m.protocol_version,m.native_context,m.native_population,m.view_id,m.parameters]);
}
export function adaptDomainsReport(report: Record<string, unknown>): SharedAssessment {
  if (report.schema_version !== 1 || !['domains.canonical.v0.2','domains.canonical.v0.3'].includes(report.protocol_version as string)) throw new Error('Unsupported native Domains report/protocol version.');
  const c = context(report.context);
  const engineVersion = text(report.engine_version,'engine_version');
  const status = text(report.status,'status');
  if (!Array.isArray(report.metrics) || !Array.isArray(report.findings) || !Array.isArray(report.limitations) || !object(report.provenance) || !object(report.policy)) throw new Error('Incomplete native Domains report.');
  if (!Number.isSafeInteger(report.policy.seed)) throw new Error('Domains seed cannot be transported as an exact JavaScript integer.');
  if (typeof report.test_target_accessed !== 'boolean' || report.limitations.some((v) => typeof v !== 'string')) throw new Error('Invalid native Domains scope or limitations.');
  const keys = new Set<string>();
  const metrics = report.metrics.map((v): SharedMetric => {
    if (!object(v) || !object(v.population) || !('parameters' in v) || !object(v.provenance)) throw new Error('Invalid native Domains metric/provenance.');
    const mc = context(v.context);
    if (stable(mc) !== stable(c)) throw new Error('Domains metric crosses dataset/content/source/target/split context.');
    for (const f of ['metric_id','protocol_version','preprocessing_view']) text(v[f],f);
    text(v.population.population_id,'population_id'); text(v.population.statistical_unit,'statistical_unit');
    for (const f of ['n_train_observations','n_test_observations','n_train_physical_samples','n_test_physical_samples','n_train_independent_units','n_test_independent_units']) {
      if (!Number.isSafeInteger(v.population[f]) || (v.population[f] as number) < 0) throw new Error('Invalid native Domains population denominator.');
    }
    if (!['computed','unavailable','insufficient_data','not_identifiable','error'].includes(v.status as string) || typeof v.unit !== 'string' || (v.reason !== null && typeof v.reason !== 'string') || ids(v.observation_ids) === null) throw new Error('Invalid native Domains availability or observation identities.');
    if (v.status === 'computed' && v.value == null) throw new Error('Native Domains computed metric lacks its value.');
    const m: SharedMetric = { ...clone(v), metric_id: v.metric_id as string, protocol_version: v.protocol_version as string,
      status: v.status as Availability, native_status: v.status as Availability,
      availability: v.status === 'computed' ? 'available' : 'unavailable', reason_code: v.reason as string | null,
      value: v.status === 'computed' ? clone(v.value) : null, unit: v.unit,
      scope: 'native:domains_report_v1', source_id: c.source_id as string, target_id: c.target_id as string | null,
      view_id: v.preprocessing_view as string, population_id: v.population.population_id as string,
      parameters: clone(v.parameters), denominators: clone(v.population), native_context: mc,
      native_population: clone(v.population), native_metric: clone(v), confidence_status:'unknown', evidence_coverage:null, signal_strength:null };
    const key = identity(m); if (keys.has(key)) throw new Error('Duplicate native Domains metric context/parameters.'); keys.add(key);
    return m;
  });
  const findings = report.findings.map((v): SharedFinding => {
    if (!object(v)) throw new Error('Invalid native Domains finding.');
    for (const f of ['rule_id','severity','observation','confidence','calibration_consequence','recommended_action']) text(v[f],f);
    if (!Array.isArray(v.evidence) || v.evidence.some((x) => typeof x !== 'string')) throw new Error('Invalid native Domains finding evidence.');
    const matches = (v.evidence as string[]).map((id) => ({ identity:{metric_id:id,native_context:clone(c)}, metrics:metrics.filter((m) => m.metric_id === id) }));
    return { ...clone(v), rule_id:v.rule_id as string, severity:v.severity as string, confidence:v.confidence as string,
      message:v.observation as string, action:v.recommended_action as string, evidence:[...v.evidence] as string[],
      confidence_status:'unknown',kind:'heuristic_signature',evidenceIdentities:[], evidenceMatches:matches,
      unresolvedEvidence:matches.filter((m) => m.metrics.length === 0).map((m) => m.identity.metric_id),
      evidence_coverage:null,signal_strength:null,original_finding:clone(v) };
  });
  const fit = object(report.fit) ? report.fit : {};
  const reps = object(report.representations) ? report.representations : {};
  const selected = object(reps.selected_population) ? reps.selected_population : {};
  const train = ids(selected.train_observation_ids), test = ids(selected.test_observation_ids), fitted = ids(fit.fit_observation_ids);
  const ready = fit.fit_partition === 'train' && digest(fit.fit_x_sha256) && fitted !== null && fitted.length > 0 && train !== null && test !== null && stable(fitted) === stable(train) && !train.some((id) => test.includes(id));
  return { adapterVersion:2,wireFormat:'domains_report_v1',producer:'domains',declaredProducer:'nirs4all-domains',
    engineVersion,protocolVersion:report.protocol_version as string,status,context:null,contextBinding:'external',
    nativeTaskContext:{context:c,sanitized_task_sha256:digest(report.provenance.sanitized_task_sha256)?report.provenance.sanitized_task_sha256:null,
      fit_partition:typeof fit.fit_partition==='string'?fit.fit_partition:null,fit_x_sha256:digest(fit.fit_x_sha256)?fit.fit_x_sha256:null,
      fit_observation_ids:fitted,train_observation_ids:train,test_observation_ids:test,
      reference_status:ready?'declared':'unavailable',reference_reason:ready?null:'NO_MATCHING_DISJOINT_DECLARED_TRAIN_REFERENCE_AND_EVALUATION_IDENTITIES'},
    metrics,findings,limitations:[...report.limitations] as string[],report:clone(report),envelope:clone(report) };
}
/** Compare only explicit owner context, task fingerprint, frozen train reference
 * and evaluation identities. A content version is never relabelled a hash. */
export function domainsComparisonIdentity(a: SharedAssessment): string | null {
  const c=a.nativeTaskContext;
  if (a.wireFormat!=='domains_report_v1'||!c||c.reference_status!=='declared'||!c.sanitized_task_sha256||!c.test_observation_ids?.length) return null;
  return stable({nativeContext:c,protocol:a.protocolVersion,policy:a.report.policy,test_target_accessed:a.report.test_target_accessed,representations:a.report.representations});
}
