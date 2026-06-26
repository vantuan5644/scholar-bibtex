// DBLP adapter — strong for CS venues, often the only source with clean BibTeX
// when there is no DOI. parseDblpHit is pure; the fetchers hit network.
const SEARCH_API = 'https://dblp.org/search/publ/api';

/** Convert a DBLP hit (`info` object) into a normalized candidate. */
export function parseDblpHit(hit = {}) {
  const info = hit.info || hit;
  let authors = info.authors?.author;
  if (authors) {
    authors = (Array.isArray(authors) ? authors : [authors]).map((a) =>
      typeof a === 'string' ? a : a.text || '',
    );
  } else {
    authors = [];
  }
  const families = authors
    .map((a) => a.trim().split(/\s+/).pop())
    .filter(Boolean);
  return {
    title: String(info.title || '').replace(/\.$/, ''),
    authors,
    authorFamilies: families,
    firstAuthorFamily: families[0] || '',
    year: info.year ? Number(info.year) : null,
    venue: info.venue || null,
    doi: info.doi || null,
    dblpKey: info.key || null,
    type: info.type || null,
    source: 'dblp',
  };
}

/** DBLP publication search (JSON). */
export async function searchDblp(title, { rows = 5, signal } = {}) {
  const url = new URL(SEARCH_API);
  url.searchParams.set('q', title);
  url.searchParams.set('format', 'json');
  url.searchParams.set('h', String(rows));
  const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`DBLP search failed (${res.status})`);
  const data = await res.json();
  const hits = data?.result?.hits?.hit || [];
  return hits.map(parseDblpHit);
}

/** Fetch BibTeX by DBLP record key, e.g. journals/corr/abs-2407-15516. */
export async function fetchDblpBibByKey(key, { signal } = {}) {
  const res = await fetch(`https://dblp.org/rec/${key}.bib?param=1`, {
    signal,
    headers: { Accept: 'application/x-bibtex' },
  });
  if (!res.ok) throw new Error(`DBLP bib failed (${res.status})`);
  const text = (await res.text()).trim();
  if (!text.startsWith('@')) throw new Error('DBLP returned no BibTeX');
  return text;
}

/** Fetch BibTeX by DOI via DBLP's doi endpoint. */
export async function fetchDblpBibByDoi(doi, { signal } = {}) {
  const clean = String(doi).replace(/^https?:\/\/(?:dx\.)?doi\.org\//i, '');
  const res = await fetch(`https://dblp.org/doi/${clean}.bib?param=1`, {
    signal,
    headers: { Accept: 'application/x-bibtex' },
  });
  if (!res.ok) throw new Error(`DBLP doi bib failed (${res.status})`);
  const text = (await res.text()).trim();
  if (!text.startsWith('@')) throw new Error('DBLP returned no BibTeX');
  return text;
}
