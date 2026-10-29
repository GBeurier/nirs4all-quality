import assert from 'node:assert/strict';
import { test } from 'node:test';
import owner from './fixtures/assessment/preflight-assessment-v1.json';
import ownerFindings from './fixtures/assessment/preflight-findings-v1.json';
import native from './fixtures/assessment/preflight-native-assessment-v1.json';
import nativeFindings from './fixtures/assessment/preflight-native-findings-v1.json';
import nativeContext from './fixtures/assessment/preflight-native-context-v1.json';
import domains from './fixtures/assessment/domains-translation-report-v1.json';
import repeats from './fixtures/assessment/domains-repeats-report-v1.json';
import preflight011 from './fixtures/assessment/preflight-011/assessment.json';
import findings011 from './fixtures/assessment/preflight-011/findings.json';
import context011 from './fixtures/assessment/preflight-011/context.json';
import native011 from './fixtures/assessment/preflight-native-011-assessment.json';
import owner011 from './fixtures/assessment/preflight-owner-011-assessment.json';
import ownerFindings011 from './fixtures/assessment/preflight-owner-011-findings.json';
import { adaptSharedAssessment, compareSharedAssessments, metricAvailable, type AssessmentContext } from '../src/lib/sharedAssessment';
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const context = nativeContext as AssessmentContext;

test('source-bound Preflight0.1.1 CLI assessment imports all95 native metrics and separate findings', () => {
  const actual=adaptSharedAssessment(preflight011,'preflight',{findings:findings011,expectedContext:context011 as AssessmentContext});
  assert.equal(actual.contextBinding,'matched'); assert.equal(actual.metrics.length,95);
  assert.deepEqual(actual.report,preflight011.report); assert.deepEqual(actual.envelope,preflight011);
  assert.equal(actual.findings.length,findings011.length);
  for(const m of actual.metrics) assert.match(m.metric_context_id!,/^sha256:[a-f0-9]{64}$/);
  for(const f of actual.findings) for(const e of f.evidenceIdentities) assert.match(e.metric_context_id!,/^sha256:[a-f0-9]{64}$/);
  const compared=compareSharedAssessments(actual,adaptSharedAssessment(clone(preflight011)));
  assert.ok(compared.comparable); assert.equal(compared.pairs.length,95);
});
test('actual owner0.1.1 factor identities and finding evidence resolve without collisions', () => {
  const actual=adaptSharedAssessment(native011);
  const factors=actual.metrics.filter(m=>m.metric_id==='domain_shift.design');
  assert.equal(factors.length,2); assert.notEqual(factors[0]!.metric_context_id,factors[1]!.metric_context_id);
  const found=adaptSharedAssessment(owner011,'preflight',{findings:ownerFindings011});
  assert.ok(found.findings.some(f=>f.evidenceIdentities.length>0),'must exercise actual qualified evidence');
  for(const f of found.findings) for(const e of f.evidenceMatches) {
    assert.equal(e.metrics.length,1); assert.equal(e.metrics[0]!.metric_id,e.identity.metric_id);
  }
  const missing=clone(ownerFindings011);
  for(const f of missing) for(const e of f.evidence) e.metric_context_id='sha256:'+'f'.repeat(64);
  const unresolved=adaptSharedAssessment(owner011,'preflight',{findings:missing});
  assert.ok(unresolved.findings.some(f=>f.evidenceMatches.length>0));
  for(const f of unresolved.findings) for(const e of f.evidenceMatches) assert.equal(e.metrics.length,0,'an absent opaque context cannot resolve to a different native measure');
  const dropped=clone(ownerFindings011);dropped.forEach(f=>{f.evidence=[];f.unresolved_evidence=[]});
  assert.throws(()=>adaptSharedAssessment(owner011,'preflight',{findings:dropped}),/drops or invents/);
  const invented=clone(ownerFindings011);invented[0]!.unresolved_evidence.push('invented.metric');
  assert.throws(()=>adaptSharedAssessment(owner011,'preflight',{findings:invented}),/drops or invents/);
});

test('actual owner native assessment retains all22 metrics, raw fields and unavailable values', () => {
  const out = adaptSharedAssessment(native);
  assert.equal(out.wireFormat, 'assessment_v1'); assert.equal(out.declaredProducer, 'nirs4all-preflight');
  assert.equal(out.metrics.length, 22); assert.deepEqual(out.report, native.report);
  assert.deepEqual(out.envelope, native); assert.equal(out.contextBinding, 'external');
  for (const metric of out.metrics) {
    const original = native.metrics.find((m) => m.metric_id === metric.metric_id && JSON.stringify(m.native_metric.parameters) === JSON.stringify(metric.parameters));
    assert.ok(original); assert.equal(metric.value, original.value);
    assert.equal(metric.availability, original.availability); assert.equal(metric.reason_code, original.reason_code);
  }
});
test('integer report1 and string Assessment1 are distinct versioned shapes', () => {
  const report = adaptSharedAssessment(owner.report);
  assert.equal(report.wireFormat, 'qualification_report_v1'); assert.equal(report.context, null);
  assert.equal(adaptSharedAssessment(owner).wireFormat, 'assessment_v1');
  assert.equal(adaptSharedAssessment({ ...owner, schema_version: '1.0' }).wireFormat, 'assessment_v1');
  for (const version of [0, 2, '1.1', '2', null]) assert.throws(() => adaptSharedAssessment({ ...owner, schema_version: version }));
  assert.throws(() => adaptSharedAssessment({ ...owner, schema_version: 1 }));
});
test('no producer selector overrides an owner-declared producer', () => {
  assert.equal(adaptSharedAssessment(owner, 'domains').producer, 'preflight');
  const data = { ...owner, producer: 'nirs4all-domains' };
  assert.equal(adaptSharedAssessment(data, 'preflight').producer, 'domains');
});
test('native evidence parameters preserve the two real domain_shift.design factors', () => {
  const out = adaptSharedAssessment(native);
  const factors = out.metrics.filter((m) => m.metric_id === 'domain_shift.design');
  assert.equal(factors.length, 2);
  assert.deepEqual(factors.map((m) => m.parameters.factor).sort(), ['campaign','instrument']);
  const reordered = clone(native); reordered.metrics.reverse();
  const compared = compareSharedAssessments(out, adaptSharedAssessment(reordered));
  assert.ok(compared.comparable);
  assert.equal(compared.pairs.filter((m) => m.left.metric_id === 'domain_shift.design').length, 2);
  for (const p of compared.pairs) assert.deepEqual(p.left.parameters, p.right.parameters);
});
test('truly duplicated same-parameter slots are rejected, never overwritten', () => {
  const data = clone(native); data.metrics.push(clone(data.metrics[0]!));
  assert.throws(() => adaptSharedAssessment(data), /Duplicate/);
  const report = clone(owner.report); report.metrics.push(clone(report.metrics[0]!));
  assert.throws(() => adaptSharedAssessment(report), /Duplicate/);
});
test('native projected findings retain unknown confidence, all context identities and raw evidence', () => {
  const out = adaptSharedAssessment(owner, 'preflight', { findings: ownerFindings });
  assert.equal(out.findings.length, ownerFindings.length);
  assert.equal(out.findings[0]!.confidence_status, 'unknown');
  assert.deepEqual(out.findings[0]!.evidenceIdentities, ownerFindings[0]!.evidence);
  assert.deepEqual(out.findings[0]!.original_finding, ownerFindings[0]!.original_finding);
  const actual = adaptSharedAssessment(native, 'preflight', { findings: nativeFindings });
  assert.equal(actual.findings.length, nativeFindings.length);
});
test('unprojected legacy confidence labels are never promoted to qualified confidence', () => {
  const report = clone(owner.report); report.findings[0]!.confidence = 'high';
  const out = adaptSharedAssessment(report);
  assert.equal(out.findings[0]!.confidence, 'high'); assert.equal(out.findings[0]!.confidence_status, 'unknown');
  assert.equal(out.findings[0]!.evidence_coverage, null); assert.ok(out.findings[0]!.unresolvedEvidence.length);
});
test('binding checks the independent full context and canonical hash prefix', () => {
  assert.equal(adaptSharedAssessment(native, 'preflight', { expectedContext: context }).contextBinding, 'matched');
  const prefixed = { ...context, content_hash: 'sha256:' + context.content_hash };
  assert.equal(adaptSharedAssessment(native, 'preflight', { expectedContext: prefixed }).contextBinding, 'matched');
});
for (const field of ['dataset_id','content_hash','source_id','population_id','context_id','target_id'] as const) test(`independent binding refuses mismatched ${field}`, () => {
  const expected = { ...context, [field]: field === 'content_hash' ? 'f'.repeat(64) : 'different' };
  assert.throws(() => adaptSharedAssessment(native, 'preflight', { expectedContext: expected as AssessmentContext }));
});
test('task scope requires distinct explicit fit/evaluation populations and split', () => {
  const task = { ...owner, producer: 'nirs4all-domains', scope: 'task', fit_population_id:'train', evaluation_population_id:'heldout', split_id:'split:1' };
  const a = adaptSharedAssessment(task);
  assert.equal(a.context!.fit_population_id, 'train'); assert.equal(a.context!.evaluation_population_id, 'heldout');
  assert.throws(() => adaptSharedAssessment({ ...task, fit_population_id:'heldout' }));
  assert.throws(() => adaptSharedAssessment({ ...task, split_id:null }));
  assert.throws(() => adaptSharedAssessment({ ...task, producer:'nirs4all-preflight' }));
  assert.throws(() => adaptSharedAssessment({ ...owner, fit_population_id:'train' }));
  for (const patch of [{ fit_population_id:'other' }, { evaluation_population_id:'other' }, { split_id:'other' }]) {
    const b = adaptSharedAssessment({ ...task, ...patch }); assert.equal(compareSharedAssessments(a,b).comparable,false);
  }
});
test('schema availability retains zero and distinguishes available/unavailable/non-scalar', () => {
  const data = clone(owner);
  const m = data.metrics[0]!; m.value=0; m.native_metric.value=0; data.report.metrics[0]!.value=0;
  const out=adaptSharedAssessment(data); assert.equal(out.metrics[0]!.value,0); assert.ok(metricAvailable(out.metrics[0]!));
  assert.equal(out.metrics[1]!.value,null); assert.equal(metricAvailable(out.metrics[1]!),false);
  const nonscalar=clone(owner); const value={ values:[1,2] };
  Object.assign(nonscalar.metrics[0]!,{value:null,availability:'unavailable',reason_code:'NON_SCALAR_OR_MISSING_NATIVE_VALUE'});
  Object.assign(nonscalar.metrics[0]!.native_metric,{value}); Object.assign(nonscalar.report.metrics[0]!,{value});
  assert.equal(adaptSharedAssessment(nonscalar).metrics[0]!.value,null);
  assert.deepEqual(adaptSharedAssessment(nonscalar).metrics[0]!.native_metric!.value,value);
});
test('unavailable native values and missing computed values are never fabricated', () => {
  const missing=clone(owner);
  Object.assign(missing.metrics[0]!,{value:null,availability:'unavailable',reason_code:'NON_SCALAR_OR_MISSING_NATIVE_VALUE'});
  Object.assign(missing.metrics[0]!.native_metric,{value:null}); Object.assign(missing.report.metrics[0]!,{value:null});
  assert.equal(adaptSharedAssessment(missing).metrics[0]!.availability,'unavailable');
  const forged=clone(owner); forged.metrics[1]!.availability='available'; forged.metrics[1]!.value=0;
  assert.throws(()=>adaptSharedAssessment(forged));
});
test('scalar and native provenance mismatch is refused before any comparison', () => {
  const data=clone(owner); data.metrics[0]!.value=999; assert.throws(()=>adaptSharedAssessment(data));
  const forged=clone(owner); forged.metrics[0]!.native_metric.value=999; forged.metrics[0]!.value=999; assert.throws(()=>adaptSharedAssessment(forged));
  assert.throws(()=>adaptSharedAssessment({...owner,engine_version:'forged'}));
});
test('projected findings reject cross-context and forged original evidence', () => {
  const wrong=clone(ownerFindings); wrong[0]!.context_id='different'; assert.throws(()=>adaptSharedAssessment(owner,'preflight',{findings:wrong}));
  const wrongSource=clone(ownerFindings); wrongSource[0]!.evidence[0]!.source_id='different'; assert.throws(()=>adaptSharedAssessment(owner,'preflight',{findings:wrongSource}));
  const forged=clone(ownerFindings); forged[0]!.message='invented'; assert.throws(()=>adaptSharedAssessment(owner,'preflight',{findings:forged}));
});
test('semantics keep evidence coverage and signal strength separate; causes cannot self-certify', () => {
  const data=clone(owner); Object.assign(data.metrics[0]!,{kind:'possible_cause',confidence_status:'validated'}); assert.throws(()=>adaptSharedAssessment(data));
  for (const field of ['evidence_coverage','signal_strength']) {
    const invalid=clone(owner); Object.assign(invalid.metrics[0]!,{[field]:1.01}); assert.throws(()=>adaptSharedAssessment(invalid));
  }
  const zero=clone(owner); Object.assign(zero.metrics[0]!,{evidence_coverage:0,signal_strength:1});
  const out=adaptSharedAssessment(zero); assert.equal(out.metrics[0]!.evidence_coverage,0); assert.equal(out.metrics[0]!.signal_strength,1);
});
test('comparisons preserve N/A and refuse distinct data or protocol identities', () => {
  const out=adaptSharedAssessment(owner); const compared=compareSharedAssessments(out,adaptSharedAssessment(clone(owner)));
  assert.ok(compared.comparable); assert.equal(compared.pairs[1]!.left.value,null); assert.equal(compared.pairs[1]!.right.value,null);
  assert.equal(compareSharedAssessments(out,adaptSharedAssessment({...owner,content_hash:'b'.repeat(64)})).comparable,false);
  assert.equal(compareSharedAssessments(out,adaptSharedAssessment(owner.report)).comparable,false);
});
test('raw report and envelope are independent of mutable consumer views', () => {
  const input=clone(native), original=clone(input); const out=adaptSharedAssessment(input,'preflight',{findings:nativeFindings});
  out.metrics[0]!.parameters.changed=true;
  assert.deepEqual(input,original); assert.deepEqual(out.envelope,original); assert.deepEqual(out.report,original.report);
});


test('real Domains Report profile imports native values without masquerading as Preflight Assessment', () => {
  const out=adaptSharedAssessment(domains,'preflight');
  assert.equal(out.wireFormat,'domains_report_v1'); assert.equal(out.producer,'domains');
  assert.equal(out.context,null); assert.deepEqual(out.report,domains); assert.deepEqual(out.envelope,domains);
  assert.equal(out.metrics.length,domains.metrics.length); assert.equal(out.findings.length,domains.findings.length);
  for(let i=0;i<out.metrics.length;i++) {
    assert.equal(out.metrics[i]!.status,domains.metrics[i]!.status);
    assert.equal(out.metrics[i]!.reason_code,domains.metrics[i]!.reason);
    assert.deepEqual(out.metrics[i]!.native_metric,domains.metrics[i]);
    assert.deepEqual(out.metrics[i]!.denominators,domains.metrics[i]!.population);
  }
  assert.equal(out.findings[0]!.confidence,'low'); assert.equal(out.findings[0]!.confidence_status,'unknown');
  assert.equal(out.findings[0]!.calibration_consequence,domains.findings[0]!.calibration_consequence);
});
test('Domains fit/evaluation identities are copied from explicit native closure, never inferred from counts', () => {
  const out=adaptSharedAssessment(domains), technical=adaptSharedAssessment(repeats);
  assert.equal(out.nativeTaskContext!.reference_status,'declared');
  assert.deepEqual(out.nativeTaskContext!.fit_observation_ids,domains.fit.fit_observation_ids);
  assert.deepEqual(out.nativeTaskContext!.test_observation_ids,domains.representations.selected_population.test_observation_ids);
  assert.equal(out.nativeTaskContext!.sanitized_task_sha256,domains.provenance.sanitized_task_sha256);
  assert.equal(out.nativeTaskContext!.fit_x_sha256,domains.fit.fit_x_sha256);
  assert.equal(technical.metrics[0]!.denominators.n_train_observations,10);
  assert.equal(technical.nativeTaskContext!.fit_observation_ids!.length,8);
  assert.equal(technical.context,null,'task/fit hashes are not silently relabelled source content hashes');
});
test('Domains missing or overlapping train/evaluation identities leave reference unavailable', () => {
  const absent=clone(domains); delete (absent as {fit?:unknown}).fit;
  const out=adaptSharedAssessment(absent); assert.equal(out.nativeTaskContext!.reference_status,'unavailable');
  assert.equal(out.metrics.length,domains.metrics.length,'other native observations remain present');
  assert.equal(compareSharedAssessments(out,out).comparable,false);
  const overlap=clone(domains); overlap.representations.selected_population.test_observation_ids[0]=overlap.fit.fit_observation_ids[0]!;
  const bad=adaptSharedAssessment(overlap); assert.equal(bad.nativeTaskContext!.reference_status,'unavailable');
});
test('Domains qualified comparison checks exact task/version/split/policy/fit/evaluation identities', () => {
  const a=adaptSharedAssessment(domains); assert.ok(compareSharedAssessments(a,adaptSharedAssessment(clone(domains))).comparable);
  assert.equal(compareSharedAssessments(a,adaptSharedAssessment(repeats)).comparable,false);
  for(const mutate of [
    (d:typeof domains)=>{d.context.split_id='other'},
    (d:typeof domains)=>{d.provenance.sanitized_task_sha256='b'.repeat(64)},
    (d:typeof domains)=>{d.fit.fit_x_sha256='b'.repeat(64)},
    (d:typeof domains)=>{d.test_target_accessed=true},
  ]) {
    const d=clone(domains); mutate(d);
    if(d.context.split_id==='other')d.metrics.forEach((m)=>{m.context.split_id='other'});
    assert.equal(compareSharedAssessments(a,adaptSharedAssessment(d)).comparable,false);
  }
});
test('Domains raw status/reason/null, population weighting and uncertainty survive the adapter', () => {
  const out=adaptSharedAssessment(repeats);
  const unavailable=out.metrics.find((m)=>m.status!=='computed')!;
  assert.equal(unavailable.value,null); assert.equal(metricAvailable(unavailable),false);
  assert.deepEqual(out.metrics.map((m)=>m.uncertainty),repeats.metrics.map((m)=>m.uncertainty));
  assert.deepEqual(out.nativeTaskContext!.context,repeats.context);
  assert.ok(out.findings.some((f)=>f.unresolvedEvidence.includes('preflight.findings')));
});
test('Domains refuses unknown protocols, mixed contexts and unsafe cross-host integer seeds', () => {
  assert.throws(()=>adaptSharedAssessment({...domains,protocol_version:'domains.canonical.v9'}));
  const mixed=clone(domains);mixed.metrics[0]!.context.source_id='other';assert.throws(()=>adaptSharedAssessment(mixed));
  assert.throws(()=>adaptSharedAssessment({...domains,policy:{...domains.policy,seed:9007199254740992}}));
  assert.throws(()=>adaptSharedAssessment(domains,'domains',{expectedContext:context}));
});

test('opaque metric_context_id is optional, preserved and format-checked without replacing native context', () => {
  const data=clone(native); const factor=data.metrics.filter((m)=>m.metric_id==='domain_shift.design');
  Object.assign(factor[0]!,{metric_context_id:'sha256:'+'a'.repeat(64)});
  Object.assign(factor[1]!,{metric_context_id:'sha256:'+'b'.repeat(64)});
  const out=adaptSharedAssessment(data);
  assert.equal(out.metrics.filter((m)=>m.metric_id==='domain_shift.design').length,2);
  assert.deepEqual(out.metrics.filter((m)=>m.metric_id==='domain_shift.design').map((m)=>m.metric_context_id),['sha256:'+'a'.repeat(64),'sha256:'+'b'.repeat(64)]);
  Object.assign(factor[1]!,{metric_context_id:'sha256:'+'a'.repeat(64)});
  assert.throws(()=>adaptSharedAssessment(data),/hides distinct/);
  const invalid=clone(owner);Object.assign(invalid.metrics[0]!,{metric_context_id:'not-a-qualified-id'});assert.throws(()=>adaptSharedAssessment(invalid));
  const duplicate=clone(owner);duplicate.metrics.push(clone(duplicate.metrics[0]!));Object.assign(duplicate.metrics[0]!,{metric_context_id:'sha256:'+'a'.repeat(64)});Object.assign(duplicate.metrics[2]!,{metric_context_id:'sha256:'+'b'.repeat(64)});assert.throws(()=>adaptSharedAssessment(duplicate),/Duplicate/);
});
test('denominators remain part of metric identity even when parameters and seven historical fields coincide', () => {
  const data=clone(owner);const m=clone(data.metrics[0]!);m.native_metric.denominators.eligible_observations=21;
  data.report.metrics.push(clone(m.native_metric));data.metrics.push(m);
  const out=adaptSharedAssessment(data);assert.equal(out.metrics.filter((m)=>m.metric_id===data.metrics[0]!.metric_id).length,2);
  assert.equal(compareSharedAssessments(out,out).pairs.length,3);
});
test('an opaque identity cannot make missing native evidence available', () => {
  const data=clone(owner);Object.assign(data.metrics[1]!,{metric_context_id:'sha256:'+'c'.repeat(64)});
  const out=adaptSharedAssessment(data);assert.equal(metricAvailable(out.metrics[1]!),false);assert.equal(out.metrics[1]!.value,null);
  const finding=clone(ownerFindings);Object.assign(finding[0]!.evidence[0]!,{metric_context_id:'broken'});
  assert.throws(()=>adaptSharedAssessment(data,'preflight',{findings:finding}));
});
