// ============================================================
// LinkedIn Page Scanner — Company Rating Lookup Extension v1.1
// Detects LinkedIn job search pages, extracts all company names
// using the stable CSS class "bec82545", cleans noise, then
// batch-requests ratings via background.js fetchRatings().
// Injects inline colored badges and a floating summary panel.
// ============================================================

(function () {
  if (window.__crlLinkedInInitialized) return;
  window.__crlLinkedInInitialized = true;

  const COMPANY_CLASS = 'bec82545';
  const COMPANY_SELECTORS = [
    '.job-card-container__primary-description',
    '.job-card-container__company-name',
    '.job-details-jobs-unified-top-card__company-name',
    '.artdeco-entity-lockup__subtitle',
    `p[class*="${COMPANY_CLASS}"]`
  ];
  const BADGE_ATTR = 'data-crl-badge';
  const PANEL_ID = '__crl-linkedin-panel';
  const SCAN_BUTTON_ID = '__crl-linkedin-scan-btn';

  // Noise strings present in the LinkedIn DOM that match the company class selector
  const NOISE_PATTERNS = [
    /linkedin corporation/i,
    /your feedback/i,
    /see jobs where/i,
    /your profile/i,
    /show match/i,
    /position overview/i,
    /applicants must/i,
    /job search faster/i,
    /access company insights/i,
    /manager, special projects/i, // job titles that bleed into wrong elements
  ];

  // ── Detect LinkedIn Jobs Page ───────────────────────────────
  function isLinkedInJobsPage() {
    return (
      window.location.hostname.includes('linkedin.com') &&
      (window.location.pathname.includes('/jobs') ||
        document.querySelector('[data-testid="lazy-column"]') !== null)
    );
  }

  // ── Extract Company Names from DOM ───────────
  function extractCompanyNames() {
    const elements = new Set();
    for (const selector of COMPANY_SELECTORS) {
      document.querySelectorAll(selector).forEach(el => elements.add(el));
    }
    const companies = [];

    for (const el of elements) {
      // Exclude elements inside the right-side expanded job detail panel.
      // LinkedIn renders this in a separate scrollable pane — we only want the left list.
      const detailPane = el.closest([
        '[class*="jobs-search__job-details"]',
        '[class*="job-view-layout"]',
        '[class*="jobs-unified-top-card"]',
        '[data-view-name="job-details"]',
        '.job-details-jobs-unified-top-card__container--two-pane',
      ].join(','));
      if (detailPane) continue;

      const text = el.textContent.trim().replace(/\n/g, ' ').replace(/\s{2,}/g, ' ');
      if (!text || text.length > 80) continue;
      if (NOISE_PATTERNS.some((p) => p.test(text))) continue;
      if (/^\d/.test(text)) continue; // starts with digit — not a company name
      // Try to get city from the next sibling <p> (LinkedIn renders "New York, NY" right after company name)
      const locationEl = el.parentElement?.querySelector('p:last-of-type');
      const city = locationEl?.textContent?.trim().split(',')[0] || '';
      companies.push({ name: text, element: el, city });
    }

    return companies;
  }

  // ── Badge: inject loading placeholder ─────────────────────
  function injectLoadingBadge(el) {
    if (el.getAttribute(BADGE_ATTR)) return;
    el.setAttribute(BADGE_ATTR, 'loading');
    const badge = document.createElement('span');
    badge.className = '__crl-li-badge __crl-li-badge--loading';
    badge.textContent = '⏳';
    el.insertAdjacentElement('afterend', badge);
  }

  // ── Badge: update loading → final result ──────────────────
  function updateBadge(el, companyName, results) {
    // Remove old badge sibling if present
    const existing = el.nextElementSibling;
    if (existing?.classList.contains('__crl-li-badge')) existing.remove();
    el.removeAttribute(BADGE_ATTR);

    const gd = results?.glassdoor;
    const gm = results?.googleMaps;
    const gdRating = gd?.rating ? gd.rating.toFixed(1) : '–';
    const gmRating = gm?.rating ? gm.rating.toFixed(1) : '–';
    const rn = gd?.rating;

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

    badge.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      document.dispatchEvent(
        new CustomEvent('__crl:show-card', {
          detail: { companyName, results, x: e.pageX, y: e.pageY },
        })
      );
    });

    el.setAttribute(BADGE_ATTR, 'true');
    el.insertAdjacentElement('afterend', badge);
  }

  // ── Panel: create floating scan panel ─────────────────────
  function getOrCreatePanel() {
    if (document.getElementById(PANEL_ID)) return;

    const panel = document.createElement('div');
    panel.id = PANEL_ID;
    panel.className = '__crl-li-panel';
    panel.innerHTML = `
      <div class="__crl-li-panel-header" id="__crl-li-panel-header">
        <div class="__crl-li-panel-title">
          <span style="opacity:0.5; margin-right: 4px; cursor: grab;">⋮⋮</span>
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
          Ratings
        </div>
        <div class="__crl-li-header-actions">
          <button id="${SCAN_BUTTON_ID}" class="__crl-li-scan-btn-small"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg> Scan</button>
          <button id="__crl-li-panel-close" class="__crl-li-collapse-btn" title="Minimize">
            <svg id="__crl-collapse-icon" width="10" height="10" viewBox="0 0 10 10" fill="none" xmlns="http://www.w3.org/2000/svg">
              <!-- Minimize: horizontal bar -->
              <rect id="__crl-min-bar" x="1" y="4.5" width="8" height="1.5" rx="0.75" fill="currentColor"/>
              <!-- Restore: square outline (hidden by default) -->
              <rect id="__crl-max-square" x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.5" fill="none" style="display:none"/>
            </svg>
          </button>
          <button id="__crl-li-panel-remove" class="__crl-li-collapse-btn" title="Close">
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="2" y1="2" x2="8" y2="8"/><line x1="2" y1="8" x2="8" y2="2"/></svg>
          </button>
        </div>
      </div>
      <div class="__crl-li-panel-body" id="__crl-li-panel-body">
        <p class="__crl-li-hint">Click <strong>Scan</strong> to fetch Glassdoor &amp; Google Maps ratings for all companies on this LinkedIn page.</p>
      </div>
    `;
    document.body.appendChild(panel);

    const header = document.getElementById('__crl-li-panel-header');
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

    document.getElementById('__crl-li-panel-remove').addEventListener('click', () => {
      panel.remove();
    });

    document.getElementById('__crl-li-panel-close').addEventListener('click', () => {
      const collapsed = panel.classList.toggle('__crl-li-panel--collapsed');
      const minBar = document.getElementById('__crl-min-bar');
      const maxSquare = document.getElementById('__crl-max-square');
      const btn = document.getElementById('__crl-li-panel-close');
      if (collapsed) {
        // Show restore (square) icon
        if (minBar) minBar.style.display = 'none';
        if (maxSquare) maxSquare.style.display = '';
        if (btn) btn.title = 'Restore';
      } else {
        // Show minimize (bar) icon
        if (minBar) minBar.style.display = '';
        if (maxSquare) maxSquare.style.display = 'none';
        if (btn) btn.title = 'Minimize';
      }
    });

    document.getElementById(SCAN_BUTTON_ID)
      .addEventListener('click', startBatchScan);

    // Restore table if cache exists
    if (window.__crlRatingCache && window.__crlRatingCache.size > 0) {
      const summary = [];
      for (const [name, results] of window.__crlRatingCache.entries()) {
        summary.push({ name, rating: results?.glassdoor?.rating ?? null });
      }
      renderSummaryTable(summary);
    }
  }

  // ── Panel: render summary table ──────────────────────────────
  function renderSummaryTable(summary) {
    const sorted = summary.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
    const rows = sorted
      .map((r) => {
        const stars = r.rating ? `★ ${r.rating.toFixed(1)}` : '–';
        const cls = r.rating >= 4.0 ? 'good' : r.rating >= 3.0 ? 'ok' : 'bad';
        return `<tr>
          <td class="__crl-li-tbl-name" title="${r.name}">${r.name}</td>
          <td class="__crl-li-tbl-rating __crl-li-tbl-${cls}">${stars}</td>
        </tr>`;
      })
      .join('');

    updatePanel(`
      <p class="__crl-li-hint"><strong>${summary.length}</strong> companies scanned — sorted by Glassdoor ★</p>
      <div class="__crl-li-table-wrap">
        <table class="__crl-li-table">
          <thead><tr><th>Company</th><th>GD ★</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    `);

    const btn = document.getElementById(SCAN_BUTTON_ID);
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Re-scan`;
    }
  }

  // ── Panel: update body content ─────────────────────────────
  function updatePanel(html) {
    const body = document.getElementById('__crl-li-panel-body');
    if (body) body.innerHTML = html;
  }

  // ── Main: Batch Scan Orchestrator ──────────────────────────
  async function startBatchScan() {
    // Initialize or reuse the page-scoped rating cache across scans
    if (!window.__crlRatingCache) window.__crlRatingCache = new Map();
    // Clear cache on each manual scan so Re-scan always fetches fresh results
    window.__crlRatingCache.clear();

    const companies = extractCompanyNames();

    if (!companies.length) {
      updatePanel('<p class="__crl-li-hint">No company names found. Scroll to load more job cards first.</p>');
      return;
    }

    // Group elements by company name
    const companyMap = new Map();
    for (const { name, element, city } of companies) {
      if (!companyMap.has(name)) {
        companyMap.set(name, { elements: [], results: null, city: city || '' });
      }
      companyMap.get(name).elements.push(element);
    }
    
    const uniqueNames = Array.from(companyMap.keys());

    const btn = document.getElementById(SCAN_BUTTON_ID);
    if (btn) {
      btn.disabled = true;
      btn.innerHTML = `<span class="__crl-li-spin"></span> Scanning…`;
    }

    updatePanel(`
      <p class="__crl-li-hint">Fetching ratings for <strong>${uniqueNames.length}</strong> companies…</p>
      <div class="__crl-li-progress-wrap">
        <div class="__crl-li-progress-bar" id="__crl-li-pb" style="width:0%"></div>
      </div>
      <p class="__crl-li-progress-label" id="__crl-li-pl">0 / ${uniqueNames.length}</p>
    `);

    // Inject loading placeholders on all matched elements immediately
    for (const { element } of companies) {
      injectLoadingBadge(element);
    }

    let done = 0;
    const summary = [];
    const BATCH_SIZE = 3; // Parallel requests per tick — tune lower if you hit rate limits

    for (let i = 0; i < uniqueNames.length; i += BATCH_SIZE) {
      const batch = uniqueNames.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (name) => {
          const group = companyMap.get(name);
          try {
            let fetchedResults;
            if (window.__crlRatingCache.has(name)) {
              // Reuse cached result — guarantees same rating on all elements for this company
              fetchedResults = window.__crlRatingCache.get(name);
            } else {
              const resp = await chrome.runtime.sendMessage({
                action: 'LINKEDIN_LOOKUP',
                companyName: name,
                city: group.city,
              });
              fetchedResults = resp?.results ?? null;
              window.__crlRatingCache.set(name, fetchedResults);
            }
            group.results = fetchedResults;
            for (const el of group.elements) {
              updateBadge(el, name, fetchedResults);
            }
            summary.push({ name, rating: fetchedResults?.glassdoor?.rating ?? null });
          } catch (err) {
            console.warn('[CRL-LI] Lookup failed for:', name, err.message);
            for (const el of group.elements) {
              updateBadge(el, name, null);
            }
            summary.push({ name, rating: null });
          }

          done++;
          const pct = Math.round((done / uniqueNames.length) * 100);
          const pb = document.getElementById('__crl-li-pb');
          const pl = document.getElementById('__crl-li-pl');
          if (pb) pb.style.width = pct + '%';
          if (pl) pl.textContent = `${done} / ${uniqueNames.length}`;
        })
      );
    }

    // Render sorted summary table
    renderSummaryTable(summary);
  }

  // ── Bridge: badge click → content.js card renderer ────────
  // linkedin-scanner.js cannot call content.js functions directly (separate script contexts).
  // We relay via background.js SHOW_CARD_FOR_COMPANY → content.js LOOKUP_SUCCESS with injectX/Y.
  document.addEventListener('__crl:show-card', (e) => {
    chrome.runtime.sendMessage({
      action: 'SHOW_CARD_FOR_COMPANY',
      companyName: e.detail.companyName,
      results: e.detail.results,
      x: e.detail.x,
      y: e.detail.y,
    }).catch(() => {});
  });

  // ── Init: inject panel + watch SPA navigation ──────────────
  if (isLinkedInJobsPage()) {
    setTimeout(getOrCreatePanel, 1500);
  }

  // Re-inject on LinkedIn SPA navigation (pushState)
  let lastUrl = location.href;
  new MutationObserver(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      if (isLinkedInJobsPage()) {
        setTimeout(() => {
          if (!document.getElementById(PANEL_ID)) getOrCreatePanel();
        }, 1500);
      }
    }
  }).observe(document.body, { subtree: true, childList: true });

  // Listen for popup manual trigger
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === 'FORCE_OPEN_PANEL' || message.action === 'CRL_SHOW_LI_PANEL') {
      const panel = document.getElementById(PANEL_ID);
      if (panel) {
        panel.classList.remove('__crl-li-panel--collapsed');
        const minBar = document.getElementById('__crl-min-bar');
        const maxSquare = document.getElementById('__crl-max-square');
        const btn = document.getElementById('__crl-li-panel-close');
        if (minBar) minBar.style.display = '';
        if (maxSquare) maxSquare.style.display = 'none';
        if (btn) btn.title = 'Minimize';
      } else {
        // Panel doesn't exist yet — create it
        getOrCreatePanel();
      }
    }
  });
})();
