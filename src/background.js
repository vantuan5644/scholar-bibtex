// Background service worker (MV3 module). Holds host_permissions, centralizes
// caching/recents, and keeps both surfaces thin (they only parse + render).
import { resolveCandidates, fetchBibtexForCandidate, authorOverlap } from './resolver/index.js';
import { fetchCvfByUrl } from './resolver/thecvf.js';
import { normalizeTitle } from './resolver/text.js';
import { getSettings, getCache, setCache, addRecent } from './lib/storage.js';
import { MSG } from './lib/messaging.js';

const AUTO_SCORE = 0.9; // inline: above this (with author agreement) we auto-copy.

chrome.runtime.onInstalled.addListener(async () => {
  // Seed defaults; harmless if already present.
  await getSettings();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  // Always respond asynchronously.
  (async () => {
    try {
      switch (msg?.type) {
        case MSG.SEARCH:
          sendResponse(await handleSearch(msg));
          return;
        case MSG.GET_BIBTEX:
          sendResponse(await handleGetBibtex(msg));
          return;
        case MSG.RESOLVE_INLINE:
          sendResponse(await handleResolveInline(msg));
          return;
        case MSG.CLEAR_RECENTS:
          await chrome.storage.local.remove('recents');
          sendResponse({ ok: true });
          return;
        default:
          sendResponse({ error: `unknown message type: ${msg?.type}` });
      }
    } catch (e) {
      sendResponse({ error: e?.message || String(e) });
    }
  })();
  return true; // keep the channel open for the async sendResponse above
});

async function settingsWithMailto() {
  const s = await getSettings();
  return { settings: s, mailto: s.mailto || undefined };
}

// --- SEARCH (popup) ---------------------------------------------------------
async function handleSearch({ query }) {
  if (!query || !query.trim()) return { mode: 'empty', candidates: [] };
  const key = `c:${normalizeTitle(query)}`;
  const cached = await getCache(key);
  if (cached) return { ...cached, cached: true };

  const opts = await settingsWithMailto();
  const result = await resolveCandidates(query, opts);
  await setCache(key, result);
  return result;
}

// --- GET_BIBTEX (popup card copy / inline pick) -----------------------------
async function handleGetBibtex({ candidate }) {
  if (!candidate) return { error: 'no candidate' };
  const cacheKey = `b:${(candidate.doi || candidate.dblpKey || normalizeTitle(candidate.title)).toLowerCase()}`;
  const cached = await getCache(cacheKey);
  if (cached) return { ...cached, cached: true };

  const opts = await settingsWithMailto();
  const { bibtex, source, errors } = await fetchBibtexForCandidate(candidate, opts);
  const payload = { bibtex, source, errors };
  await setCache(cacheKey, payload);
  await addRecent({
    key: cacheKey,
    title: candidate.title,
    authors: candidate.authors,
    year: candidate.year,
    venue: candidate.venue,
    doi: candidate.doi,
    source,
    bibtex,
  });
  return payload;
}

// --- RESOLVE_INLINE (content script on Scholar) -----------------------------
async function handleResolveInline({ title, authors = [], year, doi, href, cvfUrl }) {
  const opts = await settingsWithMailto();

  // Exact path: a DOI/arXiv was visible in the result link.
  if (doi) {
    try {
      const { bibtex, source } = await fetchBibtexForCandidate({ doi, title, authors }, opts);
      return { action: 'copied', bibtex, source };
    } catch (e) {
      return { action: 'error', error: e.message };
    }
  }

  // Exact path: the result links to a CVF Open Access paper (no DOI, but the
  // page carries a canonical BibTeX block). Falls through to title search on
  // failure rather than erroring.
  if (cvfUrl) {
    try {
      const candidate = await fetchCvfByUrl(cvfUrl);
      const { bibtex, source } = await fetchBibtexForCandidate(candidate, opts);
      return { action: 'copied', bibtex, source, candidate };
    } catch {
      /* fall through to title search */
    }
  }

  if (!title) return { action: 'error', error: 'No title to search.' };

  // Title path: rank, then decide auto-copy vs. show picker.
  const cacheKey = `c:${normalizeTitle(title)}`;
  let result = await getCache(cacheKey);
  if (!result) {
    result = await resolveCandidates(title, opts);
    await setCache(cacheKey, result);
  }

  const top = result.candidates?.[0];
  if (!top) {
    return { action: 'pick', candidates: [], tried: result.tried, note: 'No strong match — try the popup to broaden the search.' };
  }

  const overlap = authorOverlap(top, authors);
  const authorsAgree = !authors.length || overlap >= 0.4;
  // Year is a strong disambiguation signal on Scholar: the byline year is
  // reliable, and a same-titled republication (e.g. a 2025 reprint of the
  // 2017 "Attention Is All You Need") must NOT be auto-copied for the
  // original. A >1 year mismatch always forces the picker.
  const yearAgree = !year || !top.year || Math.abs(Number(year) - Number(top.year)) <= 1;
  const confident = top.score >= AUTO_SCORE && authorsAgree && yearAgree;

  if (opts.settings.autoCopyInline && confident) {
    try {
      const { bibtex, source } = await fetchBibtexForCandidate(top, opts);
      await addRecent({
        key: `b:${(top.doi || top.dblpKey || normalizeTitle(top.title)).toLowerCase()}`,
        title: top.title, authors: top.authors, year: top.year, venue: top.venue,
        doi: top.doi, source, bibtex,
      });
      return { action: 'copied', bibtex, source, candidate: top };
    } catch (e) {
      return { action: 'error', error: e.message };
    }
  }

  // Ambiguous — surface a picker. Pre-highlight the best (UI marks index 0).
  // Prefer candidates whose year matches the Scholar year when available.
  const ordered = year
    ? [...result.candidates].sort((a, b) => {
        const am = a.year && Math.abs(a.year - year) <= 1 ? 0 : 1;
        const bm = b.year && Math.abs(b.year - year) <= 1 ? 0 : 1;
        if (am !== bm) return am - bm;
        return (b.score || 0) - (a.score || 0);
      })
    : result.candidates;
  return { action: 'pick', candidates: ordered.slice(0, 3), tried: result.tried };
}
