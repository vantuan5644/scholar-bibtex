// The resolver pipeline (Steps A–E). Orchestrates classify → search → rank → bibtex.
// Runs inside the background service worker. Network calls use global fetch.
import { classifyInput } from './classify.js';
import { searchCrossref, parseCrossrefItem } from './crossref.js';
import { searchOpenAlex, parseOpenAlexItem } from './openalex.js';
import { searchDblp, fetchDblpBibByKey, fetchDblpBibByDoi } from './dblp.js';
import { searchS2, fetchS2BibtexByDoi } from './semanticscholar.js';
import { searchArxiv } from './arxiv.js';
import { searchOpenReview, fetchOpenReviewNoteByForum } from './openreview.js';
import { fetchCvfByUrl } from './thecvf.js';
import { mergeAndRank, similarity } from './rank.js';
import { fetchBibtexByDoi, rewriteCiteKey, constructBibtex, parseBibtexMeta } from './bibtex.js';
// (fetchBibtexByDoi is reused below as a last-resort metadata source for DOIs
//  that no metadata API indexes — notably arXiv's DataCite 10.48550/arXiv.*.)

/** Run a set of source searches, keeping those that succeed. */
async function runSources(jobs) {
  const settled = await Promise.allSettled(jobs);
  const buckets = [];
  for (let i = 0; i < settled.length; i++) {
    const r = settled[i];
    if (r.status === 'fulfilled') buckets.push(r.value);
  }
  return buckets;
}

/**
 * Resolve an arbitrary input into ranked candidates.
 * @returns {{mode: string, candidates: object[], classification?: object, error?: string, tried?: string[]}}
 */
export async function resolveCandidates(input, opts = {}) {
  const { signal, mailto } = opts;
  const cls = classifyInput(input);
  if (cls.type === 'empty') return { mode: 'empty', candidates: [] };

  if (cls.type === 'doi' || cls.type === 'arxiv') {
    const candidate = await candidateFromDoi(cls.doi, { signal, mailto });
    return { mode: 'exact', candidates: [candidate], classification: cls };
  }

  if (cls.type === 'openreview') {
    const candidate = await fetchOpenReviewNoteByForum(cls.forum, { signal });
    return { mode: 'exact', candidates: [candidate], classification: cls };
  }

  if (cls.type === 'thecvf') {
    const candidate = await fetchCvfByUrl(cls.url, { signal });
    return { mode: 'exact', candidates: [{ ...candidate, score: 1, sources: ['thecvf'] }], classification: cls };
  }

  if (cls.type === 'url') {
    return {
      mode: 'error',
      error: "Couldn't find a DOI or arXiv id in that URL. Paste the paper's DOI or arXiv id instead.",
      candidates: [],
    };
  }

  return resolveTitle(cls.title, { signal, mailto });
}

/** Build a display candidate for a DOI by pulling metadata from Crossref, then OpenAlex. */
async function candidateFromDoi(doi, { signal, mailto } = {}) {
  const clean = doi.replace(/^https?:\/\/(dx\.)?doi\.org\//i, '');
  try {
    const url = new URL(`https://api.crossref.org/works/${clean}`);
    if (mailto) url.searchParams.set('mailto', mailto);
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const c = parseCrossrefItem(data.message);
      return { ...c, score: 1, sources: ['crossref'] };
    }
  } catch {
    /* try OpenAlex next */
  }
  try {
    const url = new URL(`https://api.openalex.org/works/doi:${clean}`);
    url.searchParams.set('select', 'id,doi,title,authorships,publication_year,primary_location,type,type_crossref,ids');
    if (mailto) url.searchParams.set('mailto', mailto);
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (res.ok) {
      const data = await res.json();
      const c = parseOpenAlexItem(data);
      return { ...c, score: 1, sources: ['openalex'] };
    }
  } catch {
    /* fall through to BibTeX-derived metadata */
  }
  // Last resort: no metadata API indexes this DOI (e.g. arXiv's DataCite DOIs).
  // The BibTeX content-negotiation below always works, so parse a display
  // candidate out of it rather than showing an empty "(untitled)" card.
  try {
    const bibtex = await fetchBibtexByDoi(doi, { signal });
    const m = parseBibtexMeta(bibtex);
    return {
      title: m.title,
      authors: m.authors,
      authorFamilies: [],
      firstAuthorFamily: m.firstAuthorFamily,
      year: m.year,
      venue: null,
      doi,
      type: null,
      source: 'doi',
      sources: ['doi'],
      score: 1,
    };
  } catch {
    /* fall through to a bare-DOI candidate */
  }
  return {
    title: '',
    authors: [],
    firstAuthorFamily: '',
    year: null,
    venue: null,
    doi,
    type: null,
    source: 'doi',
    sources: ['doi'],
    score: 1,
  };
}

/**
 * Title search path (Step C+D). Runs Crossref ∥ OpenAlex ∥ arXiv ∥ OpenAlex in
 * the primary batch; if the best match is thin, also pulls DBLP + Semantic
 * Scholar and re-ranks.
 */
async function resolveTitle(title, { signal, mailto } = {}) {
  const primary = await runSources([
    searchCrossref(title, { mailto, signal }).then((items) => ({ source: 'crossref', items })),
    searchOpenAlex(title, { signal, mailto }).then((items) => ({ source: 'openalex', items })),
    searchArxiv(title, { signal }).then((items) => ({ source: 'arxiv', items })),
    searchOpenReview(title, { signal }).then((items) => ({ source: 'openreview', items })),
  ]);

  let candidates = mergeAndRank(title, primary);
  const tried = primary.map((b) => b.source);

  // Only fetch extra sources when the top result isn't corroborated by ≥2
  // independent sources — clear matches stay fast, ambiguous ones get DBLP + S2.
  const topCorroborated = candidates[0]?.sources?.length >= 2;
  if ((!candidates[0] || candidates[0].score < 0.7 || !topCorroborated) && candidates.length < 5) {
    const extra = await runSources(
      [
        searchDblp(title, { signal }).then((items) => ({ source: 'dblp', items })),
        searchS2(title, { signal }).then((items) => ({ source: 'semanticscholar', items })),
      ],
    );
    tried.push(...extra.map((b) => b.source));
    candidates = mergeAndRank(title, [...primary, ...extra]);
  }

  return { mode: 'title', candidates, tried: [...new Set(tried)] };
}

/**
 * Score how well a candidate's authors overlap the authors already known from
 * the Scholar page (extra disambiguation signal for the inline path).
 */
export function authorOverlap(candidate, knownAuthors = []) {
  if (!knownAuthors.length || !candidate?.authorFamilies?.length) return 0;
  const known = new Set(
    knownAuthors.map((a) => a.toLowerCase().split(/\s+/).pop()).filter(Boolean),
  );
  let hit = 0;
  for (const f of candidate.authorFamilies) {
    const last = f.toLowerCase();
    if ([...known].some((k) => k === last || k.startsWith(last.slice(0, 4)) || last.startsWith(k.slice(0, 4)))) hit++;
  }
  return hit / Math.max(known.size, 1);
}

/**
 * Step E — fetch BibTeX for a chosen candidate, walking a reliability chain:
 * DOI content-negotiation → DBLP key → DBLP-by-DOI → Semantic Scholar → construct.
 * Applies cite-key rewriting unless settings.citeKeyStyle === 'raw'.
 */
export async function fetchBibtexForCandidate(candidate, opts = {}) {
  const { signal, settings = {} } = opts;
  const errors = [];
  let result = null;

  if (candidate.doi) {
    try {
      result = { bibtex: await fetchBibtexByDoi(candidate.doi, { signal }), source: 'doi' };
    } catch (e) {
      errors.push(`doi: ${e.message}`);
    }
  }
  if (!result && candidate.dblpKey) {
    try {
      result = { bibtex: await fetchDblpBibByKey(candidate.dblpKey, { signal }), source: 'dblp' };
    } catch (e) {
      errors.push(`dblp: ${e.message}`);
    }
  }
  if (!result && candidate.doi) {
    try {
      result = { bibtex: await fetchDblpBibByDoi(candidate.doi, { signal }), source: 'dblp' };
    } catch (e) {
      errors.push(`dblp-doi: ${e.message}`);
    }
    if (!result) {
      try {
        result = { bibtex: await fetchS2BibtexByDoi(candidate.doi, { signal }), source: 'semanticscholar' };
      } catch (e) {
        errors.push(`s2: ${e.message}`);
      }
    }
  }
  if (!result && candidate.openreviewBibtex) {
    result = { bibtex: candidate.openreviewBibtex, source: 'openreview' };
  }
  if (!result && candidate.thecvfBibtex) {
    result = { bibtex: candidate.thecvfBibtex, source: 'thecvf' };
  }
  if (!result) {
    result = { bibtex: constructBibtex(candidate), source: 'constructed' };
  }

  if (settings.citeKeyStyle !== 'raw') {
    try {
      // Prefer metadata parsed from the returned BibTeX (authoritative), falling
      // back to candidate metadata. Fixes bare-DOI keys like `anonndref`.
      const bMeta = parseBibtexMeta(result.bibtex);
      const keyMeta = {
        title: bMeta.title || candidate.title,
        year: bMeta.year || candidate.year,
        authors: bMeta.authors?.length ? bMeta.authors : candidate.authors,
        firstAuthorFamily: bMeta.firstAuthorFamily || candidate.firstAuthorFamily,
      };
      result.bibtex = rewriteCiteKey(result.bibtex, keyMeta);
      result.key = `${keyMeta.firstAuthorFamily}${keyMeta.year || 'nd'}`.toLowerCase();
    } catch {
      /* keep original key on failure */
    }
  }

  result.errors = errors;
  return result;
}

export { similarity };
