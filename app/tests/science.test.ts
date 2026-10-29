import assert from 'node:assert/strict';
import { test } from 'node:test';
import { initializeDiagnostics, nativeOutliers } from '../src/engine/nativeDiagnostics';
import { HotellingT2, QResiduals } from '@nirs4all/methods';
import { analyzeDrift } from '../src/lib/drift';
import { resampleTo } from '../src/lib/spectralAxis';
import { buildRoutinePredictions, buildReliabilityView } from '../src/lib/reliability';
import { computeQuality } from '../src/lib/quality';
import { scoreCandidates } from '../src/lib/selection';
import { adaptSharedAssessment } from '../src/lib/sharedAssessment';

await initializeDiagnostics();
const calRows = [[1,2,3], [2,3,4], [3,5,6], [4,6,9], [5,10,12], [6,9,8]];
const matrix = (rows: number[][]) => ({ X: Float64Array.from(rows.flat()), n: rows.length, p: rows[0]!.length });
const sample = (values: number[], id: string) => ({ sampleId: id, reps: [{ repId: `${id}-1`, values: Float64Array.from(values) }] });
const cal = calRows.map((row, i) => sample(row, `c${i}`));
const spectra = { axis: [1000, 1100, 1200], axisUnit: 'nm', samples: cal };
const near = [2,4,5], far = [500, -200, 1000];
const params = { cal, routine: [sample(near, 'a')], predicted: [3], axisLen: 3, yMin: 1, yMax: 6, rmsep: 0.4, calY: [1,2,3,4,5,6] };

test('drift reference and a sample score are invariant to other evaluation rows', () => {
  const alone = analyzeDrift(matrix(calRows), matrix([near]));
  const appended = analyzeDrift(matrix(calRows), matrix([far, near]));
  assert.deepEqual(alone.calPts, appended.calPts);
  assert.deepEqual(alone.newPts[0], { ...appended.newPts[1], idx: 0 });
  assert.equal(alone.ev(0), appended.ev(0));
});
test('routine uncertainty and applicability are invariant to batch composition', () => {
  const alone = buildRoutinePredictions(params).preds[0]!;
  const changed = buildRoutinePredictions({ ...params, routine: [sample(far,'b'), sample(near,'a')], predicted: [1000,3] }).preds[1]!;
  assert.deepEqual(alone, changed);
});
test('HPLC candidates cannot change their reference coordinates when another candidate is added', () => {
  const labelled = new Set(cal.map((s) => s.sampleId));
  const score = (rows: typeof cal) => scoreCandidates({ ...spectra, samples: [...cal, ...rows] }, labelled, new Set(rows.map((s) => s.sampleId)));
  const a = score([sample(near,'a'), sample([4,7,9],'z')]);
  const b = score([sample(far,'b'), sample(near,'a'), sample([4,7,9],'z')]);
  assert.deepEqual(a.calPts, b.calPts);
  assert.equal(a.candidates.find((x) => x.sampleId === 'a')!.novelty, b.candidates.find((x) => x.sampleId === 'a')!.novelty);
});
test('native interpolation aligns equal-length shifted axes rather than trusting feature indices', () => {
  assert.deepEqual(Array.from(resampleTo([0,10,20], [900,1100,1300], [1000,1100,1200], 'nm','nm')), [5,10,15]);
});
test('native interpolation preserves target order and converts micrometres and wavenumbers', () => {
  assert.deepEqual(Array.from(resampleTo([20,10,0], [1.3,1.1,0.9], [1200,1100,1000], 'um','nm')), [15,10,5]);
  assert.deepEqual(Array.from(resampleTo([0,10,20], [1000,1100,1200], [1e7/1200,1e7/1100,1e7/1000], 'nm','cm-1')), [20,10,0]);
});
for (const [name, values, source, target, su, tu] of [
  ['missing units', [1,2], [1000,1100], [1000,1100], 'index','nm'],
  ['non-monotonic', [1,2,3], [1000,1200,1100], [1000,1100], 'nm','nm'],
  ['duplicate bands', [1,2,3], [1000,1000,1100], [1000,1100], 'nm','nm'],
  ['out of range', [1,2], [1000,1100], [1000,1200], 'nm','nm'],
  ['masked observation', [1,NaN,2], [1000,1100,1200], [1000,1200], 'nm','nm'],
  ['wrong row length', [1,2], [1000,1100,1200], [1000,1200], 'nm','nm'],
] as const) test(`axis alignment rejects ${name}`, () => assert.throws(() => resampleTo(values, source, target, su, tu)));

test('health T²/Q values and limits match the public native procedures', () => {
  const X = { data: matrix(calRows).X, rows: 6, cols: 3 };
  const native = nativeOutliers(X, 2);
  assert.deepEqual(native.t2, Array.from((new HotellingT2({ n_components:2, alpha:0.05 }).run(X).t2 as {data:Float64Array}).data));
  assert.equal(native.qLimit, new QResiduals({ n_components:2, alpha:0.05 }).run(X).ucl);
  const report = computeQuality(spectra, {}, {});
  assert.equal(report.outliers.t2Limit, native.t2Limit);
  assert.equal(report.outliers.qLimit, native.qLimit);
  assert.ok(report.outliers.available);
});
test('insufficient or missing health evidence is explicitly unavailable', () => {
  for (const rows of [[cal[0]!], [cal[0]!, cal[1]!], [sample([NaN,2,3],'bad'), ...cal]]) {
    const result = computeQuality({ ...spectra, samples: rows }, {}, {});
    assert.equal(result.outliers.available, false);
    assert.ok(result.outliers.reason);
  }
});
test('missing RMSEP never becomes a fabricated unit-width interval', () => {
  const result = buildRoutinePredictions({ ...params, rmsep: NaN }).preds[0]!;
  assert.equal(result.uncertainty.halfWidth, null);
  assert.equal(result.uncertainty.kind, 'unavailable');
  assert.equal(result.input.intervalWidth, null);
  assert.match(result.interval, /unavailable/);
});
test('zero RMSEP is preserved and heuristic bands never claim nominal coverage', () => {
  const zero = buildRoutinePredictions({ ...params, rmsep: 0 }).preds[0]!;
  assert.equal(zero.uncertainty.halfWidth, 0);
  assert.equal(zero.uncertainty.nominalCoverage, null);
  assert.equal(zero.uncertainty.status, 'not_calibrated');
  const distant = buildRoutinePredictions({ ...params, routine: [sample(far,'far')] }).preds[0]!;
  assert.match(distant.interval, /heuristic; not calibrated/);
  assert.notEqual(buildReliabilityView(zero.input,'en').color, 'reliable');
});
test('missing Y references and nonfinite predictions remain unknown alerts', () => {
  const result = buildRoutinePredictions({ ...params, predicted: [NaN], calY: [] }).preds[0]!;
  assert.equal(result.alerts.yDens,'unknown');
  assert.equal(result.alerts.outY,'unknown');
  assert.equal(result.uncertainty.halfWidth,null);
});
const metric = { metric_id:'pca.q', protocol_version:'1', status:'insufficient_data', reason_code:'NO_REFERENCE', scope:'source_target', source_id:'X', target_id:null, view_id:'native', population_id:'train', value:null, unit:null, denominators:{observed:0}, parameters:{mask:'preserve'} };
const report = {schema_version:1, engine_version:'0.1.0', protocol_bundle_version:'1', status:'partial', validation:{errors:[]}, capabilities:[], metrics:[metric], findings:[{rule_id:'q',severity:'warning',confidence:'unvalidated',evidence:['pca.q'],message:'Reference unavailable',action:'Collect reference'}],limitations:['No reference']};
test('shared report adapter preserves provenance, unavailability and original report without mutation', () => {
  const copy = structuredClone(report);
  const adapted = adaptSharedAssessment(report);
  assert.deepEqual(adapted.report,report);
  assert.equal(adapted.metrics[0]!.value,null);
  assert.equal(adapted.metrics[0]!.reason_code,'NO_REFERENCE');
  assert.equal(adapted.findings[0]!.confidence,'unvalidated');
  adapted.metrics[0]!.reason_code='changed';
  assert.deepEqual(report,copy);
});
test('shared adapter refuses unsupported schemas, missing computed values and duplicate contexts', () => {
  assert.throws(()=>adaptSharedAssessment({...report,schema_version:2}));
  assert.throws(()=>adaptSharedAssessment({...report,metrics:[{...metric,status:'computed'}]}));
  assert.throws(()=>adaptSharedAssessment({...report,metrics:[metric,metric]}));
  assert.throws(()=>adaptSharedAssessment({...report,metrics:[{...metric,value:NaN}]}));
});


test('wide NIRS native diagnostics are available in the required fixed owner cohort', () => {
  const wide = { axis: Array.from({length:240},(_,j)=>1000+j), axisUnit:'nm', samples: Array.from({length:42},(_,i)=>sample(Array.from({length:240},(_,j)=>Math.sin((i+1)*(j+1)*0.013)+0.002*i*j),`wide-${i}`)) };
  const report = computeQuality(wide,{},{});
  assert.ok(report.outliers.available, report.outliers.reason ?? 'wide native diagnostic unavailable');
  assert.equal(report.outliers.points.length,42);
  assert.ok(Number.isFinite(report.outliers.t2Limit));
  assert.ok(Number.isFinite(report.outliers.qLimit));
});
