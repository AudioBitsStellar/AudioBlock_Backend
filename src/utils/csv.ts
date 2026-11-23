/** Cell values the CSV writer accepts. `null` and `undefined` become an empty cell. */
export type CsvValue = string | number | null | undefined;

/** Text starting with one of these is read as a formula by spreadsheet apps. */
const FORMULA_TRIGGERS = ['=', '+', '-', '@', '\t', '\r'];

/**
 * Render one CSV cell per RFC 4180 (#982).
 *
 * Text that a spreadsheet would evaluate as a formula is prefixed with an
 * apostrophe, so `=HYPERLINK(...)` in a song title is shown as text rather than
 * run (CSV injection). Numbers are written as-is, so negative values keep their sign.
 */
export function toCsvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return String(value);

  const text = FORMULA_TRIGGERS.some((trigger) => value.startsWith(trigger)) ? `'${value}` : value;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Render a header row and data rows as CSV text, with CRLF line endings (RFC 4180). */
export function toCsv(headers: string[], rows: CsvValue[][]): string {
  const lines: CsvValue[][] = [headers, ...rows];
  return lines.map((line) => line.map(toCsvCell).join(',')).join('\r\n') + '\r\n';
}
