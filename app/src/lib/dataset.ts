// Real dataset assembly — mirrors nirs4all-web/studio-lite (buildDataset) and
// io.nirs4all.org: accept a wide spectra file + an optional TARGET (y) file +
// metadata, detect the spectral axis from the header, and let the user CONFIGURE
// column roles (sample-id / replicate grouping / metadata / target) like the io
// dataset builder. Rows sharing a sample-id become replicates of one sample.
//
// Output = the app's Sample[] + SpectraDataset (real X) + real reference y, so
// calibration trains on actual data instead of a synthetic stand-in.
import type { Sample } from '@/domain/model';
import type { RepetitionSpectrum, SampleSpectra, SpectraDataset } from '@/domain/spectra';
import { newId, nowIso } from '@/lib/ids';

export interface RawFile { name: string; text: string; }

export interface CsvGrid {
  header: string[];
  rows: string[][];
  hasHeader: boolean;
}

const num = (s: string): number => Number(String(s).replace(',', '.'));
const isNum = (s: string): boolean => s !== '' && s != null && Number.isFinite(num(s));

function detectDelimiter(text: string): string {
  const line = text.split(/\r?\n/).find((l) => l.trim().length > 0) ?? '';
  // Priority order: `;` and tab win over `,` so a decimal-comma file like
  // `1,23;4,56;7,89` is split on `;`, not on the decimal commas.
  for (const d of [';', '\t', ',']) if (line.split(d).length >= 2) return d;
  if (line.trim().split(/\s+/).length > 1) return ' ';
  return ',';
}

export function parseCsv(text: string): CsvGrid {
  const delim = detectDelimiter(text);
  const lines = text.replace(/\r\n?/g, '\n').split('\n').filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { header: [], rows: [], hasHeader: false };
  const split = (l: string) => (delim === ' ' ? l.trim().split(/\s+/) : l.split(delim)).map((c) => c.trim());
  const first = split(lines[0]!);
  const firstNumeric = first.every(isNum);
  // a fully non-numeric first row is a header — even when later rows are also
  // non-numeric (all-string metadata / label files like Mtrain: sample_id,site).
  const hasHeader = !firstNumeric;
  const header = hasHeader ? first : first.map((_, i) => String(i));
  const rows = (hasHeader ? lines.slice(1) : lines).map(split);
  return { header, rows, hasHeader };
}

// --- file role detection (studio-lite regexes) ------------------------------
const base = (n: string) => n.replace(/\.[^.]+$/, '').toLowerCase();
const isX = (n: string) => /(^|[^a-z])x([^a-z]|$)|^x(train|test|cal|val|valid|calib|pred|holdout)|spectr|features?/i.test(base(n));
const isY = (n: string) => /(^|[^a-z])y([^a-z]|$)|^y(train|test|cal|val|valid|calib|pred|holdout)|target|label|conc|reference|ref$/i.test(base(n));
// metadata: `metadata.csv`, or the M-prefixed convention Mtrain / Mtest / M_cal …
const isMeta = (n: string) => /meta|(^|[^a-z])m([^a-z]|$)|^m(train|test|cal|val|valid|calib|pred|holdout)/i.test(base(n));

// --- column roles (io-style configurable assignment) ------------------------
export type ColRole = 'id' | 'target' | 'metadata' | 'ignore';
export interface LeadingColumn { index: number; name: string; role: ColRole; numeric: boolean; }

export interface DatasetAnalysis {
  xGrid: CsvGrid;
  featureStart: number;        // first spectral column
  axis: number[];
  axisUnit: string;
  leading: LeadingColumn[];     // configurable non-spectral columns
  separateTarget: number[] | null; // raw y from a separate file (per-row OR per-sample)
  /** original data-row index of each kept X row (for per-row Y/metadata alignment) */
  keptIndices: number[];
  /** total X data rows before empty-skipping (per-row Y has this many values) */
  originalRowCount: number;
  targetName: string;
  /** per-X-row sample id from a metadata file (e.g. Mtrain) → GROUPS replicates */
  metaIds: string[] | null;
  /** extra descriptive columns from a metadata file, aligned 1:1 with the X rows */
  metaColumns: { name: string; values: string[] }[];
  /** name of the metadata file actually used (for the preview) */
  metaFile: string | null;
  /** browser sample cap actually applied (null = the whole set fit) */
  capped: number | null;
  /** total non-empty spectra rows found before any cap */
  totalRows: number;
  nFeatures: number;
  nRows: number;
}

/** Browser-friendly cap on the number of spectra kept from an upload — big
 *  corpora (e.g. OSSL, 40k×1660) can't be parsed/held/PCA'd client-side. */
const MAX_SAMPLES = 1500;

/** Detect the spectral axis + the split between leading (configurable) columns
 *  and the spectral block, and suggest a role for each leading column. */
export function analyzeFiles(files: RawFile[], targetName = 'y'): DatasetAnalysis {
  const xFile = files.find((f) => isX(f.name) && !isY(f.name))
    ?? files.slice().sort((a, b) => parseCsv(b.text).header.length - parseCsv(a.text).header.length)[0];
  if (!xFile) throw new Error('Aucun fichier de spectres (X) trouvé.');
  // Parse X at the LINE level so large/sparse files (e.g. OSSL: 40k rows where
  // most are empty `;;;`) don't explode into tens of millions of empty cells:
  // detect the header, then skip empty rows WITHOUT splitting them, cap the kept
  // sample count for the browser, and record each kept row's ORIGINAL data-row
  // index so a separate Y / metadata file stays aligned.
  const delim = detectDelimiter(xFile.text);
  const escDelim = delim.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const hasCell = new RegExp(`[^${escDelim === ' ' ? '' : escDelim}\\s]`); // line has ≥1 real value
  const splitLine = (l: string): string[] => (delim === ' ' ? l.trim().split(/\s+/) : l.split(delim)).map((s) => s.trim());
  const allLines = xFile.text.replace(/\r\n?/g, '\n').split('\n');
  let h0 = 0;
  while (h0 < allLines.length && allLines[h0]!.trim() === '') h0++;
  const firstCells = splitLine(allLines[h0] ?? '');
  const firstNumeric = firstCells.length > 0 && firstCells.every(isNum);
  let header: string[];
  let dataStart: number;
  if (!firstNumeric) {
    header = firstCells; dataStart = h0 + 1;
  } else {
    const nums = firstCells.map(num);
    const monotonic = nums.length > 2 && (nums.every((v, i) => i === 0 || v > nums[i - 1]!) || nums.every((v, i) => i === 0 || v < nums[i - 1]!));
    if (monotonic && Math.max(...nums.map(Math.abs)) > 50) { header = firstCells; dataStart = h0 + 1; }
    else { header = firstCells.map((_, i) => String(i)); dataStart = h0; }
  }
  const keptRows: string[][] = [];
  const keptIndices: number[] = [];
  let dataIdx = 0;
  let totalNonEmpty = 0;
  for (let li = dataStart; li < allLines.length; li++) {
    const line = allLines[li]!;
    if (line.trim() === '') continue;          // truly blank line → not a data position
    if (hasCell.test(line)) {                   // a real spectrum row
      totalNonEmpty++;
      if (keptRows.length < MAX_SAMPLES) { keptRows.push(splitLine(line)); keptIndices.push(dataIdx); }
    }
    dataIdx++;                                  // empty `;;;` rows still consume a position (Y/M have values there)
  }
  const originalDataCount = dataIdx;
  const capped = totalNonEmpty > keptRows.length ? keptRows.length : null;
  const xGrid: CsvGrid = { header, rows: keptRows, hasHeader: true };
  const nCols = xGrid.header.length;

  // header wavelengths look like axis values (>50); the spectral block is the
  // trailing run of such columns → everything before it is a leading column.
  const headerNum = xGrid.header.map((h) => (isNum(h) ? num(h) : NaN));
  const looksAxis = headerNum.filter((v) => Number.isFinite(v) && Math.abs(v) > 50).length > nCols / 2;
  let featureStart = 0;
  if (looksAxis) {
    featureStart = headerNum.findIndex((v) => Number.isFinite(v) && Math.abs(v) > 50);
    if (featureStart < 0) featureStart = 0;
  } else {
    // headerless / index headers: a leading (non-spectral) column is either
    // non-numeric OR looks like an id/replicate index (integer-valued with
    // duplicates) — spectral absorbance columns are continuous floats.
    const isLeading = (c: number): boolean => {
      const cells = xGrid.rows.map((r) => r[c] ?? '');
      if (cells.filter(isNum).length < cells.length * 0.9) return true;
      const allInt = cells.every((v) => isNum(v) && Number.isInteger(num(v)));
      return allInt && new Set(cells).size < cells.length;
    };
    let s = 0;
    while (s < nCols && isLeading(s) && nCols - s > 3) s++;
    featureStart = s;
  }

  const axis = looksAxis
    ? xGrid.header.slice(featureStart).map((h) => num(h))
    : Array.from({ length: nCols - featureStart }, (_, i) => i + 1);
  const axisUnit = looksAxis ? (axis[0]! >= 3000 ? 'cm-1' : 'nm') : 'index';

  // separate target file — aligned to the KEPT X rows by their original index
  const yFile = files.find((f) => isY(f.name) && !isX(f.name));
  let separateTarget: number[] | null = null;
  let tName = targetName;
  if (yFile) {
    const yg = parseCsv(yFile.text);
    const col = yg.header.length > 1 ? yg.header.length - 1 : 0;
    // keep the RAW y values — assembleDataset aligns them per-row (via keptIndices)
    // or per-sample depending on how many there are.
    separateTarget = yg.rows.map((r) => num(r[col] ?? ''));
    tName = yg.header[col] || targetName;
  }

  // metadata file (e.g. Mtrain): its id column GROUPS replicates, its other
  // columns become sample metadata — aligned to the KEPT X rows by original index.
  const metaFileRaw = files.find((f) => isMeta(f.name) && !isX(f.name) && !isY(f.name) && f.name !== xFile.name);
  let metaIds: string[] | null = null;
  let metaColumns: { name: string; values: string[] }[] = [];
  let metaFileName: string | null = null;
  if (metaFileRaw) {
    const mg = parseCsv(metaFileRaw.text);
    if (mg.rows.length === originalDataCount && mg.rows.length > 0) {
      metaFileName = metaFileRaw.name;
      const idCol = mg.header.findIndex((h) => /^(id|sample|sample[_ ]?id|name|code|ref|barcode)$/i.test(h));
      if (idCol >= 0) metaIds = keptIndices.map((oi) => mg.rows[oi]?.[idCol] || `S${oi + 1}`);
      metaColumns = mg.header
        .map((name, c) => ({ name: name || `m${c + 1}`, index: c }))
        .filter((c) => c.index !== idCol)
        .slice(0, 10) // don't attach dozens of descriptive columns
        .map((c) => ({ name: c.name, values: keptIndices.map((oi) => mg.rows[oi]?.[c.index] ?? '') }));
    }
  }

  // suggest roles for the leading columns
  const leading: LeadingColumn[] = [];
  let idAssigned = false;
  for (let c = 0; c < featureStart; c++) {
    const name = xGrid.header[c] ?? `col${c}`;
    const numeric = xGrid.rows.filter((r) => isNum(r[c] ?? '')).length > xGrid.rows.length * 0.5;
    let role: ColRole = 'metadata';
    if (!idAssigned && !numeric) { role = 'id'; idAssigned = true; }
    else if (!separateTarget && numeric && /y|target|conc|ref|protein|prot|val/i.test(name)) role = 'target';
    leading.push({ index: c, name, role, numeric });
  }
  // if nothing became id, promote the first NON-target leading column (never
  // clobber a detected target — otherwise a lone numeric target loses its role)
  if (!idAssigned) {
    const firstNonTarget = leading.find((c) => c.role !== 'target');
    if (firstNonTarget) firstNonTarget.role = 'id';
  }

  return { xGrid, featureStart, axis, axisUnit, leading, separateTarget, keptIndices, originalRowCount: originalDataCount, targetName: tName, metaIds, metaColumns, metaFile: metaFileName, capped, totalRows: totalNonEmpty, nFeatures: axis.length, nRows: xGrid.rows.length };
}

export interface AssembleResult { samples: Sample[]; spectra: SpectraDataset; }

/** Assemble Sample[] + SpectraDataset from the analysis + the (possibly edited)
 *  leading-column roles. Rows sharing the id value become replicates. */
export function assembleDataset(projectId: string, a: DatasetAnalysis, leading: LeadingColumn[]): AssembleResult {
  const idCol = leading.find((c) => c.role === 'id')?.index ?? null;
  const targetCol = a.separateTarget ? null : (leading.find((c) => c.role === 'target')?.index ?? null);
  const metaCols = leading.filter((c) => c.role === 'metadata');

  // a separate y with one value per ORIGINAL X row = per-row; otherwise per-sample
  const perRowY = !!a.separateTarget && a.separateTarget.length === a.originalRowCount;

  interface Group { reps: RepetitionSpectrum[]; ref: number | null; meta: Record<string, string | number | null>; }
  const groups = new Map<string, Group>();
  const order: string[] = [];

  a.xGrid.rows.forEach((row, i) => {
    // a metadata file's id column (e.g. Mtrain) groups replicates when present;
    // otherwise the configured X id column; otherwise a generated id.
    const id = a.metaIds ? (a.metaIds[i] || `S${i + 1}`)
      : idCol != null ? (row[idCol] || `S${i + 1}`)
        : `S${String(i + 1).padStart(3, '0')}`;
    const values = new Float64Array(a.nFeatures);
    let anyFinite = false;
    for (let j = 0; j < a.nFeatures; j++) { const v = row[a.featureStart + j] ?? ''; const n = isNum(v) ? num(v) : Number.NaN; values[j] = n; if (Number.isFinite(n)) anyFinite = true; }
    if (!anyFinite) return; // empty spectrum row → not a real sample
    // per-ROW reference: a target column, or a separate per-row y aligned to this
    // kept row via its original index; else a per-sample y is joined after the loop.
    const perRowRef = perRowY ? (a.separateTarget![a.keptIndices[i] ?? i] ?? null)
      : targetCol != null && isNum(row[targetCol] ?? '') ? num(row[targetCol]!) : null;
    let g = groups.get(id);
    if (!g) { g = { reps: [], ref: null, meta: {} }; groups.set(id, g); order.push(id); }
    g.reps.push({ repId: newId('rep'), values });
    if (perRowRef != null && Number.isFinite(perRowRef)) g.ref = perRowRef;
    for (const m of metaCols) if (g.meta[m.name] == null) g.meta[m.name] = row[m.index] ?? null;
    for (const mc of a.metaColumns) if (g.meta[mc.name] == null) g.meta[mc.name] = mc.values[i] ?? null;
  });

  // per-SAMPLE reference: a separate y file with one row per sample (not per
  // spectrum) is joined by sample order of first appearance — so replicate X
  // rows don't shift the y alignment.
  if (a.separateTarget && !perRowY && a.separateTarget.length === order.length) {
    order.forEach((id, k) => { const v = a.separateTarget![k]; if (v != null && Number.isFinite(v)) groups.get(id)!.ref = v; });
  }

  const samples: Sample[] = [];
  const sampleSpectra: SampleSpectra[] = [];
  for (const id of order) {
    const g = groups.get(id)!;
    sampleSpectra.push({ sampleId: id, reps: g.reps });
    const hasRef = typeof g.ref === 'number' && Number.isFinite(g.ref);
    samples.push({
      id, projectId, lotId: null, barcode: null,
      status: hasRef ? 'integrated' : 'nirs_measured',
      repetitions: g.reps.map((r) => ({ id: r.repId, spectrumRef: r.repId, acquiredAt: nowIso() })),
      reference: hasRef ? { value: g.ref, status: 'validated' } : null,
      metadata: g.meta,
      createdAt: nowIso(),
    });
  }
  return { samples, spectra: { axis: a.axis, axisUnit: a.axisUnit, samples: sampleSpectra } };
}

/** Read browser File[] → RawFile[] (name + text). */
export async function readRawFiles(files: File[]): Promise<RawFile[]> {
  return Promise.all(files.map(async (f) => ({ name: f.name, text: await f.text() })));
}

/** Parse a reference (y) file added a posteriori — one value per row (last column
 *  if several), aligned to the dataset rows; **empty rows/cells become `null`
 *  (missing)**. Unlike parseCsv, blank lines are KEPT (they carry a missing value),
 *  so row positions stay aligned with X. */
export function parseReferenceColumn(text: string): (number | null)[] {
  const delim = detectDelimiter(text);
  const split = (l: string): string[] => (delim === ' ' ? l.trim().split(/\s+/) : l.split(delim)).map((c) => c.trim());
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  if (lines.length && lines[lines.length - 1] === '') lines.pop(); // drop the final-newline artifact
  let start = 0;
  if (lines.length > 0 && !split(lines[0]!).every(isNum)) start = 1; // header row
  const out: (number | null)[] = [];
  for (let i = start; i < lines.length; i++) {
    const cells = split(lines[i]!);
    const col = cells.length > 1 ? cells.length - 1 : 0;
    const c = (cells[col] ?? '').trim();
    out.push(c !== '' && isNum(c) ? num(c) : null);
  }
  return out;
}

/** Quick preview counts for the config panel. */
export function previewCounts(a: DatasetAnalysis, leading: LeadingColumn[]): { samples: number; replicates: number; withRef: number; features: number } {
  const r = assembleDataset('preview', a, leading);
  const withRef = r.samples.filter((s) => s.reference?.value != null).length;
  const replicates = r.spectra.samples.reduce((n, s) => n + s.reps.length, 0);
  return { samples: r.samples.length, replicates, withRef, features: a.nFeatures };
}
