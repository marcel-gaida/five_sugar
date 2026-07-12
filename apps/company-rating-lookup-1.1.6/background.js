// Context Menu ID
const CONTEXT_MENU_ID = "crl-company-rating-lookup";

// Register context menu when extension is installed or reloaded
chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({
    id: CONTEXT_MENU_ID,
    title: "Look up ratings for '%s'",
    contexts: ["selection"]
  });

  // Legacy API Key migration
  try {
    const old = await chrome.storage.local.get(["google_api_key", "googlePlacesKey", "apiKey"]);
    const legacyKey = old.google_api_key || old.googlePlacesKey || old.apiKey;
    if (legacyKey) {
      await chrome.storage.local.set({ googleApiKey: legacyKey });
      console.log("[CRL] Migrated legacy Google Places API key to 'googleApiKey'");
    }
  } catch (err) {
    console.error("[CRL] Error migrating legacy keys:", err);
  }
});

// Listen for context menu click events
chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== CONTEXT_MENU_ID) return;
  
  // Guard against chrome:// and other restricted URLs
  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://") || tab.url.startsWith("about:")) {
    console.warn("[CRL] Cannot run on restricted page:", tab?.url);
    return;
  }
  
  const companyName = cleanCompanyName(info.selectionText);
  if (!companyName || !tab?.id) return;
  
  try {
    // Ensure content script is injected before messaging —
    // handles tabs that were open before the extension was installed or reloaded
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js']
      });
    } catch (injectErr) {
      // Already injected — ignore "Cannot access contents of url" errors
      // and "Extension context invalidated" — these are non-fatal
      if (!injectErr.message?.includes('already') && !injectErr.message?.includes('Cannot access')) {
        console.warn('[CRL] Script injection warning:', injectErr.message);
      }
    }
    // Also inject the CSS if not already present
    try {
      await chrome.scripting.insertCSS({
        target: { tabId: tab.id },
        files: ['styles/card.css']
      });
    } catch(e) { /* already injected — ignore */ }
    await waitForContentScript(tab.id);
    await chrome.tabs.sendMessage(tab.id, { action: "LOOKUP_STARTED", companyName });
    const results = await fetchRatings(companyName);
    await chrome.tabs.sendMessage(tab.id, { action: "LOOKUP_SUCCESS", results, companyName });
  } catch (err) {
    console.error("[CRL] Lookup error:", err);
    try {
      await chrome.tabs.sendMessage(tab.id, {
        action: "LOOKUP_ERROR",
        error: err.message || "An unexpected error occurred",
        companyName
      });
    } catch (sendErr) {
      console.warn("[CRL] Could not deliver error to tab:", sendErr.message);
    }
  }
});

// Listen for runtime messages (e.g. from floating card setup links)
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // Existing: open popup page
  if (msg.type === "CRL_OPEN_POPUP") {
    chrome.tabs.create({ url: chrome.runtime.getURL("popup.html") });
    return;
  }

  // NEW: LinkedIn batch lookup — called by linkedin-scanner.js for each company
  if (msg.action === "LINKEDIN_LOOKUP") {
    const name = cleanCompanyName(msg.companyName);
    fetchRatings(name, { city: msg.city || '' })
      .then((results) => sendResponse({ results }))
      .catch((err) => sendResponse({ results: null, error: err.message }));
    return true; // IMPORTANT: keeps the message channel open for async response
  }

  // NEW: Show the existing rating card at a specific position (triggered by badge click)
  if (msg.action === "SHOW_CARD_FOR_COMPANY") {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, {
          action: "LOOKUP_SUCCESS",
          companyName: msg.companyName,
          results: msg.results,
          injectX: msg.x,
          injectY: msg.y,
        }).catch(() => {});
      }
    });
    return;
  }
});

// Cleans common suffix descriptors from selected text for better search results
function cleanCompanyName(text) {
  if (!text) return "";
  let name = text.trim();
  
  // Remove quotes
  name = name.replace(/['"“”‘’]/g, '');
  
  // Clean off common corporate suffixes that reduce search accuracy (e.g. Stripe Inc. -> Stripe)
  const suffixes = [
    /\binc(?:\.?\b)/i,
    /\bllc(?:\.?\b)/i,
    /\bltd(?:\.?\b)/i,
    /\bcorp(?:\.?\b)/i,
    /\bcorporation\b/i,
    /\bco(?:\.?\b)/i,
    /\bcompany\b/i,
    /\bgroup\b/i,
    /\bsa\b/i,
    /\bpvt\b/i,
    /\bplc(?:\.?\b)/i
  ];
  
  for (const regex of suffixes) {
    name = name.replace(regex, '');
  }
  
  return name.trim().replace(/\s+/g, ' ');
}

// Orchestrator for fetching company ratings
async function fetchRatings(companyName, context = {}) {
  const results = {
    googleMaps: {
      rating: null,
      reviewsCount: null,
      url: `https://www.google.com/maps/search/${encodeURIComponent(companyName)}`,
      address: null,
      success: false,
      error: null
    },
    glassdoor: {
      rating: null,
      reviewsCount: null,
      url: `https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(companyName)}`,
      success: false,
      error: null
    }
  };

    // 1. Fetch Google Maps Ratings
    try {
      const gmData = await fetchGoogleMaps(companyName, context);
      if (gmData && !gmData.notFound) {
        results.googleMaps.rating = gmData.rating;
        results.googleMaps.reviewsCount = gmData.reviewCount ?? gmData.reviewsCount ?? null;
        if (gmData.url) {
          results.googleMaps.url = gmData.url;
        }
        if (gmData.address) {
          results.googleMaps.address = gmData.address;
        }
        results.googleMaps.success = true;
      } else {
        results.googleMaps.error = "No Google Maps rating found for this business.";
      }
    } catch (err) {
      results.googleMaps.error = err.message || "Google Maps lookup failed.";
    }

    // 2. Fetch Glassdoor Ratings
    try {
      const gdData = await fetchGlassdoor(companyName);
      // console.log("[CRL-DEBUG] gdData received in fetchRatings:", JSON.stringify(gdData));
      // console.log("[CRL-DEBUG] Assigning reviewsCount:", gdData ? (gdData.reviewCount ?? gdData.reviewsCount ?? null) : null);
      if (gdData && !gdData.notFound) {
        results.glassdoor.rating = gdData.rating;
        results.glassdoor.reviewsCount = gdData.reviewCount ?? gdData.reviewsCount ?? null;
        if (gdData.url) {
          results.glassdoor.url = gdData.url;
        }
        results.glassdoor.isAmbiguous = !!gdData.isAmbiguous;
        results.glassdoor.success = true;
      } else {
        results.glassdoor.error = "No Glassdoor rating found for this business.";
      }
    } catch (err) {
      results.glassdoor.error = err.message || "Glassdoor lookup failed.";
    }

    return results;
}

// Invisible Browser-Tab Scraping Orchestrator
function scrapeViaTab(url, scrapeScriptFn, timeoutMs = 8000, args = []) {
  return new Promise(async (resolve, reject) => {
    let tabId = null;
    const timeoutHandle = setTimeout(() => {
      if (tabId) chrome.tabs.remove(tabId).catch(() => {});
      reject(new Error("Scrape timed out after " + timeoutMs + "ms"));
    }, timeoutMs);
    
    try {
      // Create hidden tab in background
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;
      
      // Move to offscreen window so it never appears in the user's tab bar
      try {
        await chrome.windows.create({
          tabId: tabId,
          state: "minimized",
          focused: false,
          left: -2000,
          top: -2000,
          width: 800,
          height: 600,
          type: "popup"
        });
      } catch(e) { /* fallback: tab stays in background, still active:false */ }
      
      // Wait for tab loading to finish
      await new Promise((res) => {
        const listener = (changedTabId, changeInfo) => {
          if (changedTabId === tabId && changeInfo.status === "complete") {
            chrome.tabs.onUpdated.removeListener(listener);
            res();
          }
        };
        chrome.tabs.onUpdated.addListener(listener);
      });
      
      // Inject scraping script
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: scrapeScriptFn,
        args: args
      });
      
      clearTimeout(timeoutHandle);
      await chrome.tabs.remove(tabId).catch(() => {});
      resolve(results?.[0]?.result ?? null);
    } catch (err) {
      clearTimeout(timeoutHandle);
      if (tabId) await chrome.tabs.remove(tabId).catch(() => {});
      reject(err);
    }
  });
}

// Dedicated API Source: Google Maps via Places API (textsearch Call) with Keyless Scraping Fallback
async function fetchGoogleMaps(company, context = {}) {
  // Build an enriched query to reduce wrong-business matches
  // For short/ambiguous names, append "company" to bias toward businesses
  const isAmbiguous = company.split(' ').length <= 2 && company.length < 20;
  const cityHint = context.city || '';
  const enrichedQuery = [
    company,
    isAmbiguous ? 'company' : '',
    cityHint,
  ].filter(Boolean).join(' ');

  const { googleApiKey } = await chrome.storage.local.get("googleApiKey");
  
  // Diagnostic log for Chrome inspect service worker console
  console.log("[CRL] googleApiKey:", googleApiKey ? `present (${googleApiKey.length} chars)` : "MISSING — using browser scrape");
  
  if (!googleApiKey) {
    return fetchGoogleMapsNoKey(company, context);
  }
  
  try {
    const url = `https://maps.googleapis.com/maps/api/place/textsearch/json`
      + `?query=${encodeURIComponent(enrichedQuery)}`
      + `&key=${googleApiKey}`;
      
    const res = await fetch(url);
    const data = await res.json();
    
    if (data.status === "REQUEST_DENIED") {
      console.warn("[CRL] Places API key rejected, falling back to background scraping:", data.error_message);
      return fetchGoogleMapsNoKey(company, context);
    }
    
    if (!data.results?.length) {
      // Retry with " reviews" appended to query (handles service-area and remote companies better)
      const fallbackUrl = `https://maps.googleapis.com/maps/api/place/textsearch/json`
        + `?query=${encodeURIComponent(enrichedQuery + " reviews")}`
        + `&key=${googleApiKey}`;
        
      const res2 = await fetch(fallbackUrl);
      const data2 = await res2.json();
      
      if (!data2.results?.length) return fetchGoogleMapsNoKey(company, context);
      const topResult2 = data2.results.find(r => isPlausibleBusinessMatch(company, r));
      if (!topResult2) return { notFound: true };
      return parseGoogleResult(topResult2);
    }
    
    const topResult = data.results.find(r => isPlausibleBusinessMatch(company, r));
    if (!topResult) return fetchGoogleMapsNoKey(company, context);
    return parseGoogleResult(topResult);
  } catch (err) {
    console.error("[CRL] Places API query failed, falling back to background scraping:", err);
    return fetchGoogleMapsNoKey(company, context);
  }
}

// Validates that a Google Places result is plausibly the right business.
// Rejects obvious mismatches like a jewelry store for an IT company search.
function isPlausibleBusinessMatch(company, place) {
  if (!place) return false;

  const normalize = s => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
  const searchedName = normalize(company);
  const resultName = normalize(place.name || '');

  // Must share at least one significant word (ignore common words)
  const stopWords = new Set(['the', 'and', 'of', 'for', 'inc', 'llc', 'ltd', 'co', 'corp', 'group', 'company']);
  const searchWords = searchedName.split(/\s+/).filter(w => w.length > 2 && !stopWords.has(w));
  const resultWords = new Set(resultName.split(/\s+/));
  const hasWordOverlap = searchWords.some(w => resultWords.has(w));

  if (!hasWordOverlap) return false;

  // Reject if the place type is obviously wrong — consumer retail/food/personal services
  const badTypes = new Set([
    'jewelry_store', 'clothing_store', 'shoe_store', 'beauty_salon',
    'hair_care', 'spa', 'restaurant', 'food', 'bakery', 'cafe',
    'bar', 'night_club', 'lodging', 'gym', 'dentist', 'doctor',
    'pharmacy', 'grocery_or_supermarket', 'florist', 'pet_store',
    'car_dealer', 'car_repair', 'gas_station', 'bank', 'atm',
  ]);
  const placeTypes = place.types || [];
  if (placeTypes.some(t => badTypes.has(t))) return false;

  return true;
}

// Formats the Google Place result item
function parseGoogleResult(place) {
  return {
    name: place.name,
    rating: place.rating ?? null,
    reviewCount: place.user_ratings_total ?? null,
    placeId: place.place_id,
    address: place.formatted_address || null,
    url: place.place_id
      ? `https://www.google.com/maps/place/?q=place_id:${place.place_id}`
      : null
  };
}

// Google Maps Browser-Tab Scraper via Google Search Knowledge Panel (Zero Keys)
async function fetchGoogleMapsNoKey(company, context = {}) {
  const isAmbiguous = company.split(' ').length <= 2 && company.length < 20;
  const cityHint = context.city || '';
  const enrichedQuery = [company, isAmbiguous ? 'company' : '', cityHint].filter(Boolean).join(' ');
  const searchUrl = `https://www.google.com/search?q=${encodeURIComponent(enrichedQuery)}`;
  
  const result = await scrapeViaTab(searchUrl, () => {
    try {
      // ── Strategy 1: Knowledge Panel rating element ─────────────────────
      // The Knowledge Panel star rating uses a span with aria-label like "Rated 4.8 out of 5"
      const ratingAria = document.querySelector('[aria-label*="Rated "]');
      if (ratingAria) {
        const match = ratingAria.getAttribute("aria-label").match(/Rated\s+(\d\.\d)/i);
        if (match) {
          // Review count is nearby — look for sibling text like "25 Google reviews"
          const parent = ratingAria.closest('[data-attrid], [data-local-attribute], div');
          const reviewText = parent?.innerText?.match(/([\d,]+)\s+Google reviews?/i);
          const placeLink = parent?.closest('a')?.href || document.querySelector('a[href*="maps.google.com"], a[href*="google.com/maps"]')?.href;
          return {
            rating: parseFloat(match[1]),
            reviewCount: reviewText ? parseInt(reviewText[1].replace(/,/g, ''), 10) : null,
            url: placeLink || null
          };
        }
      }
      
      // ── Strategy 2: data-attrid="kc:/location/location:user_rating" ─────
      const kpRating = document.querySelector('[data-attrid*="user_rating"], [data-attrid*="rating"]');
      if (kpRating) {
        const numMatch = kpRating.innerText.match(/(\d\.\d)/);
        if (numMatch) return { rating: parseFloat(numMatch[1]), reviewCount: null, url: null };
      }
      
      // ── Strategy 3: Scan all spans for pattern "4.8" near "reviews" ────
      const allText = document.body.innerText;
      const ratingNearReviews = allText.match(/(\d\.\d)\s*[\u2605\u2606★☆]?\s*[·\s\-]?\s*([\d,]+)\s*(?:Google\s+)?reviews?/i);
      if (ratingNearReviews) {
        return {
          rating: parseFloat(ratingNearReviews[1]),
          reviewCount: parseInt(ratingNearReviews[2].replace(/,/g, ''), 10),
          url: document.querySelector('a[href*="maps.google"], a[href*="google.com/maps"]')?.href || null
        };
      }
      
      // ── Strategy 4: JSON-LD on the page ─────────────────────────────────
      for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
        try {
          const json = JSON.parse(script.textContent);
          const nodes = Array.isArray(json) ? json : (json['@graph'] || [json]);
          for (const node of nodes) {
            if (node.aggregateRating?.ratingValue) {
              return {
                rating: parseFloat(node.aggregateRating.ratingValue),
                reviewCount: parseInt(node.aggregateRating.reviewCount || 0),
                url: node.url || null
              };
            }
          }
        } catch(e) {}
      }
      return null;
    } catch(e) {
      return { error: e.message };
    }
  }, 8000); // Fast Knowledge Panel SSR scrape
  
  if (!result || result.error || !result.rating) return { notFound: true };
  
  return {
    rating: result.rating,
    reviewCount: result.reviewCount || null,
    url: result.url || `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(company)}`
  };
}

// Parses abbreviated review counts like "10K", "25.2K", "1M", "143" → integer
function parseReviewCount(text) {
  if (text === null || text === undefined) return null;
  const str = String(text).replace(/,/g, '').trim();
  const match = str.match(/^([\d.]+)\s*([KkMm]?)$/);
  if (!match) return null;
  let num = parseFloat(match[1]);
  if (isNaN(num)) return null;
  const suffix = match[2] ? match[2].toUpperCase() : '';
  if (suffix === 'K') num = Math.round(num * 1000);
  else if (suffix === 'M') num = Math.round(num * 1000000);
  else num = Math.round(num);
  return num;
}

// Dedicated API Source: Glassdoor Browser-Tab Scraper (Zero Keys)
async function fetchGlassdoor(company) {
  const searchUrl = `https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(company)}`;
  
  const result = await scrapeViaTab(searchUrl, (company) => {
    try {
      // ── Strategy 1: Exact class name selectors from live Glassdoor DOM ──
      // Note: Glassdoor uses CSS Modules so class names have hashes (e.g. __Y7DA5)
      // We match on the BASE part of the class name using [class*="..."] attribute selectors
      const cards = document.querySelectorAll('[class*="employer-card_employerCardContainer"]');
      const isAmbiguous = cards.length > 1 || window.location.href.includes('/Search/results.htm') || window.location.href.includes('/results.htm');
      
      for (const card of cards) {
        // Extract employer name to fuzzy match
        const nameEl = card.querySelector('[class*="employer-card_employerName"], h2, h3');
        const employerName = nameEl ? nameEl.textContent.trim() : "";
        
        // Reject if the result name doesn't fuzzy-match the searched company
        // e.g. prevents "Insight Global Staffing - Atlanta" matching over "Insight Global"
        const normalize = s => s.toLowerCase().replace(/[^a-z0-9]/g, '');
        const searchedNorm = normalize(company); // 'company' is the outer function param
        const resultNorm = normalize(employerName);
        if (!resultNorm.includes(searchedNorm) && !searchedNorm.includes(resultNorm)) {
          continue; // skip this card, try the next one
        }
 
        // Rating: <span class="employer-card_employerRatingContainer__...">4.0<span>★</span></span>
        const ratingEl = card.querySelector('[class*="employer-card_employerRatingContainer"]');
        if (!ratingEl) continue;
        // Get text content of the first child node (which is the text node containing "4.0") to strip the ★ child span text safely
        const ratingText = ratingEl.childNodes[0] ? ratingEl.childNodes[0].textContent.trim() : ratingEl.textContent.replace('★', '').trim();
        const rating = parseFloat(ratingText);
        if (isNaN(rating)) continue;
        
        // Review count: find the <div> that contains a <span>reviews</span> sibling
        // Structure: <div><span class="CompanyCard_companyCount__...">10K</span><span>reviews</span></div>
        let reviewCount = null;
        const infoDivs = card.querySelectorAll('[class*="CompanyCard_companyInfoContainer"] > div');
        for (const div of infoDivs) {
          const spans = div.querySelectorAll('span');
          if (spans.length >= 2 && spans[1].textContent.trim().toLowerCase().startsWith('review')) {
            reviewCount = spans[0].textContent.trim(); // e.g. "10K", "143"
            break;
          }
        }
        // URL: from the <a href="..."> of the card itself
        const href = card.getAttribute('href') || card.closest('a')?.getAttribute('href');
        const url = href ? 'https://www.glassdoor.com' + href : null;
        return { rating, reviewCount, url, isAmbiguous };
      }
      
      // ── Strategy 2: Fallback — scan all divs for review pattern ─────────
      const allInfoContainers = document.querySelectorAll('[class*="CompanyCard_companyInfoContainer"]');
      for (const container of allInfoContainers) {
        const divs = container.querySelectorAll('div');
        for (const div of divs) {
          const spans = div.querySelectorAll('span');
          if (spans.length >= 2 && spans[1].textContent.trim().toLowerCase().startsWith('review')) {
            const reviewCount = spans[0].textContent.trim();
            // Find the rating in a sibling element
            const cardEl = container.closest('[class*="employer-card_employerCardContainer"], a');
            const ratingEl = cardEl?.querySelector('[class*="employer-card_employerRatingContainer"], [class*="ratingContainer"], [class*="rating"]');
            const ratingText = (ratingEl?.childNodes[0] ? ratingEl.childNodes[0].textContent.trim() : null)
              || ratingEl?.textContent?.replace('★','').trim();
            const rating = parseFloat(ratingText);
            const href = cardEl?.getAttribute('href');
            return {
              rating: isNaN(rating) ? null : rating,
              reviewCount,
              url: href ? 'https://www.glassdoor.com' + href : null,
              isAmbiguous
            };
          }
        }
      }
      return null;
    } catch(e) {
      return { error: e.message };
    }
  }, 8000, [company]); // 8 second timeout limit
 
  if (!result || result.error) return { notFound: true };
  if (!result.rating || isNaN(result.rating)) return { notFound: true };
  
  const parsedCount = parseReviewCount(result.reviewCount);
  const isAmbiguous = result.isAmbiguous || !result.url || result.url.includes('/Search/results.htm') || result.url.includes('/results.htm');
  
  return {
    rating: result.rating,
    reviewCount: parsedCount,
    url: result.url || `https://www.glassdoor.com/Search/results.htm?keyword=${encodeURIComponent(company)}`,
    isAmbiguous: !!isAmbiguous
  };
}

async function waitForContentScript(tabId, retries = 10, delayMs = 100) {
  for (let i = 0; i < retries; i++) {
    try {
      await chrome.tabs.sendMessage(tabId, { action: "PING" });
      return;
    } catch (e) {
      await new Promise(r => setTimeout(r, delayMs));
    }
  }
  throw new Error("Content script did not become ready in time.");
}
