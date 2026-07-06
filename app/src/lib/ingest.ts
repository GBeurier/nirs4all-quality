// Client-side CSV ingestion — turns an uploaded spectra CSV (+ optional
// reference CSV) into the app's Sample[] + SpectraDataset, entirely in-browser.
// This is the "achievable in WASM/web" ingestion path; vendor binary formats can
// later be decoded through nirs4all-formats WASM behind the same output shape.
import type { Sample } from '@/domain/model';
import type { RepetitionSpectrum, SampleSpectra, SpectraDataset } from '@/domain/spectra';
import { newId, nowIso } from '@/lib/ids';

function splitRows(text: string): string[][] {
  const delim = text.indexOf(';') >= 0 && (text.indexOf(',') < 0 || text.split(';').length > text.split(',').length) ? ';' : ',';
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((line) => line.split(delim).map((c) => c.trim()));
}

const isNum = (s: string) => s !== '' && Number.isFinite(Number(s));

export interface SpectraCsv {
  axis: number[];
  unit: string;
  rows: { id: string; values: Float64Array }[];
}

/**
 * Parse a spectra CSV. Heuristics (matching studio-lite):
 * - A non-numeric first column ⇒ sample ids (else ids are generated).
 * - A numeric first row is the WAVELENGTH AXIS only when its magnitudes are
 *   axis-scale (max |v| > 50); otherwise it's the first sample and the axis is 0..n-1.
 */
export function parseSpectraCsv(text: string): SpectraCsv {
  const grid = splitRows(text);
  if (grid.length === 0) throw new Error('CSV vide');

  // sample-id column? — any data cell in column 0 that isn't numeric
  const hasIdCol = grid.some((r, i) => i > 0 && r.length > 1 && !isNum(r[0] ?? ''));
  const colStart = hasIdCol ? 1 : 0;

  const first = grid[0] ?? [];
  const firstData = first.slice(colStart);
  const firstAllNum = firstData.length > 0 && firstData.every(isNum);
  const firstMax = firstAllNum ? Math.max(...firstData.map((v) => Math.abs(Number(v)))) : 0;
  const headerIsAxis = firstAllNum && firstMax > 50;

  const dataStart = headerIsAxis ? 1 : 0;
  const dataRows = grid.slice(dataStart).filter((r) => r.length > colStart);
  const nFeatures = Math.max(0, (dataRows[0]?.length ?? 0) - colStart);

  const axis = headerIsAxis
    ? firstData.map((v) => Number(v))
    : Array.from({ length: nFeatures }, (_, i) => i + 1);

  const rows = dataRows.map((r, i) => ({
    id: hasIdCol ? (r[0] ?? `S${i + 1}`) : `S${String(i + 1).padStart(3, '0')}`,
    values: Float64Array.from(r.slice(colStart, colStart + nFeatures).map((v) => (isNum(v) ? Number(v) : Number.NaN))),
  }));

  return { axis, unit: headerIsAxis ? 'nm' : 'index', rows };
}

/** Parse a reference CSV: `sample_id,value` (a header row is auto-skipped). */
export function parseReferenceCsv(text: string): Record<string, number> {
  const grid = splitRows(text);
  const out: Record<string, number> = {};
  for (const r of grid) {
    if (r.length < 2) continue;
    const id = r[0] ?? '';
    const v = Number(r[1]);
    if (id && isNum(r[1] ?? '')) out[id] = v;
  }
  return out;
}

export interface Ingested {
  samples: Sample[];
  spectra: SpectraDataset;
}

/** Build the app's Sample[] + SpectraDataset from parsed CSV(s). Repeated ids
 *  become repetitions of the same sample. */
export function ingestCsv(projectId: string, spectraCsv: SpectraCsv, references: Record<string, number>): Ingested {
  const groups = new Map<string, RepetitionSpectrum[]>();
  for (const row of spectraCsv.rows) {
    const list = groups.get(row.id) ?? [];
    list.push({ repId: newId('rep'), values: row.values });
    groups.set(row.id, list);
  }

  const sampleSpectra: SampleSpectra[] = [];
  const samples: Sample[] = [];
  for (const [id, reps] of groups) {
    sampleSpectra.push({ sampleId: id, reps });
    const ref = references[id];
    const hasRef = typeof ref === 'number' && Number.isFinite(ref);
    samples.push({
      id,
      projectId,
      lotId: null,
      barcode: null,
      status: hasRef ? 'integrated' : 'nirs_measured',
      repetitions: reps.map((r) => ({ id: r.repId, spectrumRef: r.repId, acquiredAt: nowIso() })),
      reference: hasRef ? { value: ref, status: 'validated' } : null,
      metadata: {},
      createdAt: nowIso(),
    });
  }

  return {
    samples,
    spectra: { axis: spectraCsv.axis, axisUnit: spectraCsv.unit, samples: sampleSpectra },
  };
}
