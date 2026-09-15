const LINE_BREAK_TAG = /(?:<|&lt;)br\s*\/?(?:>|&gt;)/gi;

/** Trims and collapses whitespace; returns null for anything that is not a non-blank string. */
export function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value
    .replace(LINE_BREAK_TAG, '\n')
    .replace(/ /g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/ ?\n ?/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text === '' ? null : text;
}

export function firstLine(text: string | null): string | null {
  return text?.split('\n').find((line) => line.trim() !== '')?.trim() ?? null;
}

function foldAccents(value: string): string {
  return value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toUpperCase();
}

/** Accent- and case-insensitive key made of letters and digits only: "2024-dpl 0030" → "2024DPL0030". */
export function matchKey(value: string | null): string | null {
  const key = value === null ? '' : foldAccents(value).replace(/[^A-Z0-9]/g, '');
  return key === '' ? null : key;
}

export function words(value: string): Set<string> {
  return new Set(foldAccents(value).split(/[^A-Z0-9]+/).filter(Boolean));
}
