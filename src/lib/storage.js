// Thin wrappers over chrome.storage.local. chrome.* only — not imported by tests.
const DAY = 24 * 60 * 60 * 1000;
const CACHE_TTL = 30 * DAY;
const RECENTS_MAX = 20;

const KEYS = {
  cache: 'cache',
  recents: 'recents',
  settings: 'settings',
};

const DEFAULT_SETTINGS = {
  citeKeyStyle: 'nice', // 'nice' | 'raw'
  mailto: '', // polite pool email (optional)
  autoCopyInline: true, // auto-copy high-confidence inline matches
};

function get(key) {
  return new Promise((resolve) => chrome.storage.local.get(key, (v) => resolve(v ?? {})));
}
function set(obj) {
  return new Promise((resolve) => chrome.storage.local.set(obj, () => resolve()));
}

export async function getSettings() {
  const v = await get(KEYS.settings);
  return { ...DEFAULT_SETTINGS, ...(v[KEYS.settings] || {}) };
}
export async function setSettings(patch) {
  const current = await getSettings();
  const next = { ...current, ...patch };
  await set({ [KEYS.settings]: next });
  return next;
}

// --- cache ------------------------------------------------------------------
export async function getCache(key) {
  const v = await get(KEYS.cache);
  const entry = (v[KEYS.cache] || {})[key];
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) return null;
  return entry.value;
}
export async function setCache(key, value) {
  const v = await get(KEYS.cache);
  const cache = v[KEYS.cache] || {};
  cache[key] = { value, ts: Date.now() };
  // Bound the cache to avoid unbounded growth.
  const entries = Object.entries(cache);
  if (entries.length > 500) {
    entries
      .sort((a, b) => a[1].ts - b[1].ts)
      .slice(0, entries.length - 500)
      .forEach(([k]) => delete cache[k]);
  }
  await set({ [KEYS.cache]: cache });
}

// --- recents ----------------------------------------------------------------
export async function getRecents() {
  const v = await get(KEYS.recents);
  return v[KEYS.recents] || [];
}
export async function addRecent(entry) {
  const list = await getRecents();
  const filtered = list.filter((r) => r.key !== entry.key);
  filtered.unshift({ ...entry, ts: Date.now() });
  await set({ [KEYS.recents]: filtered.slice(0, RECENTS_MAX) });
  return filtered;
}
