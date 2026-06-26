// Messaging helpers shared by content script and popup. chrome.* only.

/** Promise-based chrome.runtime.sendMessage. */
export function sendMessage(message) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage(message, (resp) => resolve(resp));
    } catch (e) {
      resolve({ error: e?.message || 'messaging failed' });
    }
  });
}

/** Message type constants (kept in sync between surfaces and background). */
export const MSG = {
  SEARCH: 'SEARCH', // {type, query} -> {mode, candidates, error?, tried?}
  GET_BIBTEX: 'GET_BIBTEX', // {type, candidate} -> {bibtex, source, key, error?}
  RESOLVE_INLINE: 'RESOLVE_INLINE', // {type, title, authors, year, doi, href}
  //   -> {action:'copied', bibtex, source} | {action:'pick', candidates} | {action:'error', error}
  CLEAR_RECENTS: 'CLEAR_RECENTS', // {} -> {ok}
};
