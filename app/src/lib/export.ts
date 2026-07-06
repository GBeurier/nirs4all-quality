// Client-side exports — CSV worklists / predictions / LIMS + a portable .n4a
// model bundle. All in-browser (Blob download), no server.

export function downloadText(filename: string, text: string, mime = 'text/csv;charset=utf-8'): void {
  const blob = new Blob([text], { type: mime });
  triggerDownload(filename, blob);
}

export function downloadJson(filename: string, value: unknown): void {
  downloadText(filename, JSON.stringify(value, null, 2), 'application/json');
}

function triggerDownload(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

function esc(v: unknown): string {
  const s = v == null ? '' : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Rows → CSV. Columns from `headers` (in order) or the first row's keys. */
export function toCsv(rows: readonly Record<string, unknown>[], headers?: readonly string[]): string {
  if (rows.length === 0) return (headers ?? []).join(',');
  const cols = headers ?? Object.keys(rows[0] ?? {});
  const head = cols.join(',');
  const body = rows.map((r) => cols.map((c) => esc(r[c])).join(',')).join('\r\n');
  return `${head}\r\n${body}`;
}

/** A slug safe for filenames. */
export function slug(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'export';
}
