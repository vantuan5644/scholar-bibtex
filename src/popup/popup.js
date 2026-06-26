// Popup logic (module). Sniffs input, renders candidate cards, manages recents.
import { sendMessage, MSG } from '../lib/messaging.js';
import { getRecents, getSettings, setSettings } from '../lib/storage.js';

const SOURCE_LABEL = {
  doi: 'Crossref',
  crossref: 'Crossref',
  openalex: 'OpenAlex',
  dblp: 'DBLP',
  semanticscholar: 'Semantic Scholar',
  arxiv: 'arXiv',
  openreview: 'OpenReview',
  thecvf: 'CVF',
  constructed: 'constructed',
};

const $ = (sel) => document.querySelector(sel);

const q = $('#q');
const results = $('#results');
const status = $('#status');
const recentsEl = $('#recents');
const recentsSection = $('#recents-section');
const toastEl = $('#toast');

let debounceTimer = null;
let searchSeq = 0;

// --- status & toast --------------------------------------------------------
function setStatus(text, kind) {
  status.hidden = !text;
  status.textContent = text || '';
  status.className = 'status' + (kind ? ` status--${kind}` : '');
}

let toastTimer = null;
function toast(message, kind) {
  toastEl.hidden = false;
  toastEl.textContent = message;
  toastEl.className = 'toast' + (kind ? ` toast--${kind}` : '');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (toastEl.hidden = true), 2200);
}

async function copy(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

// --- search ----------------------------------------------------------------
async function runSearch(query) {
  const seq = ++searchSeq;
  if (!query.trim()) {
    results.innerHTML = '';
    setStatus('');
    recentsSection.hidden = false;
    return;
  }
  setStatus('searching…', 'busy');
  recentsSection.hidden = true;
  const resp = await sendMessage({ type: MSG.SEARCH, query });
  if (seq !== searchSeq) return; // a newer search superseded this one

  if (resp.error) return setStatus(resp.error, 'err');
  if (resp.mode === 'empty') {
    results.innerHTML = '';
    setStatus('');
    return;
  }
  if (resp.mode === 'error') return setStatus(resp.error || 'unsupported input', 'err');

  renderCandidates(resp.candidates, resp.tried, resp.cached);
}

let lastCandidates = [];

function renderCandidates(candidates, tried, cached) {
  lastCandidates = candidates || [];
  results.innerHTML = '';
  if (!candidates || !candidates.length) {
    setStatus(
      `No strong match${tried?.length ? ` (tried ${tried.join(', ')})` : ''}. Try refining the title.`,
      'err',
    );
    return;
  }
  setStatus(
    `${candidates.length} candidate${candidates.length > 1 ? 's' : ''}${
      cached ? ' · cached' : ''
    } — verify before copying`,
  );

  candidates.forEach((c, i) => {
    const card = document.createElement('div');
    card.className = 'card' + (i === 0 ? ' card--best' : '');
    const authors = (c.authors || []).slice(0, 3).join(', ');
    card.innerHTML = `
      <div class="card-title">${esc(c.title) || '(untitled)'}</div>
      <div class="card-meta">${esc(authors)}${c.authors?.length > 3 ? ' et al.' : ''}${
        c.year ? ' · ' + c.year : ''
      }${c.venue ? ' · ' + esc(c.venue) : ''}</div>
      <div class="card-foot">
        ${(c.sources || []).map((s) => `<span class="badge">${SOURCE_LABEL[s] || s}</span>`).join('')}
        <span class="score">${Math.round((c.score || 0) * 100)}%</span>
        <button class="copy-btn" data-i="${i}">Copy ⧉</button>
      </div>`;
    results.appendChild(card);
  });
}

results.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy-btn');
  if (!btn) return;
  const i = Number(btn.dataset.i);
  const candidate = pickFromDom(i);
  if (!candidate) return;
  btn.disabled = true;
  btn.textContent = '…';
  const resp = await sendMessage({ type: MSG.GET_BIBTEX, candidate });
  btn.disabled = false;
  btn.textContent = 'Copy ⧉';
  if (resp.bibtex) {
    await copy(resp.bibtex);
    toast(`copied · via ${SOURCE_LABEL[resp.source] || resp.source}`);
    refreshRecents();
  } else {
    toast(resp.error || 'failed', 'err');
  }
});

function pickFromDom(i) {
  return lastCandidates[i];
}

// --- recents ---------------------------------------------------------------
async function refreshRecents() {
  const recents = await getRecents();
  recentsEl.innerHTML = '';
  if (!recents.length) {
    recentsSection.hidden = !q.value.trim() ? false : recentsSection.hidden;
    return;
  }
  recents.forEach((r) => {
    const el = document.createElement('div');
    el.className = 'recent';
    el.innerHTML = `
      <div class="recent-main">
        <div class="recent-title">${esc(r.title || '(untitled)')}</div>
        <div class="recent-sub">${esc((r.authors || []).slice(0, 2).join(', '))}${
          r.year ? ' · ' + r.year : ''
        } · ${SOURCE_LABEL[r.source] || r.source || ''}</div>
      </div>
      <span class="recent-copy">⧉</span>`;
    el.title = 'Click to re-copy';
    el.addEventListener('click', async () => {
      if (r.bibtex && (await copy(r.bibtex))) toast('copied from recent');
      else toast('recent unavailable', 'err');
    });
    recentsEl.appendChild(el);
  });
}

recentsSection.querySelector('#clear-recents').addEventListener('click', async () => {
  await sendMessage({ type: MSG.CLEAR_RECENTS });
  refreshRecents();
});

// --- settings --------------------------------------------------------------
const gear = $('#gear');
const settingsPanel = $('#settings');
gear.addEventListener('click', () => (settingsPanel.hidden = !settingsPanel.hidden));

async function loadSettings() {
  const s = await getSettings();
  $('#cite-key-style').value = s.citeKeyStyle;
  $('#mailto').value = s.mailto || '';
  $('#auto-inline').checked = !!s.autoCopyInline;
}
$('#cite-key-style').addEventListener('change', (e) => setSettings({ citeKeyStyle: e.target.value }));
$('#mailto').addEventListener('change', (e) => setSettings({ mailto: e.target.value.trim() }));
$('#auto-inline').addEventListener('change', (e) => setSettings({ autoCopyInline: e.target.checked }));

// --- input wiring ----------------------------------------------------------
q.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runSearch(q.value), 300);
});
q.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    clearTimeout(debounceTimer);
    runSearch(q.value);
  } else if (e.key === 'Escape') {
    q.value = '';
    runSearch('');
  }
});

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// --- boot ------------------------------------------------------------------
loadSettings();
refreshRecents();
q.focus();
