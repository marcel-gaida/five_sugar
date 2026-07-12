(function () {
  if (window.__crlIndeedScannerInit) return;
  window.__crlIndeedScannerInit = true;

  const PANEL_ID = '__crl-indeed-panel';
  const BADGE_ATTR = 'data-crl-indeed-badge';

  // ── DOM selectors (stable data-testid attributes — won't break on CSS class changes) ──
  const COMPANY_SELECTOR = 'span[data-testid="company-name"]';
  const LOCATION_SELECTOR = '[data-testid="text-location"]';

  // ── Panel ──────────────────────────────────────────────────────────────────
  function getOrCreatePanel() {
    let panel = document.getElementById(PANEL_ID);
    if (panel) return panel;

    panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = '__crl-li-panel'; // reuse LinkedIn panel CSS
    panel.innerHTML = `
      <div class="__crl-li-panel-header">
        <span class="__crl-li-panel-title">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Ratings
        </span>
        <div style="display:flex;align-items:center;gap:5px;">
          <button id="__crl-indeed-scan-btn" class="__crl-li-scan-btn-small">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            Scan
          </button>
          <button id="__crl-indeed-panel-close" class="__crl-li-collapse-btn" title="Minimize">
            <svg id="__crl-indeed-collapse-icon" width="10" height="10" viewBox="0 0 10 10" fill="none">
              <rect id="__crl-indeed-min-bar" x="1" y="4.5" width="8" height="1.5" rx="0.75" fill="currentColor"/>
              <rect id="__crl-indeed-max-square" x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" style="display:none"/>
            </svg>
          </button>
          <button id="__crl-indeed-panel-remove" class="__crl-li-collapse-btn" title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="2" y1="8" x2="8" y2="2"/></svg>
          </button>
        </div>
      </div>
      <div class="__crl-li-panel-body" id="__crl-indeed-panel-body">
        <p class="__crl-li-hint">Click <strong>Scan</strong> to fetch Glassdoor &amp; Google Maps ratings for all companies on this Indeed page.</p>
      </div>
    `;
    document.body.appendChild(panel);

    const header = panel.querySelector('.__crl-li-panel-header');
    let isDragging = false;
    let startX, startY, initialX, initialY;

    header.addEventListener('mousedown', (e) => {
      if (e.target.tagName === 'BUTTON') return;
      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;
      const rect = panel.getBoundingClientRect();
      initialX = rect.left;
      initialY = rect.top;
      panel.style.right = 'auto';
      panel.style.bottom = 'auto';
      panel.style.left = initialX + 'px';
      panel.style.top = initialY + 'px';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDragging) return;
      panel.style.left = (initialX + e.clientX - startX) + 'px';
      panel.style.top = (initialY + e.clientY - startY) + 'px';
    });

    document.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Collapse/expand
    document.getElementById('__crl-indeed-panel-remove').addEventListener('click', () => {
      panel.remove();
    });

    document.getElementById('__crl-indeed-panel-close').addEventListener('click', () => {
      const collapsed = panel.classList.toggle('__crl-li-panel--collapsed');
      const minBar = document.getElementById('__crl-indeed-min-bar');
      const maxSquare = document.getElementById('__crl-indeed-max-square');
      const btn = document.getElementById('__crl-indeed-panel-close');
      if (collapsed) {
        if (minBar) minBar.style.display = 'none';
        if (maxSquare) maxSquare.style.display = '';
        if (btn) btn.title = 'Restore';
      } else {
        if (minBar) minBar.style.display = '';
        if (maxSquare) maxSquare.style.display = 'none';
        if (btn) btn.title = 'Minimize';
      }
    });

    document.getElementById('__crl-indeed-scan-btn').addEventListener('click', startBatchScan);

    // Restore table if cache exists
    if (window.__crlRatingCache && window.__crlRatingCache.size > 0) {
      const summary = [];
      for (const [name, results] of window.__crlRatingCache.entries()) {
        if (results?.glassdoor?.rating) {
            summary.push({ name, rating: parseFloat(results.glassdoor.rating) });
        }
      }
      renderSummaryTable(summary);
    }

    return panel;
  }

  function renderSummaryTable(summary) {
    const body = document.getElementById('__crl-indeed-panel-body');
    if (!body) return;
    
    summary.sort((a, b) => b.rating - a.rating);
    const rows = summary.slice(0, 20).map(c =>
      `<tr><td class="__crl-li-td-name">${c.name}</td><td class="__crl-li-td-rating">★ ${c.rating.toFixed(1)}</td></tr>`
    ).join('');

    body.innerHTML = `
      <p class="__crl-li-summary-line"><strong>${summary.length}</strong> companies scanned — sorted by Glassdoor ★</p>
      <div class="__crl-li-table-wrap">
        <table class="__crl-li-table">
            <thead><tr><th>Company</th><th>GD ★</th></tr></thead>
            <tbody>${rows || '<tr><td colspan="2" style="opacity:.5;text-align:center">No Glassdoor ratings found</td></tr>'}</tbody>
        </table>
      </div>`;

    const scanBtn = document.getElementById('__crl-indeed-scan-btn');
    if (scanBtn) {
        scanBtn.innerHTML = `
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>
        Re-scan`;
        scanBtn.disabled = false;
    }
  }

  // ── Extract company names from Indeed job cards ────────────────────────────
  function extractCompanyNames() {
    const elements = document.querySelectorAll(COMPANY_SELECTOR);
    const companies = [];

    for (const el of elements) {
      const text = el.textContent.trim();
      if (!text || text.length > 100) continue;
      if (/^\d/.test(text)) continue;

      // Get city from the sibling location element (inside the same card)
      const card = el.closest('[class*="resultContent"], td.resultContent, .job_seen_beacon');
      const locationEl = card?.querySelector(LOCATION_SELECTOR);
      const city = locationEl?.textContent?.trim().split(',')[0] || '';

      companies.push({ name: text, element: el, city });
    }
    return companies;
  }

  // ── Inject loading badge beneath company name ──────────────────────────────
  function injectLoadingBadge(el) {
    if (el.getAttribute(BADGE_ATTR)) return;
    el.setAttribute(BADGE_ATTR, 'loading');
    const badge = document.createElement('span');
    badge.className = '__crl-li-badge __crl-li-badge--loading';
    badge.textContent = '⏳';
    el.insertAdjacentElement('afterend', badge);
    return badge;
  }

  // ── Update badge with results ──────────────────────────────────────────────
  function updateBadge(el, results) {
    // Remove old badge sibling if present
    const existing = el.nextElementSibling;
    if (existing?.classList.contains('__crl-li-badge')) existing.remove();
    el.removeAttribute(BADGE_ATTR);

    const gd = results?.glassdoor;
    const gm = results?.googleMaps;
    const gdRating = gd?.rating ? parseFloat(gd.rating).toFixed(1) : '–';
    const gmRating = gm?.rating ? parseFloat(gm.rating).toFixed(1) : '–';
    const rn = gd?.rating ? parseFloat(gd.rating) : null;

    const colorClass = !rn
      ? '__crl-li-badge--missing'
      : rn >= 4.0 ? '__crl-li-badge--good'
      : rn >= 3.0 ? '__crl-li-badge--ok'
      : '__crl-li-badge--bad';

    const badge = document.createElement('span');
    badge.className = `__crl-li-badge ${colorClass}`;
    badge.setAttribute(BADGE_ATTR, 'true');
    badge.innerHTML = `<span>★ ${gdRating}</span><span class="__crl-li-sep">·</span><span class="__crl-li-badge-gm" title="Google Maps rating — may not match exact business location for short or common company names">📍 ${gmRating} ⚠</span>`;
    badge.title = `Glassdoor (employee reviews): ${gdRating}\nGoogle Maps: ${gmRating} — ⚠ location match may not be exact for companies with common or short names\nClick for full details`;

    badge.style.cursor = 'pointer';
    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      // Notice we use document.dispatchEvent here to match the bridge listener
      const companyName = el.textContent.trim();
      document.dispatchEvent(
        new CustomEvent('__crl:show-card', {
          detail: { companyName, results, x: e.pageX, y: e.pageY },
        })
      );
    });

    el.setAttribute(BADGE_ATTR, 'true');
    el.insertAdjacentElement('afterend', badge);
  }

  // ── Main scan loop ─────────────────────────────────────────────────────────
  async function startBatchScan() {
    if (!window.__crlRatingCache) window.__crlRatingCache = new Map();
    window.__crlRatingCache.clear();

    const companies = extractCompanyNames();
    if (!companies.length) {
      document.getElementById('__crl-indeed-panel-body').innerHTML =
        '<p class="__crl-li-hint">No company names found on this page.</p>';
      return;
    }

    // Build byName map (same pattern as linkedin-scanner.js)
    const byName = new Map();
    for (const { name, element, city } of companies) {
      if (!byName.has(name)) byName.set(name, { elements: [], results: null, city: city || '' });
      byName.get(name).elements.push(element);
    }
    const uniqueNames = [...byName.keys()];

    // Inject loading badges on all elements
    for (const { element } of companies) injectLoadingBadge(element);

    // Update panel to scanning state
    const scanBtn = document.getElementById('__crl-indeed-scan-btn');
    const body = document.getElementById('__crl-indeed-panel-body');
    scanBtn.innerHTML = `<span class="__crl-li-spin"></span> Scanning…`;
    scanBtn.disabled = true;
    body.innerHTML = `<p class="__crl-li-hint">Fetching ratings for <strong>${uniqueNames.length}</strong> companies…</p>
      <div class="__crl-li-progress-wrap"><div class="__crl-li-progress-bar" id="__crl-indeed-progress" style="width:0%"></div></div>
      <p class="__crl-li-progress-text" id="__crl-indeed-progress-text">0 / ${uniqueNames.length}</p>`;

    let done = 0;
    const summary = [];
    const BATCH_SIZE = 3;

    for (let i = 0; i < uniqueNames.length; i += BATCH_SIZE) {
      const batch = uniqueNames.slice(i, i + BATCH_SIZE);

      await Promise.all(batch.map(async (name) => {
        const entry = byName.get(name);
        try {
          let fetchedResults;
          if (window.__crlRatingCache.has(name)) {
            fetchedResults = window.__crlRatingCache.get(name);
          } else {
            const resp = await chrome.runtime.sendMessage({
              action: 'LINKEDIN_LOOKUP', // reuses the same background handler
              companyName: name,
              city: entry.city,
            });
            fetchedResults = resp?.results ?? null;
            window.__crlRatingCache.set(name, fetchedResults);
          }
          entry.results = fetchedResults;
        } catch (err) {
          entry.results = null;
        }

        // Apply badge to all elements for this company
        for (const el of entry.elements) updateBadge(el, entry.results);

        done++;
        const pct = Math.round((done / uniqueNames.length) * 100);
        const bar = document.getElementById('__crl-indeed-progress');
        const txt = document.getElementById('__crl-indeed-progress-text');
        if (bar) bar.style.width = pct + '%';
        if (txt) txt.textContent = `${done} / ${uniqueNames.length}`;

        if (entry.results?.glassdoor?.rating) {
          summary.push({ name, rating: parseFloat(entry.results.glassdoor.rating) });
        }
      }));
    }

    renderSummaryTable(summary);
  }

  // ── Bridge: badge click → content.js card renderer ────────
  document.addEventListener('__crl:show-card', (e) => {
    chrome.runtime.sendMessage({
      action: 'SHOW_CARD_FOR_COMPANY',
      companyName: e.detail.companyName,
      results: e.detail.results,
      x: e.detail.x,
      y: e.detail.y,
    }).catch(() => {});
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    if (!document.getElementById(PANEL_ID)) getOrCreatePanel();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  // Listen for popup's "show panel" message
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'CRL_SHOW_INDEED_PANEL') {
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        panel.classList.remove('__crl-li-panel--collapsed');
        const minBar = document.getElementById('__crl-indeed-min-bar');
        const maxSquare = document.getElementById('__crl-indeed-max-square');
        if (minBar) minBar.style.display = '';
        if (maxSquare) maxSquare.style.display = 'none';
      } else {
        getOrCreatePanel();
      }
    }
  });
})();
