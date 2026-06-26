// arXiv adapter — canonical preprints. arXiv papers carry DataCite DOIs
// (10.48550/arXiv.<id>) that Crossref/OpenAlex don't index by title, so without
// this source the canonical version of famous preprints is unreachable via title
// search. Once found, the candidate walks the existing DOI content-negotiation
// path for BibTeX.
//
// The MV3 service worker has no DOMParser, so we parse the Atom feed with a
// small regex-based extractor. parseArxivEntry / parseArxivFeed are pure (tested).
const API = 'https://export.arxiv.org/api/query';

/** Extract the bare (version-stripped) arXiv id from an Atom <id> URL. */
export function arxivIdFromUrl(id) {
  const m = String(id || '').match(/arxiv\.org\/abs\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i);
  return m ? m[1] : null;
}

/** Extract a bare (version-stripped) arXiv id from a pdf link, e.g. …/pdf/2103.05236v2. */
export function arxivIdFromPdf(pdf) {
  const m = String(pdf || '').match(/arxiv\.org\/pdf\/([0-9]{4}\.[0-9]{4,5})(?:v\d+)?/i);
  return m ? m[1] : null;
}

function firstTag(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].trim() : '';
}

function allNames(xml) {
  // Within an <entry>, <name> only appears inside <author> blocks.
  const out = [];
  const re = /<name>([\s\S]*?)<\/name>/gi;
  let m;
  while ((m = re.exec(xml))) out.push(m[1].trim());
  return out;
}

/** Convert one Atom <entry> (as a string) into a normalized candidate. */
export function parseArxivEntry(entry) {
  const title = firstTag(entry, 'title').replace(/\s+/g, ' ').trim();
  const arxivId = arxivIdFromUrl(firstTag(entry, 'id'));
  const published = firstTag(entry, 'published');
  const year = published ? Number(published.slice(0, 4)) || null : null;
  const authors = allNames(entry);
  const families = authors.map((n) => n.trim().split(/\s+/).pop()).filter(Boolean);
  return {
    title,
    authors,
    authorFamilies: families,
    firstAuthorFamily: families[0] || '',
    year,
    venue: 'arXiv',
    doi: arxivId ? `10.48550/arXiv.${arxivId}` : null,
    arxivId,
    citedBy: 0, // arXiv exposes no citation counts
    type: 'preprint',
    source: 'arxiv',
  };
}

/** Parse an arXiv Atom feed string into a list of candidates. */
export function parseArxivFeed(xml) {
  const out = [];
  const re = /<entry>([\s\S]*?)<\/entry>/gi;
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(parseArxivEntry(m[1]));
  return out;
}

/** arXiv title-field search (`ti:"..."`). Precise; returns canonical preprints first. */
export async function searchArxiv(title, { rows = 5, signal } = {}) {
  const url = new URL(API);
  // Quote the phrase for a title-field match; strip chars that would break it.
  const cleanTitle = String(title || '')
    .replace(/["\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  url.searchParams.set('search_query', `ti:"${cleanTitle}"`);
  url.searchParams.set('max_results', String(rows));

  const doFetch = () => fetch(url, { signal, headers: { Accept: 'application/atom+xml' } });
  let res = await doFetch();
  // arXiv asks for ≤1 req / 3s; back off once and retry on a polite-use 429.
  if (res.status === 429) {
    await new Promise((r) => setTimeout(r, 1500));
    res = await doFetch();
  }
  if (!res.ok) throw new Error(`arXiv search failed (${res.status})`);
  return parseArxivFeed(await res.text());
}
