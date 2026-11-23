import { toCsv, toCsvCell } from '../csv';

describe('toCsvCell (#982)', () => {
  it('writes plain text and numbers unchanged', () => {
    expect(toCsvCell('Midnight Run')).toBe('Midnight Run');
    expect(toCsvCell(42)).toBe('42');
  });

  it('writes null and undefined as an empty cell', () => {
    expect(toCsvCell(null)).toBe('');
    expect(toCsvCell(undefined)).toBe('');
  });

  it('quotes text containing commas, quotes or line breaks, doubling embedded quotes', () => {
    expect(toCsvCell('Rock, Roll')).toBe('"Rock, Roll"');
    expect(toCsvCell('the "best" one')).toBe('"the ""best"" one"');
    expect(toCsvCell('line one\nline two')).toBe('"line one\nline two"');
  });

  it('neutralises text a spreadsheet would run as a formula', () => {
    expect(toCsvCell('=HYPERLINK("https://evil.example")')).toBe(
      `"'=HYPERLINK(""https://evil.example"")"`,
    );
    expect(toCsvCell('+1-800')).toBe(`'+1-800`);
    expect(toCsvCell('-Remix')).toBe(`'-Remix`);
    expect(toCsvCell('@handle')).toBe(`'@handle`);
  });

  it('leaves numbers alone even when negative, since they are not formulas', () => {
    expect(toCsvCell(-5)).toBe('-5');
  });
});

describe('toCsv (#982)', () => {
  it('writes a header row and data rows with CRLF line endings', () => {
    const csv = toCsv(['Song ID', 'Title', 'Plays'], [
      ['s1', 'Intro', 3],
      ['s2', 'Outro, Extended', 0],
    ]);

    expect(csv).toBe('Song ID,Title,Plays\r\ns1,Intro,3\r\ns2,"Outro, Extended",0\r\n');
  });

  it('writes only the header when there are no rows', () => {
    expect(toCsv(['Song ID', 'Plays'], [])).toBe('Song ID,Plays\r\n');
  });
});
