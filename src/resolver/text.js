// Shared, dependency-free string utilities used across the resolver.
// Pure functions only — safe to unit-test under `node --test`.

/** Fold non-ASCII characters toward ASCII (diacritics, smart quotes, dashes). */
export function asciiFold(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // combining diacritical marks
    .replace(/[\u2010-\u2015]/g, '-') // hyphen/dash variants
    .replace(/[\u2018\u2019\u201a\u201b]/g, "'") // curly single quotes
    .replace(/[\u201c\u201d\u201e\u201f]/g, '"') // curly double quotes
    .replace(/[\u00d7]/g, 'x');
}

/** Normalize a title for fuzzy comparison: lowercase, ascii-folded, alnum+space only. */
export function normalizeTitle(t) {
  return asciiFold(t)
    .toLowerCase()
    .replace(/&amp;/g, '&')
    .replace(/[\u00a0]/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
