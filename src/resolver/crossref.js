// Crossref adapter. parseCrossrefItem is pure (tested); searchCrossref hits network.
const API = 'https://api.crossref.org/works';

function pickYear(it = {}) {
  for (const c of [it.published, it['published-print'], it['published-online'], it.issued]) {
    const y = c?.['date-parts']?.[0]?.[0];
    if (y) return y;
  }
  return null;
}

/** Convert a Crossref `/works` item into a normalized candidate. */
export function parseCrossrefItem(it = {}) {
  const authors = (it.author || []).map((a) => ({
    given: a.given || '',
    family: a.family || '',
    display: [a.given, a.family].filter(Boolean).join(' '),
  }));
  const container = it['container-title'];
  const venue = Array.isArray(container) ? container[0] : container || null;
  return {
    title: Array.isArray(it.title) ? it.title[0] || '' : it.title || '',
    authors: authors.map((a) => a.display).filter(Boolean),
    authorFamilies: authors.map((a) => a.family).filter(Boolean),
    firstAuthorFamily: authors[0]?.family || '',
    year: pickYear(it),
    venue: venue || null,
    doi: it.DOI || null,
    type: it.type || null,
    citedBy: Number(it['is-referenced-by-count']) || 0,
    source: 'crossref',
  };
}

/** `query.bibliographic` search; pass `mailto` for the Crossref polite pool. */
export async function searchCrossref(title, { mailto, rows = 5, signal } = {}) {
  const url = new URL(API);
  url.searchParams.set('query.bibliographic', title);
  url.searchParams.set('rows', String(rows));
  url.searchParams.set(
    'select',
    'DOI,title,author,published-print,published-online,issued,container-title,type,is-referenced-by-count',
  );
  if (mailto) url.searchParams.set('mailto', mailto);
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`Crossref search failed (${res.status})`);
  const data = await res.json();
  return (data?.message?.items || []).map(parseCrossrefItem);
}
