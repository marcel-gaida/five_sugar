if (window.__crlInitialized) {
  // Already running — skip re-initialization entirely
} else {
  window.__crlInitialized = true;
  // Global coordinates tracker for the context menu trigger point
  let lastMouseX = 0;
  let lastMouseY = 0;
  
  // Track right clicks to get precise cursor placement
  document.addEventListener('contextmenu', (e) => {
    lastMouseX = e.pageX;
    lastMouseY = e.pageY;
  });
  
  // Listen for messages from the service worker
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action === "PING") {
      sendResponse({ ready: true });
      return;
    }
    if (message.action === "LOOKUP_STARTED") {
      showLoadingCard(message.companyName);
    } else if (message.action === "LOOKUP_SUCCESS") {
      // If coordinates are provided (LinkedIn badge click), position card there
      if (message.injectX && message.injectY) {
        lastMouseX = message.injectX;
        lastMouseY = message.injectY;
      }
      renderRatingResults(message.companyName, message.results);
      // Only inject inline badge for context-menu lookups (not LinkedIn batch)
      if (!message.injectX) {
        injectInlineBadge(message.companyName, message.results);
      }
      const card = getOrCreateCard();
      positionCard(card, lastMouseX, lastMouseY);
      card.classList.add('__crl-active');
    } else if (message.action === "LOOKUP_ERROR") {
      renderErrorCard(message.companyName, message.error);
    }
  });
  
  // Gets or creates the card container element in the page DOM
  function getOrCreateCard() {
    let card = document.getElementById('__crl-rating-card');
    if (!card) {
      card = document.createElement('div');
      card.id = '__crl-rating-card';
      card.className = '__crl-card';
      document.body.appendChild(card);
  
      // Setup click-out dismissal logic
      document.addEventListener('click', (e) => {
        if (card.classList.contains('__crl-active') && !card.contains(e.target)) {
          dismissCard();
        }
      });
  
      // Setup keydown dismissal (Escape key)
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && card.classList.contains('__crl-active')) {
          dismissCard();
        }
      });
    }
    return card;
  }
  
  // Dismisses the floating rating card
  function dismissCard() {
    const card = document.getElementById('__crl-rating-card');
    if (card) {
      card.classList.remove('__crl-active');
    }
  }
  
  // Positions the card near the trigger coordinates, resolving screen boundary collisions
  function positionCard(card, x, y) {
    let top = y + 10;
    let left = x + 10;
    
    const cardWidth = 320;
    // Approximate maximum height of the card
    const cardHeight = 260;
    
    // Page limits
    const pageWidth = document.documentElement.scrollWidth;
    const pageHeight = document.documentElement.scrollHeight;
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;
    const scrollY = window.scrollY;
    const scrollX = window.scrollX;
  
    // Collision horizontal
    if (left + cardWidth > pageWidth) {
      left = Math.max(10, pageWidth - cardWidth - 20);
    }
  
    // Collision vertical
    if (top + cardHeight > pageHeight) {
      top = Math.max(10, y - cardHeight - 10);
    }
  
    // Double check viewport limits
    if (top + cardHeight - scrollY > viewportHeight) {
      top = Math.max(scrollY + 10, y - cardHeight - 10);
    }
  
    card.style.top = `${top}px`;
    card.style.left = `${left}px`;
  }
  
  // Displays the floating card in its loading (shimmer skeleton) state
  function showLoadingCard(companyName) {
    const card = getOrCreateCard();
    
    card.innerHTML = `
      <div class="__crl-header">
        <span class="__crl-title"></span>
        <span class="__crl-close-btn" id="__crl-close-trigger">&times;</span>
      </div>
      
      <!-- Glassdoor Loading -->
      <div class="__crl-rating-row">
        <span class="__crl-platform-name">Glassdoor</span>
        <div class="__crl-rating-data">
          <span class="__crl-skeleton __crl-sk-num"></span>
          <div>
            <div class="__crl-skeleton __crl-sk-stars"></div>
            <br>
            <div class="__crl-skeleton __crl-sk-reviews"></div>
          </div>
        </div>
      </div>
      
      <!-- Google Maps Loading -->
      <div class="__crl-rating-row">
        <span class="__crl-platform-name">Google Maps</span>
        <div class="__crl-rating-data">
          <span class="__crl-skeleton __crl-sk-num"></span>
          <div>
            <div class="__crl-skeleton __crl-sk-stars"></div>
            <br>
            <div class="__crl-skeleton __crl-sk-reviews"></div>
          </div>
        </div>
      </div>
    `;
  
    // Set the text content programmatically to ensure Web Store compliance
    card.querySelector('.__crl-title').textContent = companyName;
  
    // Bind the close button click
    document.getElementById('__crl-close-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissCard();
    });
  
    // Position and activate card
    positionCard(card, lastMouseX, lastMouseY);
    
    // Trigger transition delay
    setTimeout(() => {
      card.classList.add('__crl-active');
    }, 10);
  }
  
  // Renders the API rating results into the floating card programmatically
  function renderRatingResults(companyName, results) {
    const card = getOrCreateCard();
  
    const gd = results.glassdoor;
    const gm = results.googleMaps;
  
    // Setup main static layout
    card.innerHTML = `
      <div class="__crl-header">
        <span class="__crl-title"></span>
        <span class="__crl-close-btn" id="__crl-close-trigger">&times;</span>
      </div>
      
      <!-- Glassdoor Block -->
      <div class="__crl-rating-row" id="__crl-gd-row">
        <span class="__crl-platform-name">Glassdoor</span>
        <div class="__crl-rating-content"></div>
      </div>
      
      <!-- Google Maps Block -->
      <div class="__crl-rating-row" id="__crl-gm-row">
        <span class="__crl-platform-name">Google Maps</span>
        <div class="__crl-rating-content"></div>
      </div>
      
      <!-- Action buttons -->
      <div class="__crl-actions">
        <a href="#" target="_blank" class="__crl-link-btn" id="__crl-gd-link">
          <span>View Glassdoor Reviews</span>
          <span class="__crl-link-icon">↗</span>
        </a>
        <a href="#" target="_blank" class="__crl-link-btn" id="__crl-gm-link">
          <span>View Google Maps Reviews</span>
          <span class="__crl-link-icon">↗</span>
        </a>
      </div>
      <div class="__crl-support">
        <a href="https://buymeacoffee.com/gaidamarcel" target="_blank" rel="noopener noreferrer" class="__crl-support-a">support the developer</a>
      </div>
    `;
  
    // Populate title programmatically
    const titleEl = card.querySelector('.__crl-title');
    titleEl.textContent = companyName;
    titleEl.title = companyName;
  
    // 1. Populate Glassdoor Block
    const gdContent = card.querySelector('#__crl-gd-row .__crl-rating-content');
    if (gd.success) {
      if (gd.rating) {
        gdContent.innerHTML = `
          <div class="__crl-rating-data">
            <span class="__crl-rating-num"></span>
            <div>
              <div class="__crl-stars-outer">
                <div class="__crl-stars-inner"></div>
              </div>
              <span class="__crl-reviews-count"></span>
            </div>
          </div>
        `;
        gdContent.querySelector('.__crl-rating-num').textContent = gd.rating.toFixed(1);
        gdContent.querySelector('.__crl-stars-inner').style.width = `${(Math.min(5, Math.max(0, gd.rating)) / 5) * 100}%`;
        gdContent.querySelector('.__crl-reviews-count').textContent = gd.reviewsCount ? formatReviewCount(gd.reviewsCount) + ' reviews' : 'No reviews';
        
        const gdAmbiguous = gd.isAmbiguous || (gd.url && (gd.url.includes('/Search/') || gd.url.includes('/results.htm')));
        if (gdAmbiguous) {
          const warning = document.createElement('div');
          warning.className = '__crl-ambiguous-warning';
          warning.textContent = '⚠ Glassdoor match may be ambiguous.';
          gdContent.appendChild(warning);
        }
      } else {
        const errDiv = document.createElement('div');
        errDiv.className = '__crl-error-msg';
        errDiv.textContent = "Rating not parsed. View page for details.";
        gdContent.appendChild(errDiv);
      }
    } else {
      const errorLower = (gd.error || "").toLowerCase();
      if (errorLower.includes("key") || errorLower.includes("rapidapi")) {
        gdContent.innerHTML = `
          <div class="__crl-error-msg">
            <span class="__crl-setup-msg">API key required &mdash;
              <a class="__crl-open-link" href="#" id="__crl-open-settings-gd">Open Settings ↗</a>
            </span>
            <br>
            <a href="https://rapidapi.com/search/glassdoor" target="_blank" class="__crl-open-link-direct" style="color: var(--crl-accent) !important; text-decoration: underline !important; font-size: 11px !important; display: inline-block; margin-top: 4px;">Glassdoor ratings require a free RapidAPI key. Click here to get one &rarr;</a>
          </div>
        `;
      } else {
        const errDiv = document.createElement('div');
        errDiv.className = '__crl-error-msg';
        errDiv.textContent = gd.error || "Could not find matching reviews.";
        gdContent.appendChild(errDiv);
        if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
          const warning = document.createElement('div');
          warning.className = '__crl-ambiguous-warning';
          warning.textContent = '⚠ Glassdoor match may be ambiguous.';
          gdContent.appendChild(warning);
        }
      }
    }
  
    // 2. Populate Google Maps Block
    const gmContent = card.querySelector('#__crl-gm-row .__crl-rating-content');
    if (gm.success) {
      if (gm.rating) {
        gmContent.innerHTML = `
          <div class="__crl-rating-data">
            <span class="__crl-rating-num"></span>
            <div>
              <div class="__crl-stars-outer">
                <div class="__crl-stars-inner"></div>
              </div>
              <span class="__crl-reviews-count"></span>
            </div>
          </div>
          <span class="__crl-address"></span>
        `;
        gmContent.querySelector('.__crl-rating-num').textContent = gm.rating.toFixed(1);
        gmContent.querySelector('.__crl-stars-inner').style.width = `${(Math.min(5, Math.max(0, gm.rating)) / 5) * 100}%`;
        gmContent.querySelector('.__crl-reviews-count').textContent = gm.reviewsCount ? formatReviewCount(gm.reviewsCount) + ' reviews' : 'No reviews';
        
        const gmDisclaimer = document.createElement('p');
        gmDisclaimer.className = '__crl-gm-disclaimer';
        gmDisclaimer.innerHTML = `⚠ Location match may vary — <a href="${gm.url}" target="_blank" class="__crl-gm-verify-link">verify on Maps ↗</a>`;
        gmContent.appendChild(gmDisclaimer);
        
        const addrEl = gmContent.querySelector('.__crl-address');
        if (gm.address) {
          addrEl.textContent = gm.address;
          addrEl.title = gm.address;
        } else {
          addrEl.remove();
        }

        const gmAmbiguous = gm.isAmbiguous || (gm.url && gm.url.includes('/search/'));
        if (gmAmbiguous) {
          const warning = document.createElement('div');
          warning.className = '__crl-ambiguous-warning';
          warning.textContent = '⚠ Google Maps match may be ambiguous.';
          gmContent.appendChild(warning);
        }
      } else {
        const errDiv = document.createElement('div');
        errDiv.className = '__crl-error-msg';
        errDiv.textContent = "No rating data.";
        gmContent.appendChild(errDiv);
      }
    } else {
      const errorLower = (gm.error || "").toLowerCase();
      if (errorLower.includes("key")) {
        gmContent.innerHTML = `
          <div class="__crl-error-msg">
            <span class="__crl-setup-msg">API key required &mdash;
              <a class="__crl-open-link" href="#" id="__crl-open-settings-gm">Open Settings ↗</a>
            </span>
          </div>
        `;
      } else {
        const errDiv = document.createElement('div');
        errDiv.className = '__crl-error-msg';
        errDiv.textContent = gm.error || "No company found.";
        gmContent.appendChild(errDiv);
        if (errorLower.includes("timeout") || errorLower.includes("timed out")) {
          const warning = document.createElement('div');
          warning.className = '__crl-ambiguous-warning';
          warning.textContent = '⚠ Google Maps match may be ambiguous.';
          gmContent.appendChild(warning);
        }
      }
    }
  
    // 3. Set Action Buttons URLs
    const gdLink = card.querySelector('#__crl-gd-link');
    gdLink.href = gd.url || `https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(companyName)}`;
    
    const gmLink = card.querySelector('#__crl-gm-link');
    gmLink.href = gm.url || `https://www.google.com/maps/search/${encodeURIComponent(companyName)}`;
  
    // Register close click events
    document.getElementById('__crl-close-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissCard();
    });
  
    // Wire up the open settings link
    card.querySelectorAll('.__crl-open-link').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        chrome.runtime.sendMessage({ type: "CRL_OPEN_POPUP" });
      });
    });
  }
  
  // Renders an error card state programmatically
  function renderErrorCard(companyName, errorMessage) {
    const card = getOrCreateCard();
    
    card.innerHTML = `
      <div class="__crl-header">
        <span class="__crl-title"></span>
        <span class="__crl-close-btn" id="__crl-close-trigger">&times;</span>
      </div>
      <div class="__crl-rating-row">
        <span class="__crl-platform-name" style="color: #ef4444 !important;">Lookup Failed</span>
        <div class="__crl-error-msg" style="margin-top: 4px !important;"></div>
      </div>
      <div class="__crl-actions">
        <a href="#" target="_blank" class="__crl-link-btn" id="__crl-gd-err-link">
          <span>Search Glassdoor manually</span>
          <span class="__crl-link-icon">↗</span>
        </a>
        <a href="#" target="_blank" class="__crl-link-btn" id="__crl-gm-err-link">
          <span>Search Google Maps manually</span>
          <span class="__crl-link-icon">↗</span>
        </a>
      </div>
    `;
  
    card.querySelector('.__crl-title').textContent = companyName;
    card.querySelector('.__crl-error-msg').textContent = errorMessage;
    
    card.querySelector('#__crl-gd-err-link').href = `https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(companyName)}`;
    card.querySelector('#__crl-gm-err-link').href = `https://www.google.com/maps/search/${encodeURIComponent(companyName)}`;
  
    document.getElementById('__crl-close-trigger').addEventListener('click', (e) => {
      e.stopPropagation();
      dismissCard();
    });
  }
  
  // Injects an interactive rating badge directly adjacent to the user selection text
  function injectInlineBadge(companyName, results) {
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      // Create the badge element
      const badge = document.createElement('span');
      badge.className = '__crl-inline-badge';
      
      const gdRating = results.glassdoor.rating ? results.glassdoor.rating.toFixed(1) : 'N/A';
      const gmRating = results.googleMaps.rating ? results.googleMaps.rating.toFixed(1) : 'N/A';
      
      badge.textContent = `★ G: ${gdRating} · M: ${gmRating}`;
      
      let badgeTitle = `Glassdoor: ${gdRating}, Google Maps: ${gmRating}.`;
      if (results.glassdoor.isAmbiguous || (!results.glassdoor.success && results.glassdoor.error && results.glassdoor.error.toLowerCase().includes('timeout'))) {
        badgeTitle += `\nGlassdoor match may be ambiguous.`;
      }
      if (results.googleMaps.isAmbiguous || (!results.googleMaps.success && results.googleMaps.error && results.googleMaps.error.toLowerCase().includes('timeout'))) {
        badgeTitle += `\nGoogle Maps match may be ambiguous.`;
      }
      badgeTitle += `\nClick to show detailed card.`;
      badge.title = badgeTitle;
      
      // Add interactive click to badge to reveal full rating details
      badge.addEventListener('click', (e) => {
        e.stopPropagation();
        
        // Setup coordinates based on badge position
        const rect = badge.getBoundingClientRect();
        lastMouseX = rect.left + window.scrollX;
        lastMouseY = rect.bottom + window.scrollY;
        
        renderRatingResults(companyName, results);
        
        const card = getOrCreateCard();
        positionCard(card, lastMouseX, lastMouseY);
        card.classList.add('__crl-active');
      });
      
      // Insert the badge right after selection range
      const clonedRange = range.cloneRange();
      clonedRange.collapse(false); // Collapse selection to the end
      clonedRange.insertNode(badge);
      
      // Clear selection so the highlighted text is deselected after injection
      selection.removeAllRanges();
    }
  }
  
  // Parses and formats large integer review counts to strings like '10K' or '2.5M'
  function formatReviewCount(n) {
    if (!n || isNaN(n)) return null;
    if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
    if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
    return String(n);
  }
  
}
