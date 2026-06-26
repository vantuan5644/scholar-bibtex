// Step E — BibTeX acquisition + cite-key normalization.
// Pure transforms are unit-tested; fetchBibtexByDoi is the canonical exact path.
import { asciiFold } from './text.js';

// Leading words that shouldn't seed a cite key (articles / common prepositions).
const TITLE_STOPWORDS = new Set([
  'a', 'an', 'the', 'on', 'of', 'for', 'and', 'in', 'to', 'with', 'toward', 'towards', 'is', 'are', 'be',
]);

/**
 * Build a clean cite key: <firstAuthorFamily><year><firstTitleWord>.
 * e.g. Vaswani, 2017, "Attention Is All You Need" -> vaswani2017attention
 */
export function makeCiteKey(meta = {}) {
  let family = meta.firstAuthorFamily || '';
  if (!family && Array.isArray(meta.authors) && meta.authors.length) {
    const a0 = meta.authors[0];
    family = typeof a0 === 'string' ? a0.split(/\s+/).pop() : a0?.family || a0?.last || '';
  }
  family = asciiFold(family).replace(/[^A-Za-z]/g, '').toLowerCase() || 'anon';

  const year = meta.year || 'nd';

  const words = String(meta.title || '')
    .split(/\s+/)
    .map((w) => asciiFold(w).replace(/[^A-Za-z0-9]/g, '').toLowerCase())
    .filter(Boolean);
  let firstWord = words.find((w) => !TITLE_STOPWORDS.has(w)) || words[0] || 'ref';

  return `${family}${year}${firstWord}`;
}

/** Extract a single bibtex field value with balanced-brace handling. */
export function getField(bibtex, field) {
  const m = String(bibtex || '').match(new RegExp(`\\b${field}\\s*=\\s*`, 'i'));
  if (!m) return '';
  let i = m.index + m[0].length;
  const s = String(bibtex || '');
  while (i < s.length && /\s/.test(s[i])) i++;
  if (s[i] === '{') {
    let depth = 0;
    let start = i + 1;
    let end = -1;
    for (; i < s.length; i++) {
      if (s[i] === '{') depth++;
      else if (s[i] === '}') {
        depth--;
        if (depth === 0) {
          end = i;
          break;
        }
      }
    }
    return end > 0 ? s.slice(start, end) : s.slice(start);
  }
  if (s[i] === '"') {
    const end = s.indexOf('"', i + 1);
    return end > 0 ? s.slice(i + 1, end) : '';
  }
  return (s.slice(i).match(/^[^,\s}]+/) || [''])[0];
}

/**
 * Parse enough metadata out of a BibTeX entry to build a clean cite key.
 * Used as the authoritative source for key generation (more reliable than
 * candidate metadata, which is empty on the bare-DOI exact path).
 */
export function parseBibtexMeta(bibtex) {
  const strip = (x) => String(x || '').replace(/[{}]/g, '').trim();
  const title = strip(getField(bibtex, 'title'));
  let year = Number(getField(bibtex, 'year')) || null;
  if (!year) {
    const date = getField(bibtex, 'date');
    year = Number(date.match(/(?:19|20)\d{2}/)?.[0]) || null;
  }
  const authorStr = getField(bibtex, 'author');
  const authors = authorStr
    ? authorStr
        .split(/\s+and\s+/)
        .map((a) => strip(a))
        .filter(Boolean)
    : [];
  let family = '';
  if (authors.length) {
    const first = authors[0];
    family = first.includes(',')
      ? first.split(',')[0].trim()
      : first.split(/\s+/).pop().trim();
  }
  return { title, year, authors, firstAuthorFamily: family };
}

const KEY_RE = /^(@\w+\s*\{)\s*[^,]*/;

/** Rewrite the (often ugly) cite key on an existing BibTeX entry. */
export function rewriteCiteKey(bibtex, meta) {
  if (!bibtex) return bibtex;
  return bibtex.replace(KEY_RE, `$1${makeCiteKey(meta)}`);
}

/** Pick a sensible entry type from sparse metadata. */
export function inferEntryType(meta = {}) {
  const t = `${meta.type || ''} ${meta.venue || ''}`.toLowerCase();
  if (/proceedings|conference|workshop|symposium/.test(t)) return 'inproceedings';
  if (/journal|article|transactions|letters|review/.test(t)) return 'article';
  if (/book/.test(t)) return 'book';
  return 'misc';
}

function bibValue(s) {
  // Strip stray braces but keep content readable; collapse whitespace.
  return String(s ?? '').replace(/[{}]/g, '').replace(/\s+/g, ' ').trim();
}

function joinAuthors(authors = []) {
  return authors
    .map((a) => (typeof a === 'string' ? a : [a.given, a.family].filter(Boolean).join(' ')))
    .filter(Boolean)
    .join(' and ');
}

/** Construct a minimal-but-honest BibTeX entry from metadata (last resort). */
export function constructBibtex(meta = {}, { key } = {}) {
  const ck = key || makeCiteKey(meta);
  const type = inferEntryType(meta);
  const venueField = type === 'inproceedings' ? 'booktitle' : type === 'article' ? 'journal' : 'howpublished';
  const lines = [`@${type}{${ck},`];
  lines.push(`  title        = {${bibValue(meta.title)}}`);
  const a = joinAuthors(meta.authors);
  if (a) lines.push(`  author       = {${a}}`);
  if (meta.year) lines.push(`  year         = {${meta.year}}`);
  if (meta.venue) lines.push(`  ${venueField} = {${bibValue(meta.venue)}}`);
  if (meta.doi) lines.push(`  doi          = {${meta.doi}}`);
  if (meta.url) lines.push(`  url          = {${meta.url}}`);
  lines.push('}');
  return lines.join('\n');
}

/**
 * Exact path (Step B): content-negotiate https://doi.org/<doi> for BibTeX.
 * Works for Crossref AND DataCite (arXiv) DOIs, no API key, no Scholar.
 */
export async function fetchBibtexByDoi(doi, { signal } = {}) {
  const clean = String(doi ?? '').replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  const res = await fetch(`https://doi.org/${clean}`, {
    headers: { Accept: 'application/x-bibtex' },
    redirect: 'follow',
    signal,
  });
  if (!res.ok) throw new Error(`DOI content-negotiation failed (${res.status})`);
  const text = (await res.text()).trim();
  if (!text.startsWith('@')) throw new Error('No BibTeX returned for DOI');
  return text;
}
