// thecvf adapter — CVF Open Access (openaccess.thecvf.com) hosts the canonical
// open-access versions of CVPR / ICCV / WACV papers and their workshops. Each
// paper page embeds a ready-made BibTeX block (the `@InProceedings{...}` entry
// CV researchers actually cite), so — like OpenReview's `_bibtex` — we extract
// it directly instead of content-negotiating a DOI. CVF open-access papers
// carry no DOI of their own, so without this source their canonical citation is
// unreachable.
//
// CVF exposes no search API, so this source is URL-only (the exact path): paste
// or follow a thecvf.com paper / PDF / supplemental link and we resolve the
// page's embedded BibTeX. parseCvfHtml / bibtexFromCvfHtml / cvfHtmlUrl /
// isCvfUrl / extractCvfUrl are pure (tested); only fetchCvfByUrl touches the
// network.
import { parseBibtexMeta, getField } from './bibtex.js';

// openaccess.thecvf.com is the live host; cv-foundation.org/openaccess is the
// legacy host older papers still link to (e.g. citation_pdf_url on 2016 pages).
const HOST_RE =
  /^https?:\/\/(?:openaccess\.thecvf\.com|(?:www\.)?cv-foundation\.org\/openaccess)\//i;
const URL_RE =
  /https?:\/\/(?:openaccess\.thecvf\.com|(?:www\.)?cv-foundation\.org\/openaccess)\/[^\s"'<>)]+/i;

/** True for a CVF Open Access URL (live or legacy host). */
export function isCvfUrl(url) {
  return HOST_RE.test(String(url || ''));
}

/** Pull the first CVF Open Access URL out of arbitrary text (e.g. Scholar links). */
export function extractCvfUrl(text) {
  const m = String(text || '').match(URL_RE);
  return m ? m[0] : null;
}

/**
 * Map a CVF paper PDF URL to the HTML page that carries the BibTeX block. HTML
 * pages (and anything we don't recognize) pass through unchanged; query/hash are
 * dropped.
 *   …/CVPR2023/papers/X_paper.pdf → …/CVPR2023/html/X_paper.html
 */
export function cvfHtmlUrl(url) {
  const u = String(url || '').split(/[?#]/)[0];
  if (/\/html\/[^/]+\.html$/i.test(u)) return u;
  if (/\/papers\/[^/]+\.pdf$/i.test(u)) {
    return u.replace('/papers/', '/html/').replace(/\.pdf$/i, '.html');
  }
  return u;
}

const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
};

function decodeEntities(s) {
  return String(s || '').replace(/&(?:amp|lt|gt|quot|#39|apos|nbsp);/g, (m) => ENTITIES[m] || m);
}

/**
 * Extract the canonical BibTeX entry from a CVF paper page's bibref block.
 * Handles both layouts: the legacy `<div class="bibref">` with `<br>` line
 * breaks and the modern `<div class="bibref pre-white-space">` with literal
 * newlines. Returns '' when no block is present.
 */
export function bibtexFromCvfHtml(html) {
  const m = String(html || '').match(/<div class="bibref[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
  if (!m) return '';
  const text = m[1]
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeEntities(text).replace(/\r/g, '').trim();
}

function familyOf(name) {
  const s = String(name || '').trim();
  return (s.includes(',') ? s.split(',')[0] : s.split(/\s+/).pop() || '').trim();
}

// CVF BibTeX authors are "Last, First"; flip to "First Last" for display
// consistency with the other sources. The copied BibTeX is left untouched.
function flipName(name) {
  const s = String(name || '').trim();
  if (!s.includes(',')) return s;
  const [last, ...rest] = s.split(',');
  return `${rest.join(',').trim()} ${last.trim()}`.trim();
}

/**
 * Parse a CVF paper page into a normalized candidate carrying its embedded
 * BibTeX. Metadata is read from that same BibTeX (authoritative for the cite
 * key), with the booktitle as the venue.
 * @throws if the page has no usable BibTeX block.
 */
export function parseCvfHtml(html, url) {
  const bibtex = bibtexFromCvfHtml(html);
  if (!bibtex || !bibtex.startsWith('@')) {
    throw new Error('No BibTeX found on the CVF page');
  }
  const meta = parseBibtexMeta(bibtex);
  const authors = (meta.authors || []).map(flipName);
  const families = (meta.authors || []).map(familyOf).filter(Boolean);
  const venue = getField(bibtex, 'booktitle').replace(/[{}]/g, '').trim() || null;
  return {
    title: meta.title,
    authors,
    authorFamilies: families,
    firstAuthorFamily: meta.firstAuthorFamily || families[0] || '',
    year: meta.year,
    venue,
    doi: null, // CVF open-access papers have no DOI of their own
    thecvfUrl: url || null,
    citedBy: 0, // CVF exposes no citation counts
    type: 'inproceedings',
    source: 'thecvf',
    thecvfBibtex: bibtex,
  };
}

/** Fetch a CVF paper page (normalizing a PDF link to its HTML page) and parse it. */
export async function fetchCvfByUrl(url, { signal } = {}) {
  const pageUrl = cvfHtmlUrl(url);
  const res = await fetch(pageUrl, { signal, headers: { Accept: 'text/html' } });
  if (!res.ok) throw new Error(`CVF page fetch failed (${res.status})`);
  const html = await res.text();
  return parseCvfHtml(html, pageUrl);
}
