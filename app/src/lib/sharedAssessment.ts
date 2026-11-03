import { adaptDomainsReport, domainsComparisonIdentity } from './domainsReport';
/** Versioned optional consumer of owner-produced reports. No scientific metrics
 * are recomputed; the native report, availability and evidence remain intact. */
export type Availability = 'computed' | 'not_applicable' | 'insufficient_data' | 'unsupported' | 'not_identifiable' | 'undefined' | 'cancelled' | 'error' | 'unavailable';
export type ConfidenceStatus = 'unknown' | 'unvalidated' | 'validated';
export type EvidenceKind = 'measured_observation' | 'heuristic_signature' | 'possible_cause';
export interface AssessmentContext {
  dataset_id: string; content_hash: string; producer: string; source_id: string;
  population_id: string; context_id: string; scope: 'intrinsic' | 'task';
  target_id: string | null; split_id: string | null;
  fit_population_id: string | null; evaluation_population_id: string | null;
}
export interface SharedMetric {
  metric_id: string; protocol_version: string; status: Availability;
  reason_code: string | null; scope: string; source_id: string | null;
  target_id: string | null; view_id: string; population_id: string;
  value: unknown; unit: string | null; denominators: Record<string, unknown>;
  parameters: unknown; availability?: 'available' | 'unavailable' | 'not_applicable';
  native_status?: Availability; metric_context_id?: string | null; native_metric?: Record<string, unknown>;
  kind?: EvidenceKind; confidence_status?: ConfidenceStatus;
  evidence_coverage?: number | null; signal_strength?: number | null;
  [key: string]: unknown;
}
export interface MetricIdentity {
  metric_id: string; source_id: string | null; target_id: string | null;
  view_id: string; population_id: string; context_id: string; protocol_version: string; metric_context_id?: string | null;
}
interface NativeFinding {
  rule_id: string; severity: string; confidence: string; evidence: string[];
  message: string; action: string; [key: string]: unknown;
}
export interface SharedFinding {
  rule_id: string; severity: string; confidence: string; evidence: string[];
  message: string; action: string; confidence_status: ConfidenceStatus;
  kind: EvidenceKind; evidenceIdentities: MetricIdentity[]; unresolvedEvidence: string[];
  evidence_coverage: number | null; signal_strength: number | null;
  evidenceMatches: { identity: MetricIdentity | { metric_id: string; native_context: Record<string, unknown> }; metrics: SharedMetric[] }[];
  [key: string]: unknown;
}
export interface SharedAssessment {
  adapterVersion: 2;
  wireFormat: 'qualification_report_v1' | 'assessment_v1' | 'domains_report_v1';
  nativeTaskContext?: {
    context: Record<string, unknown>; sanitized_task_sha256: string | null;
    fit_partition: string | null; fit_x_sha256: string | null;
    fit_observation_ids: string[] | null; train_observation_ids: string[] | null; test_observation_ids: string[] | null;
    reference_status: 'declared' | 'unavailable'; reference_reason: string | null;
  };
  producer: 'preflight' | 'domains' | 'methods';
  declaredProducer: string | null;
  engineVersion: string; protocolVersion: string; status: string;
  context: AssessmentContext | null;
  /** A report without an independently supplied matching context is external. */
  contextBinding: 'matched' | 'external';
  metrics: SharedMetric[]; findings: SharedFinding[]; limitations: string[];
  report: Record<string, unknown>;
  /** Complete input envelope; report is the exact nested native report. */
  envelope: Record<string, unknown>;
}
export interface AssessmentOptions {
  expectedContext?: AssessmentContext | undefined;
  /** Actual output of the owner's separate extract_findings API. */
  findings?: unknown;
}
const states: Availability[] = ['computed', 'not_applicable', 'insufficient_data', 'unsupported', 'not_identifiable', 'undefined', 'cancelled', 'error'];
const kinds: EvidenceKind[] = ['measured_observation', 'heuristic_signature', 'possible_cause'];
const confidences: ConfidenceStatus[] = ['unknown', 'unvalidated', 'validated'];
const object = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
function text(v: unknown, field: string): string {
  if (typeof v !== 'string' || !v.trim()) throw new Error(`Missing assessment ${field}.`);
  return v;
}
function nullableText(v: unknown, field: string): string | null {
  if (v === null) return null;
  return text(v, field);
}
function finiteJson(v: unknown): void {
  if (typeof v === 'number' && !Number.isFinite(v)) throw new Error('Assessment values must be finite JSON numbers.');
  if (Array.isArray(v)) v.forEach(finiteJson);
  else if (object(v)) Object.values(v).forEach(finiteJson);
}
function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`;
  if (object(v)) return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(',')}}`;
  return JSON.stringify(v) ?? 'null';
}
function semantics(v: Record<string, unknown>): void {
  if (!kinds.includes(v.kind as EvidenceKind) || !confidences.includes(v.confidence_status as ConfidenceStatus)) throw new Error('Unsupported evidence semantics.');
  for (const field of ['evidence_coverage', 'signal_strength']) {
    const n = v[field];
    if (n !== null && (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 1)) throw new Error(`Invalid ${field}.`);
  }
  if (v.kind === 'possible_cause' && v.confidence_status === 'validated') throw new Error('A possible cause needs separate external validation.');
}
function contextOf(v: Record<string, unknown>): AssessmentContext {
  v = { ...v };
  // Owner context inputs omit serde Option fields; absence remains None.
  for (const f of ['target_id','split_id','fit_population_id','evaluation_population_id']) if (v[f] === undefined) v[f] = null;
  for (const f of ['dataset_id', 'content_hash', 'producer', 'source_id', 'population_id', 'context_id']) text(v[f], f);
  if (!/^(sha256:)?[a-f\d]{64}$/i.test(v.content_hash as string)) throw new Error('Invalid assessment content_hash.');
  for (const f of ['target_id', 'split_id', 'fit_population_id', 'evaluation_population_id']) nullableText(v[f], f);
  if (!['nirs4all-preflight', 'nirs4all-domains', 'nirs4all-methods'].includes(v.producer as string)) throw new Error('Unsupported declared assessment producer.');
  if (v.scope === 'intrinsic') {
    if (v.fit_population_id !== null || v.evaluation_population_id !== null || v.split_id !== null) throw new Error('Intrinsic assessment cannot contain task fit/evaluation context.');
  } else if (v.scope === 'task') {
    if (v.producer === 'nirs4all-preflight' || !v.fit_population_id || !v.evaluation_population_id || !v.split_id || v.fit_population_id === v.evaluation_population_id) throw new Error('Task assessment needs distinct fit/evaluation populations, a split and a task producer.');
  } else throw new Error('Unsupported assessment scope.');
  const fields = ['dataset_id','content_hash','producer','source_id','population_id','context_id','scope','target_id','split_id','fit_population_id','evaluation_population_id'];
  return Object.fromEntries(fields.map((f) => [f, v[f]])) as unknown as AssessmentContext;
}
function contextKey(c: AssessmentContext): string {
  return stable({ ...c, content_hash: c.content_hash.replace(/^sha256:/, '').toLowerCase() });
}
function metricContextId(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v !== 'string' || !/^sha256:[a-f\d]{64}$/i.test(v)) throw new Error('Invalid opaque metric_context_id.');
  return v;
}
function metricIdentity(v: Record<string, unknown>): string {
  return stable([...['metric_id','source_id','target_id','view_id','population_id','context_id','protocol_version'].map((f) => v[f] ?? null), v.parameters ?? null, v.denominators ?? null, v.native_context ?? null]);
}
function nativeReport(report: Record<string, unknown>, allowComputedMissing = false): { metrics: SharedMetric[]; findings: NativeFinding[]; limitations: string[] } {
  if (report.schema_version !== 1) throw new Error('Unsupported native QualificationReport schema_version.');
  for (const f of ['engine_version','protocol_bundle_version','status']) text(report[f], f);
  if (!Array.isArray(report.metrics) || !Array.isArray(report.findings) || !Array.isArray(report.limitations)) throw new Error('Assessment metrics, findings and limitations must be arrays.');
  const keys = new Set<string>();
  const metrics = report.metrics.map((v): SharedMetric => {
    if (!object(v)) throw new Error('Invalid assessment metric.');
    for (const f of ['metric_id','protocol_version','scope','view_id','population_id']) text(v[f], f);
    for (const f of ['source_id','target_id','reason_code','unit']) if (v[f] !== null && typeof v[f] !== 'string') throw new Error(`Invalid native metric ${f}.`);
    if (!states.includes(v.status as Availability) || !object(v.denominators) || !object(v.parameters)) throw new Error('Invalid metric availability or provenance.');
    if (!allowComputedMissing && v.status === 'computed' && v.value == null) throw new Error('A computed metric must contain its value.');
    const key = metricIdentity(v);
    if (keys.has(key)) throw new Error('Duplicate metric context identity.');
    keys.add(key);
    return v as unknown as SharedMetric;
  });
  const findings = report.findings.map((v): NativeFinding => {
    if (!object(v)) throw new Error('Invalid assessment finding.');
    for (const f of ['rule_id','severity','confidence','message','action']) text(v[f], f);
    if (!Array.isArray(v.evidence) || v.evidence.some((x) => typeof x !== 'string')) throw new Error('Finding evidence must contain metric references.');
    return v as unknown as NativeFinding;
  });
  if (report.limitations.some((v) => typeof v !== 'string')) throw new Error('Invalid assessment limitations.');
  return { metrics, findings, limitations: report.limitations as string[] };
}
function legacyFindings(rows: NativeFinding[]): SharedFinding[] {
  return rows.map((v) => ({ ...v, confidence_status: 'unknown', kind: 'heuristic_signature', evidenceIdentities: [], evidenceMatches: [], unresolvedEvidence: [...v.evidence as string[]], evidence_coverage: null, signal_strength: null }) as SharedFinding);
}
function projectedFindings(input: unknown, c: AssessmentContext, reportMetrics: SharedMetric[], reportFindings: NativeFinding[], assessmentMetrics: SharedMetric[]): SharedFinding[] {
  if (!Array.isArray(input)) throw new Error('Owner-projected findings must be an array.');
  return input.map((v): SharedFinding => {
    if (!object(v) || v.context_id !== c.context_id || !object(v.original_finding)) throw new Error('Finding context/provenance does not match assessment.');
    semantics(v);
    if (!reportFindings.some((f) => stable(f) === stable(v.original_finding))) throw new Error('Finding original is absent from native report.');
    const original = v.original_finding;
    if (['rule_id','severity','message'].some((f) => v[f] !== original[f]) || v.recommended_action !== original.action) throw new Error('Finding projection differs from native finding.');
    for (const f of ['rule_id','severity','message','recommended_action']) text(v[f], f);
    if (!Array.isArray(v.evidence) || !Array.isArray(v.unresolved_evidence) || v.unresolved_evidence.some((x) => typeof x !== 'string')) throw new Error('Invalid finding evidence.');
    const evidence = v.evidence.map((e): MetricIdentity => {
      if (!object(e)) throw new Error('Invalid finding evidence identity.');
      metricContextId(e.metric_context_id);
      if (!(original.evidence as string[]).includes(e.metric_id as string)) throw new Error('Finding evidence differs from original references.');
      for (const f of ['metric_id','view_id','population_id','context_id','protocol_version']) text(e[f], f);
      nullableText(e.source_id, 'source_id'); nullableText(e.target_id, 'target_id');
      if (e.context_id !== c.context_id || e.population_id !== c.population_id || e.target_id !== c.target_id || (e.source_id !== null && e.source_id !== c.source_id)) throw new Error('Finding evidence crosses assessment context.');
      if (!reportMetrics.some((m) => ['metric_id','source_id','target_id','view_id','population_id','protocol_version'].every((f) => m[f] === e[f]))) throw new Error('Finding references absent native metric evidence.');
      return e as unknown as MetricIdentity;
    });
    const originalReferences = original.evidence as string[];
    if ((v.unresolved_evidence as string[]).some((id) => !originalReferences.includes(id)) ||
      originalReferences.some((id) => !evidence.some((e) => e.metric_id === id) && !(v.unresolved_evidence as string[]).includes(id))) {
      throw new Error('Finding projection drops or invents native evidence references.');
    }
    return { ...v, evidenceMatches: evidence.map((identity) => {
      const base = reportMetrics.filter((m) => ['metric_id','source_id','target_id','view_id','population_id','protocol_version'].every((f) => m[f] === identity[f as keyof MetricIdentity]));
      const qualified = identity.metric_context_id == null ? [] : assessmentMetrics.filter((m) => m.metric_context_id === identity.metric_context_id && base.some((raw) => stable(raw) === stable(m.native_metric)));
      // A supplied opaque identity must resolve through the preserved Assessment
      // context. Never fall back to another parameter context when it is absent.
      return { identity, metrics: identity.metric_context_id == null ? base : base.filter((raw) => qualified.some((m) => stable(raw) === stable(m.native_metric))) };
    }), confidence: v.confidence_status as string, evidence: evidence.map((e) => e.metric_id), evidenceIdentities: evidence, unresolvedEvidence: v.unresolved_evidence as string[], action: v.recommended_action as string } as SharedFinding;
  });
}
export function adaptSharedAssessment(input: unknown, producer: 'preflight' | 'domains' = 'preflight', options: AssessmentOptions = {}): SharedAssessment {
  if (!object(input)) throw new Error('Assessment must be an object.');
  finiteJson(input); finiteJson(options.findings);
  const envelope = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  if (envelope.schema_version === 1 && typeof envelope.protocol_version === 'string' && envelope.protocol_version.startsWith('domains.canonical.')) {
    if (options.expectedContext !== undefined || options.findings !== undefined) throw new Error('Native Domains reports have a distinct context/finding profile; they are not Assessment envelopes.');
    return adaptDomainsReport(envelope);
  }
  if (envelope.schema_version === 1) {
    if (options.expectedContext !== undefined || options.findings !== undefined) throw new Error('Legacy reports lack a qualified assessment context.');
    const native = nativeReport(envelope);
    return { adapterVersion: 2, wireFormat: 'qualification_report_v1', producer, declaredProducer: null, context: null, contextBinding: 'external', engineVersion: envelope.engine_version as string, protocolVersion: envelope.protocol_bundle_version as string, status: envelope.status as string, ...native, metrics: JSON.parse(JSON.stringify(native.metrics)) as SharedMetric[], findings: legacyFindings(JSON.parse(JSON.stringify(native.findings)) as NativeFinding[]), report: envelope, envelope };
  }
  // The original owner extraction uses "1"; Assessment1.0 uses the explicit
  // minor-version spelling. Integer1 always denotes the separate native report.
  if (envelope.schema_version !== '1' && envelope.schema_version !== '1.0') throw new Error('Unsupported Assessment schema_version.');
  const context = contextOf(envelope);
  if (options.expectedContext !== undefined && !object(options.expectedContext)) throw new Error('Expected context must be an object.');
  if (options.expectedContext && contextKey(context) !== contextKey(contextOf(options.expectedContext as unknown as Record<string, unknown>))) throw new Error('Assessment does not match the independently supplied dataset/source/fit/evaluation context.');
  if (!object(envelope.report) || !Array.isArray(envelope.metrics)) throw new Error('Missing native report/assessment metrics.');
  const report = envelope.report, native = nativeReport(report, true);
  const engineVersion = text(envelope.engine_version, 'engine_version'), protocolVersion = text(envelope.protocol_version, 'protocol_version');
  if (engineVersion !== report.engine_version || protocolVersion !== report.protocol_bundle_version) throw new Error('Assessment producer versions differ from native report.');
  const keys = new Set<string>();
  const opaqueContexts = new Map<string, string>();
  const metrics = envelope.metrics.map((v): SharedMetric => {
    if (!object(v) || !object(v.native_metric)) throw new Error('Missing exact native metric provenance.');
    semantics(v);
    const opaque = metricContextId(v.metric_context_id);
    const m = v.native_metric;
    const originalMetric = native.metrics.find((original) => stable(original) === stable(m));
    if (!originalMetric) throw new Error('Assessment metric is absent or differs from its native report.');
    if (m.source_id !== context.source_id || m.target_id !== context.target_id || m.population_id !== context.population_id) throw new Error('Assessment metric crosses source/target/population context.');
    for (const f of ['metric_id','protocol_version','view_id','unit','native_status']) {
      if (v[f] !== m[f === 'native_status' ? 'status' : f]) throw new Error(`Assessment ${f} differs from native metric.`);
    }
    const scalar = m.status === 'computed' && typeof m.value === 'number';
    const availability = scalar ? 'available' : m.status === 'not_applicable' ? 'not_applicable' : 'unavailable';
    if (v.availability !== availability || v.value !== (scalar ? m.value : null)) throw new Error('Assessment availability/value differs from native evidence.');
    const reason = m.status === 'computed' && !scalar ? 'NON_SCALAR_OR_MISSING_NATIVE_VALUE' : m.reason_code;
    if (v.reason_code !== reason) throw new Error('Assessment missing-evidence reason differs from native evidence.');
    const metricContext = typeof m.context_id === 'string' ? m.context_id : context.context_id;
    const key = metricIdentity({ ...m, context_id: metricContext });
    if (keys.has(key)) throw new Error('Duplicate metric context identity.'); keys.add(key);
    if (opaque !== null) {
      const namespace = stable(['metric_id','source_id','target_id','view_id','population_id','protocol_version'].map((f) => m[f] ?? null).concat([metricContext, opaque]));
      const exact = stable({ parameters: m.parameters, denominators: m.denominators });
      if (opaqueContexts.has(namespace) && opaqueContexts.get(namespace) !== exact) throw new Error('Opaque metric_context_id hides distinct native parameter/denominator contexts.');
      opaqueContexts.set(namespace, exact);
    }
    return { ...originalMetric, ...v, parameters: originalMetric.parameters, denominators: originalMetric.denominators, status: originalMetric.status, scope: originalMetric.scope, source_id: context.source_id, target_id: context.target_id, population_id: context.population_id, context_id: metricContext } as SharedMetric;
  });
  const declaredProducer = context.producer;
  const findings = options.findings === undefined ? legacyFindings(native.findings) : projectedFindings(JSON.parse(JSON.stringify(options.findings)), context, native.metrics, native.findings, metrics);
  return { adapterVersion: 2, wireFormat: 'assessment_v1', producer: declaredProducer === 'nirs4all-domains' ? 'domains' : declaredProducer === 'nirs4all-methods' ? 'methods' : 'preflight', declaredProducer, engineVersion, protocolVersion, status: report.status as string, context, contextBinding: options.expectedContext ? 'matched' : 'external', metrics: JSON.parse(JSON.stringify(metrics)) as SharedMetric[], findings: JSON.parse(JSON.stringify(findings)) as SharedFinding[], limitations: native.limitations, report, envelope };
}
export function metricAvailable(metric: SharedMetric): boolean {
  return metric.availability === undefined ? metric.status === 'computed' : metric.availability === 'available';
}
export interface AssessmentComparison { comparable: boolean; reason: string | null; pairs: { identity: string; left: SharedMetric; right: SharedMetric }[]; }
/** Compare existing owner values only within the same complete scientific context. */
export function compareSharedAssessments(left: SharedAssessment, right: SharedAssessment): AssessmentComparison {
  if (left.wireFormat === 'domains_report_v1' || right.wireFormat === 'domains_report_v1') {
    const l = domainsComparisonIdentity(left), r = domainsComparisonIdentity(right);
    if (l === null || r === null || l !== r) return { comparable: false, reason: 'Native Domains data/context/reference/evaluation identity differs or is unavailable.', pairs: [] };
  } else if (!left.context || !right.context || contextKey(left.context) !== contextKey(right.context)) return { comparable: false, reason: 'Dataset/source/population/context/split/fit/evaluation identity differs or is unavailable.', pairs: [] };
  if (left.protocolVersion !== right.protocolVersion) return { comparable: false, reason: 'Assessment protocol versions differ.', pairs: [] };
  const pairs: AssessmentComparison['pairs'] = [];
  for (const l of left.metrics) {
    const r = right.metrics.find((m) => metricIdentity(m) === metricIdentity(l));
    if (r && l.unit === r.unit && stable(l.parameters) === stable(r.parameters) && stable(l.denominators) === stable(r.denominators)) pairs.push({ identity: metricIdentity(l), left: l, right: r });
  }
  return { comparable: true, reason: null, pairs };
}
