// Content script for scholar.google.com (single-file, messaging-only).
// Parses result rows, injects a "BibTeX" action, and renders a toast/picker.
// Never calls scholarly APIs directly — everything goes through the background.
(() => {
  'use strict';

  const MSG = {
    SEARCH: 'SEARCH',
    GET_BIBTEX: 'GET_BIBTEX',
    RESOLVE_INLINE: 'RESOLVE_INLINE',
  };

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
    '': '',
  };

  const FLAGGED = new WeakSet(); // avoid double-injecting the same result node

  // --- DOM helpers ---------------------------------------------------------
  function send(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (resp) => resolve(resp || {}));
      } catch (e) {
        resolve({ action: 'error', error: e?.message || 'messaging failed' });
      }
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback for the rare case the page isn't focused.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch {
        ok = false;
      }
      ta.remove();
      return ok;
    }
  }

  // --- Scholar DOM parsing -------------------------------------------------
  function parseByline(text) {
    // "A Vaswani, N Shazeer - Advances in neural information … - 2017"
    const parts = String(text || '').split(/\s+-\s+/);
    const authorsStr = parts[0] || '';
    const venue = parts.slice(1).join(' - ');
    const yearMatch = String(text || '').match(/\b(1[6-9]|20)\d{2}\b/);
    const authors = authorsStr
      .split(',')
      .map((a) => a.trim())
      .filter(Boolean);
    return { authors, year: yearMatch ? Number(yearMatch[0]) : null, venue: venue || null };
  }

  function readResult(row) {
    const ri = row.querySelector('.gs_ri');
    if (!ri) return null;
    const rt = ri.querySelector('.gs_rt');
    const titleLink = ri.querySelector('.gs_rt a');
    let title = (rt?.textContent || '').trim();
    title = title.replace(/^\[[A-Z]+\]\s*/, ''); // strip [PDF]/[HTML] labels
    const byline = ri.querySelector('.gs_a')?.textContent || '';
    const { authors, year, venue } = parseByline(byline);

    // Look for a DOI/arXiv anywhere in the result's links/snippet.
    const haystack = [
      titleLink?.href,
      titleLink?.textContent,
      ri.querySelector('.gs_rs')?.textContent,
      ...[...ri.querySelectorAll('a')].map((a) => a.href + ' ' + a.textContent),
    ]
      .filter(Boolean)
      .join(' ');
    const doi = haystack.match(/\b10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+/i)?.[0]
      ?.replace(/[.,;})\]"']+$/, '');
    const arxiv =
      haystack.match(/arxiv\s*[:=]\s*([0-9.]+)/i)?.[1] ||
      haystack.match(/\b\d{4}\.\d{4,5}(?:v\d+)?\b/)?.[0];
    // CVF Open Access link (often the [PDF] thecvf.com result, which has no DOI).
    const cvf = haystack.match(
      /https?:\/\/(?:openaccess\.thecvf\.com|(?:www\.)?cv-foundation\.org\/openaccess)\/[^\s"'<>)]+/i,
    )?.[0];

    return {
      title,
      authors,
      year,
      venue,
      doi: doi || null,
      arxiv: arxiv || null,
      cvf: cvf || null,
      href: titleLink?.href || null,
      fl: ri.querySelector('.gs_fl'),
    };
  }

  // --- injection -----------------------------------------------------------
  function injectButton(row, data) {
    if (!data.fl || FLAGGED.has(data.fl) || !data.title) return;
    FLAGGED.add(data.fl);

    const sep = document.createTextNode(' · ');
    const btn = document.createElement('a');
    btn.href = 'javascript:void(0)';
    btn.className = 'gs_sbt-btn';
    btn.textContent = 'BibTeX ⧉';
    btn.title = 'Copy BibTeX via open APIs';
    data.fl.appendChild(sep);
    data.fl.appendChild(btn);

    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();
      btn.classList.add('gs_sbt-busy');
      const resp = await send({
        type: MSG.RESOLVE_INLINE,
        title: data.title,
        authors: data.authors,
        year: data.year,
        doi: data.doi || (data.arxiv ? `10.48550/arXiv.${data.arxiv}` : null),
        cvfUrl: data.cvf,
        href: data.href,
      });
      btn.classList.remove('gs_sbt-busy');

      if (resp.action === 'copied') {
        const ok = await copyText(resp.bibtex);
        toast(ok ? `copied · via ${SOURCE_LABEL[resp.source] || resp.source}` : 'copy failed', ok ? 'ok' : 'err');
      } else if (resp.action === 'pick') {
        showPicker(btn, resp.candidates, resp.note);
      } else {
        toast(resp.error || 'no match', 'err');
      }
    });
  }

  function scan(root = document) {
    const rows = root.querySelectorAll('.gs_r');
    rows.forEach((row) => {
      const data = readResult(row);
      if (data) injectButton(row, data);
    });
  }

  // --- toast ---------------------------------------------------------------
  let toastTimer = null;
  function toast(message, kind = 'ok') {
    let el = document.getElementById('gs_sbt-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'gs_sbt-toast';
      document.body.appendChild(el);
    }
    el.className = `gs_sbt-toast gs_sbt-toast--${kind}`;
    el.textContent = message;
    el.classList.add('gs_sbt-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('gs_sbt-show'), 2600);
  }

  // --- inline picker -------------------------------------------------------
  function badge(sources) {
    return (sources || []).map((s) => `<span class="gs_sbt-badge">${SOURCE_LABEL[s] || s}</span>`).join('');
  }

  function showPicker(anchor, candidates, note) {
    closePicker();
    if (!candidates || !candidates.length) {
      toast(note || 'no strong match', 'err');
      return;
    }

    const panel = document.createElement('div');
    panel.id = 'gs_sbt-picker';
    panel.className = 'gs_sbt-picker';
    panel.innerHTML =
      `<div class="gs_sbt-picker-head">Pick the right paper</div>` +
      candidates
        .map(
          (c, i) => `
        <div class="gs_sbt-card${i === 0 ? ' gs_sbt-card--best' : ''}" data-i="${i}">
          <div class="gs_sbt-card-title">${escapeHtml(c.title)}</div>
          <div class="gs_sbt-card-meta">${escapeHtml((c.authors || []).slice(0, 3).join(', '))}${
            c.authors && c.authors.length > 3 ? ' et al.' : ''
          }${c.year ? ' · ' + c.year : ''}${c.venue ? ' · ' + escapeHtml(c.venue) : ''}</div>
          <div class="gs_sbt-card-foot">${badge(c.sources)}<button class="gs_sbt-copy" data-i="${i}">Copy ⧉</button></div>
        </div>`,
        )
        .join('');

    document.body.appendChild(panel);
    positionAt(panel, anchor);

    panel.addEventListener('click', async (e) => {
      const card = e.target.closest('.gs_sbt-card');
      if (!card) return;
      const i = Number(card.dataset.i);
      const candidate = candidates[i];
      const copyBtn = e.target.closest('.gs_sbt-copy');
      if (copyBtn) copyBtn.textContent = '…';
      const resp = await send({ type: MSG.GET_BIBTEX, candidate });
      if (resp.bibtex) {
        await copyText(resp.bibtex);
        toast(`copied · via ${SOURCE_LABEL[resp.source] || resp.source}`, 'ok');
        closePicker();
      } else {
        toast(resp.error || 'failed to fetch BibTeX', 'err');
        if (copyBtn) copyBtn.textContent = 'Copy ⧉';
      }
    });

    setTimeout(() => document.addEventListener('click', onDocClick, { once: true }), 0);
  }

  function onDocClick(e) {
    const picker = document.getElementById('gs_sbt-picker');
    if (picker && !picker.contains(e.target)) closePicker();
    else document.addEventListener('click', onDocClick, { once: true });
  }

  function closePicker() {
    document.getElementById('gs_sbt-picker')?.remove();
  }

  function positionAt(panel, anchor) {
    const r = anchor.getBoundingClientRect();
    panel.style.top = `${r.bottom + window.scrollY + 6}px`;
    panel.style.left = `${r.left + window.scrollX}px`;
  }

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // --- boot + observe ------------------------------------------------------
  const start = () => scan(document);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  // Scholar lazy-loads more results on some interactions; re-scan on changes.
  let scanTimer = null;
  const mo = new MutationObserver(() => {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => scan(document), 200);
  });
  mo.observe(document.body, { childList: true, subtree: true });
})();
