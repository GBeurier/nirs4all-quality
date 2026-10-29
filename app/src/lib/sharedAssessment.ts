/** Optional consumer adapter for the existing Preflight QualificationReport v1.
 * Domains may provide the same envelope explicitly. No runtime dependency or
 * scientific recomputation: upstream identities, availability and provenance
 * remain attached to every value and finding. */
export type Availability = 'computed' | 'not_applicable' | 'insufficient_data' | 'unsupported' | 'not_identifiable' | 'undefined' | 'cancelled' | 'error';
export interface SharedMetric {
  metric_id: string; protocol_version: string; status: Availability;
  reason_code: string | null; scope: string; source_id: string | null;
  target_id: string | null; view_id: string; population_id: string;
  value: unknown; unit: string | null; denominators: Record<string, unknown>;
  parameters: Record<string, unknown>; [key: string]: unknown;
}
export interface SharedFinding {
  rule_id: string; severity: string; confidence: string; evidence: string[];
  message: string; action: string; [key: string]: unknown;
}
export interface SharedAssessment {
  adapterVersion: 1;
  producer: 'preflight' | 'domains';
  engineVersion: string;
  protocolVersion: string;
  status: string;
  metrics: SharedMetric[];
  findings: SharedFinding[];
  limitations: string[];
  /** Lossless cloned original report, including capabilities/validation/context. */
  report: Record<string, unknown>;
}
const states: Availability[] = ['computed', 'not_applicable', 'insufficient_data', 'unsupported', 'not_identifiable', 'undefined', 'cancelled', 'error'];
const object = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
function text(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.length) throw new Error(`Missing assessment ${field}.`);
  return value;
}
function finiteJson(value: unknown): void {
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Assessment values must be finite JSON numbers.');
  if (Array.isArray(value)) value.forEach(finiteJson);
  else if (object(value)) Object.values(value).forEach(finiteJson);
}

export function adaptSharedAssessment(input: unknown, producer: 'preflight' | 'domains' = 'preflight'): SharedAssessment {
  if (!object(input) || input.schema_version !== 1) throw new Error('Only QualificationReport schema_version 1 is supported.');
  finiteJson(input);
  const report = JSON.parse(JSON.stringify(input)) as Record<string, unknown>;
  const engineVersion = text(report.engine_version, 'engine_version');
  const protocolVersion = text(report.protocol_bundle_version, 'protocol_bundle_version');
  const status = text(report.status, 'status');
  if (!Array.isArray(report.metrics) || !Array.isArray(report.findings) || !Array.isArray(report.limitations)) throw new Error('Assessment metrics, findings and limitations must be arrays.');
  const keys = new Set<string>();
  const metrics = report.metrics.map((value): SharedMetric => {
    if (!object(value)) throw new Error('Invalid assessment metric.');
    for (const field of ['metric_id', 'protocol_version', 'scope', 'view_id', 'population_id']) text(value[field], field);
    for (const field of ['source_id', 'target_id', 'reason_code', 'unit']) if (value[field] !== null && typeof value[field] !== 'string') throw new Error(`Invalid metric ${field}.`);
    if (!states.includes(value.status as Availability) || !object(value.denominators) || !object(value.parameters)) throw new Error('Invalid metric availability or provenance.');
    if (value.status === 'computed' && value.value == null) throw new Error('A computed metric must contain its value.');
    const key = JSON.stringify(['metric_id', 'source_id', 'target_id', 'view_id', 'population_id', 'context_id', 'protocol_version'].map((field) => value[field] ?? null));
    if (keys.has(key)) throw new Error('Duplicate metric context identity.');
    keys.add(key);
    return value as unknown as SharedMetric;
  });
  const findings = report.findings.map((value): SharedFinding => {
    if (!object(value)) throw new Error('Invalid assessment finding.');
    for (const field of ['rule_id', 'severity', 'confidence', 'message', 'action']) text(value[field], field);
    if (!Array.isArray(value.evidence) || value.evidence.some((v) => typeof v !== 'string')) throw new Error('Finding evidence must contain metric references.');
    return value as unknown as SharedFinding;
  });
  if (report.limitations.some((value) => typeof value !== 'string')) throw new Error('Invalid assessment limitations.');
  return { adapterVersion: 1, producer, engineVersion, protocolVersion, status, metrics, findings, limitations: report.limitations as string[], report };
}
