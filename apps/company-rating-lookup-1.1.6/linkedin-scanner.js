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

  // COMPANY_SELECTORS removed in favor of purely structural inference.
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

  // ── Debug Logging Helpers ────────────────────────────────────
  function logDebug(msg) {
    console.log('[CRL-DEBUG]', msg);
  }

  function clearDebugLog() {
  }

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
    const companies = [];
    const seen = new Set();
    const processedKeys = new Set();

    // Helper to identify detail pane elements with class-based suffix matching (handles obfuscated classes)
    function isInDetailPane(el) {
      return !!el.closest([
        '[class*="job-details"]',
        '[class*="job-view"]',
        '[class*="job-unified-top-card"]',
        '[class*="jobs-search__job-details"]',
        '[class*="jobs-search-results-list__detail-pane"]',
        '.scaffold-layout__detail',
        '[class*="scaffold-layout__detail"]'
      ].join(','));
    }

    function isLocationText(txt) {
      const t = txt.toLowerCase().trim();
      
      // If it contains common job title indicator words, it is NOT a location
      const titleIndicators = ['manager', 'engineer', 'developer', 'designer', 'associate', 'analyst', 'specialist', 'lead', 'head', 'director', 'coordinator', 'administrator', 'officer', 'consultant', 'architect', 'vp', 'president', 'intern', 'officer', 'program', 'product', 'project', 'business', 'it ', 'office', 'operations', 'science', 'scientist'];
      if (titleIndicators.some(word => t.includes(word))) return false;

      if (t.match(/,\s*(AL|AK|AZ|AR|CA|CO|CT|DE|FL|GA|HI|ID|IL|IN|IA|KS|KY|LA|ME|MD|MA|MI|MN|MS|MO|MT|NE|NV|NH|NJ|NM|NY|NC|ND|OH|OK|OR|PA|RI|SC|SD|TN|TX|UT|VT|VA|WA|WV|WI|WY|Remote|Hybrid|On-site|United States|Canada|UK|London|Paris|Berlin|Germany|Europe)/i)) return true;
      if (t.includes('·') && (t.includes('remote') || t.includes('hybrid') || t.includes('on-site'))) return true;
      if (t.includes('remote') || t.includes('hybrid') || t.includes('on-site')) return true;
      if (t.includes('metropolitan area')) return true;
      if (t === 'united states' || t === 'canada' || t === 'united kingdom') return true;
      if (t.includes(',') && t.length < 50 && !t.includes('click') && !t.includes('apply')) return true;
      return false;
    }

    function isNoiseLine(txt) {
      const t = txt.toLowerCase().trim();
      if (!t || t.length > 120 || t.length < 2) return true;
      
      // Filter out connection degree / social metadata
      if (t.match(/\b\d(st|nd|rd|th)\b/i) || t.includes('3rd') || t.includes('2nd') || t.includes('1st')) return true;
      if (t.includes('•') || t.includes('·') || t === 'repost' || t === 'like' || t === 'comment' || t === 'send' || t === 'reply') return true;
      
      // Filter out common header & navigation text
      if (t.includes('jobs that match your profile') || t.includes('based on the job criteria') || t.includes('how promoted jobs are ranked')) return true;
      if (t.match(/^\d+.*results$/) || t.match(/^\d+.*jobs$/)) return true;
      if (t.includes('results where') || t.includes('jobs where')) return true;
      
      // Filter out telemetry/status tags
      if (t.includes('you’d be a top applicant') || t.includes('you\'d be a top applicant')) return true;
      if (
        t === 'viewed' || 
        t === 'promoted' || 
        t === 'easy apply' || 
        t === 'actively reviewing applicants' || 
        t === 'be an early applicant' ||
        t === 'selected' ||
        t === 'selected,' ||
        t === 'verified job' ||
        t === 'verified'
      ) return true;
      if (t.includes('actively reviewing') || t.includes('be an early')) return true;
      if (t.includes('how you match') || t.includes('connections work here') || t.includes('school alumni work here')) return true;
      
      // CSS class-like strings or random obfuscated codes
      if (t.includes('{') || t.includes('}') || t.includes(';') || t.includes('color:') || t.includes('display:')) return true;
      
      // Footer and pagination links noise
      const footerNoise = ['previous', 'next', 'about', 'accessibility', 'help center', 'privacy & terms', 'ad choices', 'advertising', 'business services', 'get the linkedin app', 'premium', 'trial', 'members use', 'retry premium', 'easy to cancel'];
      if (footerNoise.includes(t) || footerNoise.some(f => t === f || t.includes(f))) return true;

      // Other corporate noise
      if (NOISE_PATTERNS.some(p => p.test(txt))) return true;
      return false;
    }

    function isPostedWhenText(txt) {
      const t = txt.toLowerCase().trim();
      if (t.match(/ago$/i) || t.match(/\b(hour|day|week|month|year)s?\b/i)) return true;
      if (t.startsWith('posted') || t.includes('week') || t.includes('month') || t.includes('day')) return true;
      return false;
    }

    function isBenefitsText(txt) {
      const t = txt.toLowerCase().trim();
      if (t.includes('benefit') || t.includes('401(k)') || t.includes('medical') || t.includes('vision') || t.includes('dental')) return true;
      if (t.match(/\$\d+/)) return true; // salary range
      return false;
    }

    function cleanTitle(title) {
      return title.replace(/^(Selected|Verified),\s*/i, '')
                  .replace(/\(?Verified job\)?/gi, '')
                  .trim();
    }

    function normalizeText(txt) {
      return txt.toLowerCase().replace(/[^a-z0-9]/g, '').trim();
    }

    function isSameAsTitle(candidate, title) {
      const c = normalizeText(candidate);
      const t = normalizeText(title);
      return c === t || (c.length > 5 && t === c) || (t.length > 5 && c === t);
    }

    function isTitleCandidate(txt) {
      const t = txt.trim();
      if (!t || t.length < 3 || t.length > 100) return false;
      if (isLocationText(txt)) return false;
      if (isPostedWhenText(txt)) return false;
      if (isBenefitsText(txt)) return false;
      if (isNoiseLine(txt)) return false;
      if (t.match(/^(https?:\/\/|\d+$)/i)) return false;
      return true;
    }

    function isValidCompanyCandidate(candidate, title) {
      if (!candidate) return false;
      const t = candidate.toLowerCase().trim();
      if (!t || t.length < 2 || t.length > 100) return false;
      if (isLocationText(candidate)) return false;
      if (isPostedWhenText(candidate)) return false;
      if (isBenefitsText(candidate)) return false;
      if (isNoiseLine(candidate)) return false;
      if (
        t === 'verified job' || 
        t === 'selected' || 
        t === 'viewed' || 
        t === 'promoted' || 
        t.includes('easy apply') ||
        t.includes('be an early') || 
        t.includes('actively reviewing') ||
        t.includes('alumni') || 
        t.includes('connections work') ||
        t.includes('connection work')
      ) {
        return false;
      }
      if (isSameAsTitle(candidate, title)) return false;
      return true;
    }

    function findMainResultsContainer() {
      // Prioritize SearchResultsMainContent (case-insensitive variants) but fallback gracefully
      return document.querySelector([
        '[componentkey="SearchResultsMainContent"]',
        '[componentKey="SearchResultsMainContent"]',
        '[data-component-key*="SearchResultsMainContent"]',
        '[class*="SearchResultsMainContent"]',
        '[data-testid="lazy-column"][componentkey*="SearchResultsMainContent"]',
        '[data-testid="lazy-column"][componentKey*="SearchResultsMainContent"]',
        '[data-view-name*="jobs-search-results"]',
        '.scaffold-layout__list-container',
        '[class*="scaffold-layout__list"]'
      ].join(','));
    }

    function getStreamOfNodes(container) {
      const stream = [];
      
      function traverse(node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          const tagName = node.tagName.toLowerCase();
          if (tagName === 'script' || tagName === 'style' || tagName === 'svg' || tagName === 'img') {
            return;
          }
          if (isInDetailPane(node)) {
            return;
          }
          
          // Match hr dividers
          if (tagName === 'hr' && (node.getAttribute('role') === 'presentation' || node.className.includes('divider') || node.className.includes('separator'))) {
            stream.push({ type: 'HR', element: node });
            return;
          }
        }
        
        if (node.nodeType === Node.TEXT_NODE) {
          const txt = node.textContent.trim();
          if (txt) {
            stream.push({ type: 'TEXT', text: txt, element: node.parentElement });
          }
          return;
        }
        
        for (let child = node.firstChild; child; child = child.nextSibling) {
          traverse(child);
        }
      }
      
      traverse(container);
      return stream;
    }

    function cleanTokenStream(rawStream) {
      const cleaned = [];
      for (let i = 0; i < rawStream.length; i++) {
        const current = rawStream[i];
        if (current.type === 'HR') {
          cleaned.push(current);
          continue;
        }
        
        // If there's a previous text token, check if it's a duplicate or substring
        if (cleaned.length > 0 && cleaned[cleaned.length - 1].type === 'TEXT') {
          const prev = cleaned[cleaned.length - 1];
          const t1 = prev.text.toLowerCase().trim();
          const t2 = current.text.toLowerCase().trim();
          
          // If they are identical or one contains the other (e.g. verified job/selected prefixes)
          if (t1 === t2 || (t1.length > 3 && t2.includes(t1)) || (t2.length > 3 && t1.includes(t2))) {
            // Keep the one that doesn't have "selected" or "verified" prefixes, or just keep the cleaner one
            if (t2.includes('selected') || t2.includes('verified')) {
              continue;
            } else if (t1.includes('selected') || t1.includes('verified')) {
              cleaned[cleaned.length - 1] = current;
              continue;
            }
          }
        }
        cleaned.push(current);
      }
      return cleaned;
    }

    function splitStreamIntoSegments(stream) {
      const segments = [];
      let currentSegment = [];
      for (const token of stream) {
        if (token.type === 'HR') {
          if (currentSegment.length > 0) {
            segments.push(currentSegment);
            currentSegment = [];
          }
          continue;
        }
        
        if (currentSegment.length > 0) {
          let segTitle = '';
          let hasCompany = false;
          let hasLocation = false;
          
          for (const t of currentSegment) {
            if (!segTitle) {
              if (isTitleCandidate(t.text)) {
                segTitle = cleanTitle(t.text);
              }
            } else {
              if (isLocationText(t.text)) {
                hasLocation = true;
              } else if (isValidCompanyCandidate(t.text, segTitle)) {
                hasCompany = true;
              }
            }
          }
          
          const isNewTitle = isTitleCandidate(token.text);
          if (isNewTitle && segTitle && (hasCompany || hasLocation)) {
            segments.push(currentSegment);
            currentSegment = [];
          }
        }
        currentSegment.push(token);
      }
      if (currentSegment.length > 0) {
        segments.push(currentSegment);
      }
      return segments;
    }

    function parseSegment(tokens, idx) {
      const rawCount = tokens.length;
      const rawTexts = tokens.map(t => t.text);
      
      // Filter out noise tokens from this segment
      const nonNoiseTokens = tokens.filter(t => !isNoiseLine(t.text));
      
      // Clean/deduplicate consecutive tokens in this segment
      const cleaned = cleanTokenStream(nonNoiseTokens);
      const cleanedCount = cleaned.length;
      
      if (cleaned.length === 0) {
        logDebug(`[Segment #${idx + 1}] SKIPPED: Empty text stream (Raw tokens: ${rawCount}, First few raw: ${JSON.stringify(rawTexts.slice(0, 5))})`);
        return null;
      }
      
      // 1. Identify the first strong title-like candidate using isTitleCandidate()
      let titleIndex = -1;
      for (let i = 0; i < cleaned.length; i++) {
        if (isTitleCandidate(cleaned[i].text)) {
          titleIndex = i;
          break;
        }
      }
      
      if (titleIndex === -1) {
        logDebug(`[Segment #${idx + 1}] SKIPPED: No title candidate found (Raw tokens: ${rawCount}, Cleaned: ${cleanedCount})`);
        logDebug(`  - First 10 raw tokens: ${JSON.stringify(rawTexts.slice(0, 10))}`);
        return null;
      }
      
      const rawTitle = cleaned[titleIndex].text;
      const job_title = cleanTitle(rawTitle);
      
      if (!job_title) {
        logDebug(`[Segment #${idx + 1}] SKIPPED: Job title cleaned to empty string (Raw title: "${rawTitle}")`);
        logDebug(`  - First 10 raw tokens: ${JSON.stringify(rawTexts.slice(0, 10))}`);
        return null;
      }
      
      // 2. Identify the company using isValidCompanyCandidate(candidate, title)
      let company = '';
      let companyEl = null;
      let companyIndex = -1;
      
      // Scan forward from titleIndex for the company candidate
      for (let i = titleIndex + 1; i < cleaned.length; i++) {
        if (isValidCompanyCandidate(cleaned[i].text, job_title)) {
          company = cleaned[i].text;
          companyEl = cleaned[i].element;
          companyIndex = i;
          break;
        }
      }
      
      // 3. Identify the location using isLocationText()
      let location = '';
      let locationIndex = -1;
      
      // Scan forward from titleIndex for the location
      for (let i = titleIndex + 1; i < cleaned.length; i++) {
        if (isLocationText(cleaned[i].text)) {
          location = cleaned[i].text;
          locationIndex = i;
          break;
        }
      }
      
      // 4. Map remaining lines using isPostedWhenText() and isBenefitsText()
      let posted_when = '';
      let benefits = '';
      
      cleaned.forEach((t, i) => {
        if (i === titleIndex || i === companyIndex || i === locationIndex) return;
        if (isPostedWhenText(t.text)) {
          posted_when = t.text;
        } else if (isBenefitsText(t.text)) {
          benefits = t.text;
        }
      });
      
      const titleCandidates = cleaned.filter(t => isTitleCandidate(t.text));
      const wasHeldOpen = titleCandidates.length > 1;

      logDebug(`[Segment #${idx + 1}] Parsed segment details:`);
      logDebug(`  - Raw token count: ${rawCount}`);
      logDebug(`  - Cleaned token count: ${cleanedCount}`);
      logDebug(`  - Segmentation action: ${wasHeldOpen ? 'held open (contains multiple title candidates)' : 'split'}`);
      logDebug(`  - Title candidate: "${job_title}"`);
      logDebug(`  - Company candidate: "${company || '(blank)'}"`);
      logDebug(`  - Location candidate: "${location || '(blank)'}"`);
      logDebug(`  - Posted: "${posted_when || '(blank)'}" / Benefits: "${benefits || '(blank)'}"`);
      
      return {
        job_title,
        company,
        companyEl,
        location,
        posted_when,
        benefits,
        source: 'Text Stream Segment Heuristics'
      };
    }

    logDebug('═══════════════════════════════════════');
    logDebug('extractCompanyNames() starting text-driven extraction...');

    const mainContainer = findMainResultsContainer();
    if (!mainContainer) {
      logDebug('WARNING: Main job results container not found!');
      logDebug('═══════════════════════════════════════');
      return companies;
    }

    logDebug(`Found main results container: <${mainContainer.tagName} class="${mainContainer.className.substring(0, 80)}">`);

    const rawStream = getStreamOfNodes(mainContainer);
    logDebug(`Collected raw token stream size: ${rawStream.length}`);

    const nonNoiseStream = rawStream.filter(t => t.type === 'HR' || !isNoiseLine(t.text));
    const cleanedStream = cleanTokenStream(nonNoiseStream);
    logDebug(`Cleaned token stream size: ${cleanedStream.length}`);

    const segments = splitStreamIntoSegments(cleanedStream);
    logDebug(`Split stream into ${segments.length} text segments.`);

    let parsedCount = 0;
    let duplicateCount = 0;
    let skippedCount = 0;

    segments.forEach((segmentTokens, idx) => {
      const res = parseSegment(segmentTokens, idx);
      if (!res) {
        skippedCount++;
        return;
      }

      const { job_title, company, companyEl, location, posted_when, benefits, source } = res;

      if (!company) {
        logDebug(`[Segment #${idx + 1}] Skipped: Failed to extract company name for Job="${job_title}" (company was truly absent)`);
        skippedCount++;
        return;
      }

      // Normalize key for deduplication
      const normKey = `${job_title.toLowerCase()}|${company.toLowerCase()}|${location.toLowerCase()}`;
      if (processedKeys.has(normKey)) {
        logDebug(`[Segment #${idx + 1}] Duplicate skipped: "${job_title}" at "${company}" (dedupe reason: key already exists)`);
        duplicateCount++;
        return;
      }
      processedKeys.add(normKey);

      logDebug(`[Segment #${idx + 1}] Successfully parsed:`);
      logDebug(`  - Title:    "${job_title}"`);
      logDebug(`  - Company:  "${company}"`);
      logDebug(`  - Location: "${location || '(blank)'}"`);
      logDebug(`  - Posted:   "${posted_when || '(blank)'}"`);
      logDebug(`  - Benefits: "${benefits || '(blank)'}"`);

      parsedCount++;
      
      const targetAnchor = companyEl || mainContainer;
      companies.push({ name: company, element: targetAnchor, city: location });
    });

    logDebug(`FINAL UNIQUE COMPANIES FOUND: ${companies.map(c => c.name).join(', ')}`);
    logDebug('═══════════════════════════════════════');
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
    
    let tooltip = `Glassdoor (employee reviews): ${gdRating}\nGoogle Maps: ${gmRating} — ⚠ location match may not be exact for companies with common or short names`;
    if (gd?.isAmbiguous) {
      tooltip += `\nGlassdoor match may be ambiguous.`;
    }
    tooltip += `\nClick for full details`;
    badge.title = tooltip;

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
    clearDebugLog();
    logDebug('Batch scan initiated by user.');

    // Initialize or reuse the page-scoped rating cache across scans
    if (!window.__crlRatingCache) window.__crlRatingCache = new Map();
    // Clear cache on each manual scan so Re-scan always fetches fresh results
    window.__crlRatingCache.clear();

    const companies = extractCompanyNames();

    if (!companies.length) {
      logDebug('No companies extracted. Aborting scan.');
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
    logDebug(`Found ${uniqueNames.length} unique companies to look up.`);

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
      logDebug(`Requesting batch lookup for: ${JSON.stringify(batch)}`);

      await Promise.all(
        batch.map(async (name) => {
          const group = companyMap.get(name);
          try {
            let fetchedResults;
            if (window.__crlRatingCache.has(name)) {
              // Reuse cached result — guarantees same rating on all elements for this company
              fetchedResults = window.__crlRatingCache.get(name);
              logDebug(`  - Cache hit for "${name}"`);
            } else {
              logDebug(`  - Querying background for: "${name}" (city context: "${group.city}")`);
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
            const ratingStr = fetchedResults?.glassdoor?.rating ? `GD ★ ${fetchedResults.glassdoor.rating.toFixed(1)}` : 'GD ★ N/A';
            const gmRatingStr = fetchedResults?.googleMaps?.rating ? `GM ★ ${fetchedResults.googleMaps.rating.toFixed(1)}` : 'GM ★ N/A';
            logDebug(`  -> Result for "${name}": ${ratingStr} (url: ${fetchedResults?.glassdoor?.url || 'N/A'}), ${gmRatingStr}`);
            if (fetchedResults?.glassdoor?.isAmbiguous) {
              logDebug(`  -> WARNING: Glassdoor match may be ambiguous.`);
            }
            summary.push({ name, rating: fetchedResults?.glassdoor?.rating ?? null });
          } catch (err) {
            logDebug(`  -> Lookup failed for "${name}": ${err.message}`);
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

    logDebug('All batch lookup queries completed.');
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
