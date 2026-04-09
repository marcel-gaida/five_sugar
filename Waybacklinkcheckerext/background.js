/* ============================================================
   Wayback Machine Link-Checker — Background Service Worker
   ============================================================ */

// ── Context-menu setup ──────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create(
      {
        id: "checkLinkWayback",
        title: "Check this link on Wayback Machine",
        contexts: ["link"],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Menu creation failed:", chrome.runtime.lastError.message);
        }
      }
    );

    chrome.contextMenus.create(
      {
        id: "checkPageWayback",
        title: "Check this page on Wayback Machine",
        contexts: ["page"],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Menu creation failed:", chrome.runtime.lastError.message);
        }
      }
    );

    chrome.contextMenus.create(
      {
        id: "savePageInclImages",
        title: "Save this page offline (HTML) [incl. images]",
        contexts: ["page"],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Menu creation failed:", chrome.runtime.lastError.message);
        }
      }
    );

    chrome.contextMenus.create(
      {
        id: "savePageExclImages",
        title: "Save this page offline (HTML) [excl. images]",
        contexts: ["page"],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Menu creation failed:", chrome.runtime.lastError.message);
        }
      }
    );

    // Separator + dashboard opener
    chrome.contextMenus.create(
      {
        id: "separator",
        type: "separator",
        contexts: ["page", "link"],
      }
    );

    chrome.contextMenus.create(
      {
        id: "openDashboard",
        title: "Open Wayback Dashboard",
        contexts: ["page", "link"],
      },
      () => {
        if (chrome.runtime.lastError) {
          console.error("Menu creation failed:", chrome.runtime.lastError.message);
        }
      }
    );
  });
});

// ── Context-menu click handler ──────────────────────────────

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "checkLinkWayback") {
    await checkAndOpen(info.linkUrl, tab);
  } else if (info.menuItemId === "checkPageWayback") {
    await checkAndOpen(tab.url, tab);
  } else if (info.menuItemId === "savePageInclImages") {
    await saveWithImages(tab);
  } else if (info.menuItemId === "savePageExclImages") {
    await saveWithoutImages(tab);
  } else if (info.menuItemId === "openDashboard") {
    // Open the actual extension popup (appears under the URL bar)
    // so it can detect the current tab. Falls back to window for older Chrome.
    try {
      await chrome.action.openPopup();
    } catch (err) {
      chrome.windows.create({
        url: chrome.runtime.getURL("popup.html"),
        type: "popup",
        width: 380,
        height: 620,
      });
    }
  }
});

// ── Helper: convert blob to data URL (service workers can't use blob URLs) ──

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

// ── Message handler: fetch resources as base64 for content scripts ──
// Content scripts can't bypass CORS, but the service worker can
// with <all_urls> host_permissions.

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "FETCH_AS_BASE64") {
    console.log("[FETCH_AS_BASE64]", msg.url?.slice(0, 100));
    fetch(msg.url)
      .then((resp) => {
        if (!resp.ok) throw new Error("HTTP " + resp.status);
        return resp.blob();
      })
      .then((blob) => {
        if (blob.size > 5 * 1024 * 1024) {
          sendResponse({ dataUrl: null });
          return;
        }
        const reader = new FileReader();
        reader.onloadend = () => sendResponse({ dataUrl: reader.result });
        reader.onerror = () => sendResponse({ dataUrl: null });
        reader.readAsDataURL(blob);
      })
      .catch((err) => {
        console.warn("[FETCH_AS_BASE64] failed:", msg.url, err.message);
        sendResponse({ dataUrl: null });
      });
    return true; // CRITICAL: keeps message channel open for async sendResponse
  }
});

// ── Save page offline — WITH images (SingleFile-style, one HTML file) ──

async function saveWithImages(tab) {
  try {
    const rawName = (tab.title || tab.url || "page")
      .replace(/[^a-zA-Z0-9_\- ]/g, "")
      .trim()
      .slice(0, 80) || "page";

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        // ─── Helper: fetch via service worker (bypasses CORS) ───
        async function fetchAsDataUrl(url, timeoutMs = 10000) {
          try {
            return await new Promise((resolve) => {
              const timer = setTimeout(() => resolve(null), timeoutMs);
              chrome.runtime.sendMessage(
                { type: "FETCH_AS_BASE64", url },
                (response) => {
                  clearTimeout(timer);
                  if (chrome.runtime.lastError) {
                    console.warn("sendMessage error:", chrome.runtime.lastError.message);
                    resolve(null);
                    return;
                  }
                  resolve(response?.dataUrl || null);
                }
              );
            });
          } catch { return null; }
        }

        function makeUrlsAbsolute(css, baseUrl) {
          try {
            const base = new URL(baseUrl);
            css = css.replace(/@import\s+["'](?!data:)(?!https?:\/\/)(?!\/\/)([^"']+)["']/gi,
              (m, p) => { try { return `@import "${new URL(p.trim(), base).href}"`; } catch { return m; } });
            css = css.replace(/url\(\s*["']?(?!data:)(?!https?:\/\/)(?!blob:)(?!\/\/)([^"')]+?)["']?\s*\)/gi,
              (m, p) => { try { return `url("${new URL(p.trim(), base).href}")`; } catch { return m; } });
            return css;
          } catch { return css; }
        }

        // Phase 1: Force lazy images + scroll
        document.querySelectorAll("img").forEach((img) => {
          const lazySrc = img.dataset.src || img.dataset.lazySrc || img.dataset.original;
          if (lazySrc) img.src = lazySrc;
          img.removeAttribute("loading");
          img.decoding = "sync";
        });
        document.querySelectorAll("picture source").forEach((s) => {
          if (s.dataset.srcset) s.srcset = s.dataset.srcset;
        });
        const scrollStep = window.innerHeight;
        const scrollMax = document.body.scrollHeight;
        for (let y = 0; y < scrollMax; y += scrollStep) {
          window.scrollTo(0, y);
          await new Promise((r) => setTimeout(r, 200));
        }
        window.scrollTo(0, 0);
        await Promise.allSettled(
          Array.from(document.querySelectorAll("img")).map((img) =>
            img.complete ? Promise.resolve() : new Promise((res) => {
              img.addEventListener("load", res, { once: true });
              img.addEventListener("error", res, { once: true });
              setTimeout(res, 8000);
            })
          )
        );

        // Phase 2: Collect ALL CSS
        const cssParts = [];
        for (const sheet of document.styleSheets) {
          try {
            const rules = Array.from(sheet.cssRules);
            cssParts.push(rules.map((r) => r.cssText).join("\n"));
          } catch {
            if (sheet.href) {
              try {
                // Fetch cross-origin stylesheet via service worker
                const css = await fetchAsDataUrl(sheet.href, 8000);
                if (css) {
                  // css is a data URI — decode it to text
                  const rawCss = atob(css.split(",")[1]);
                  cssParts.push(makeUrlsAbsolute(rawCss, sheet.href));
                }
              } catch {}
            }
          }
        }
        let fullCss = cssParts.join("\n\n");

        // Phase 2b: Resolve any remaining relative URLs against page baseURI
        fullCss = fullCss.replace(
          /url\(\s*["']?(?!data:)(?!https?:\/\/)(?!blob:)(?!\/\/)([^"')]+?)["']?\s*\)/gi,
          (m, p) => {
            try { return `url("${new URL(p.trim(), document.baseURI).href}")`; }
            catch { return m; }
          }
        );

        // Phase 3: Inline all url() resources in CSS via service worker
        const cssUrlRegex = /url\(\s*["']?(https?:\/\/[^"')]+?)["']?\s*\)/gi;
        const urlsToFetch = new Set();
        let urlMatch;
        while ((urlMatch = cssUrlRegex.exec(fullCss)) !== null) urlsToFetch.add(urlMatch[1]);
        const fetchedCssUrls = new Map();
        const urlArr = Array.from(urlsToFetch);
        console.log(`[SingleFile] Fetching ${urlArr.length} CSS resources via service worker…`);
        for (let i = 0; i < urlArr.length; i += 6) {
          const batch = urlArr.slice(i, i + 6);
          await Promise.allSettled(batch.map(async (url) => {
            const du = await fetchAsDataUrl(url);
            if (du) fetchedCssUrls.set(url, du);
          }));
        }
        console.log(`[SingleFile] Inlined ${fetchedCssUrls.size}/${urlArr.length} CSS resources`);
        for (const [origUrl, dataUrl] of fetchedCssUrls) {
          fullCss = fullCss.split(origUrl).join(dataUrl);
        }

        // Phase 4: Convert all <img> to base64 via service worker
        const imgDataMap = new Map();
        const allImgs = Array.from(document.querySelectorAll("img"));
        console.log(`[SingleFile] Converting ${allImgs.length} images to base64…`);
        for (let i = 0; i < allImgs.length; i += 6) {
          const batch = allImgs.slice(i, i + 6);
          await Promise.allSettled(batch.map(async (img) => {
            const src = img.src;
            if (!src || src.startsWith("data:") || src.startsWith("blob:") || imgDataMap.has(src)) return;
            let du = await fetchAsDataUrl(src);
            if (!du) {
              try {
                const cvs = document.createElement("canvas");
                cvs.width = img.naturalWidth || img.width || 1;
                cvs.height = img.naturalHeight || img.height || 1;
                if (cvs.width > 0 && cvs.height > 0) { cvs.getContext("2d").drawImage(img, 0, 0); du = cvs.toDataURL(); }
              } catch {}
            }
            if (du) imgDataMap.set(src, du);
          }));
        }
        console.log(`[SingleFile] Converted ${imgDataMap.size} images to base64`);

        // Phase 5: Clone DOM and apply changes
        const clone = document.documentElement.cloneNode(true);
        clone.querySelectorAll("script").forEach((s) => { if (s.type !== "application/ld+json") s.remove(); });
        const junkSelectors = [
          'img[src*="tracking"]','img[src*="pixel"]','img[src*="beacon"]',
          'img[width="1"][height="1"]','img[src*="1x1"]',
          'iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]',
          'iframe[src*="analytics"]','iframe[src*="facebook.com/tr"]','iframe[src*="googletagmanager"]',
          'link[rel="prefetch"]','link[rel="dns-prefetch"]','link[rel="preconnect"]',
        ].join(", ");
        clone.querySelectorAll(junkSelectors).forEach((el) => el.remove());
        clone.querySelectorAll("noscript").forEach((el) => el.remove());
        clone.querySelectorAll("style, link[rel='stylesheet'], link[rel='preload'][as='style']")
          .forEach((el) => el.remove());
        if (fullCss) {
          const styleEl = document.createElement("style");
          styleEl.textContent = fullCss;
          const head = clone.querySelector("head");
          if (head) head.appendChild(styleEl);
        }
        clone.querySelectorAll("img").forEach((img) => {
          const du = imgDataMap.get(img.src);
          if (du) img.setAttribute("src", du);
          img.removeAttribute("srcset"); img.removeAttribute("data-src");
          img.removeAttribute("data-srcset"); img.removeAttribute("data-lazy-src");
          img.removeAttribute("data-original"); img.removeAttribute("loading");
        });
        clone.querySelectorAll("picture source").forEach((s) => s.remove());
        clone.querySelectorAll("[srcset]").forEach((el) => el.removeAttribute("srcset"));
        clone.querySelectorAll("a[href]").forEach((a) => {
          const href = a.getAttribute("href");
          if (href && !href.startsWith("#") && !href.startsWith("javascript:") && !href.startsWith("mailto:") && !href.startsWith("data:")) {
            try { a.setAttribute("href", new URL(href, location.href).href); } catch {}
          }
        });
        clone.querySelectorAll("link[href]").forEach((l) => {
          try { l.setAttribute("href", new URL(l.getAttribute("href"), location.href).href); } catch {}
        });

        return "<!DOCTYPE html>\n" + clone.outerHTML;
      },
    });

    const html = results?.[0]?.result;
    if (!html) throw new Error("Could not capture page content.");

    const htmlBlob = new Blob([html], { type: "text/html;charset=utf-8" });
    const dataUrl = await blobToDataUrl(htmlBlob);
    await chrome.downloads.download({ url: dataUrl, filename: `${rawName}.html`, conflictAction: "uniquify" });
  } catch (err) {
    console.error("Save with images failed:", err);
  }
}

// ── Save page offline — WITHOUT images (HTML only, CSS inlined) ──

async function saveWithoutImages(tab) {
  try {
    const rawName = (tab.title || tab.url || "page")
      .replace(/[^a-zA-Z0-9_\- ]/g, "")
      .trim()
      .slice(0, 80) || "page";

    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: async () => {
        // ── Collect all CSS ──
        function makeUrlsAbsolute(css, baseUrl) {
          try {
            const base = new URL(baseUrl);
            css = css.replace(
              /@import\s+["'](?!data:)(?!https?:\/\/)(?!\/\/)([^"']+)["']/gi,
              (m, p) => {
                try { return `@import "${new URL(p.trim(), base).href}"`; }
                catch { return m; }
              }
            );
            css = css.replace(
              /url\(\s*["']?(?!data:)(?!https?:\/\/)(?!blob:)(?!\/\/)([^"')]+?)["']?\s*\)/gi,
              (m, p) => {
                try { return `url("${new URL(p.trim(), base).href}")`; }
                catch { return m; }
              }
            );
            return css;
          } catch { return css; }
        }

        const externalCss = [];
        for (const sheet of document.styleSheets) {
          if (sheet.ownerNode?.tagName === "STYLE") continue;
          try {
            const rules = Array.from(sheet.cssRules);
            externalCss.push(rules.map((r) => r.cssText).join("\n"));
          } catch {
            if (sheet.href) {
              try {
                const resp = await fetch(sheet.href);
                if (resp.ok) {
                  let css = await resp.text();
                  css = makeUrlsAbsolute(css, sheet.href);
                  externalCss.push(css);
                }
              } catch {}
            }
          }
        }

        // ── Clone and modify ──
        const clone = document.documentElement.cloneNode(true);

        // Remove scripts (prevents paywall / auth errors offline)
        clone.querySelectorAll("script").forEach((s) => { if (s.type !== "application/ld+json") s.remove(); });

        // Strip tracking, analytics, ads
        const junkSelectors = [
          'img[src*="tracking"]','img[src*="pixel"]','img[src*="beacon"]',
          'img[width="1"][height="1"]','img[src*="1x1"]',
          'iframe[src*="doubleclick"]','iframe[src*="googlesyndication"]',
          'iframe[src*="analytics"]','iframe[src*="facebook.com/tr"]','iframe[src*="googletagmanager"]',
          'link[rel="prefetch"]','link[rel="dns-prefetch"]','link[rel="preconnect"]',
        ].join(", ");
        clone.querySelectorAll(junkSelectors).forEach((el) => el.remove());
        clone.querySelectorAll("noscript").forEach((el) => el.remove());

        // Remove images
        clone.querySelectorAll("img, picture, video, source, svg.hero-image, [role='img']")
          .forEach((el) => el.remove());
        clone.querySelectorAll("[style]").forEach((el) => {
          if (el.style.backgroundImage) el.style.backgroundImage = "none";
        });
        clone.querySelectorAll("[srcset], [data-src], [data-srcset]").forEach((el) => {
          el.removeAttribute("srcset");
          el.removeAttribute("data-src");
          el.removeAttribute("data-srcset");
        });

        // Inline CSS
        clone.querySelectorAll('link[rel="stylesheet"], link[rel="preload"][as="style"]')
          .forEach((el) => el.remove());
        if (externalCss.length > 0) {
          const styleEl = document.createElement("style");
          styleEl.setAttribute("data-inlined", "true");
          styleEl.textContent = externalCss.join("\n\n");
          const head = clone.querySelector("head");
          if (head) head.appendChild(styleEl);
        }
        clone.querySelectorAll("style:not([data-inlined])").forEach((s) => {
          s.textContent = makeUrlsAbsolute(s.textContent, location.href);
        });

        // Absolute URLs
        clone.querySelectorAll("link[href]").forEach((l) => {
          try { l.setAttribute("href", new URL(l.getAttribute("href"), location.href).href); } catch {}
        });
        clone.querySelectorAll("a[href]").forEach((a) => {
          const href = a.getAttribute("href");
          if (href && !href.startsWith("#") && !href.startsWith("javascript:") && !href.startsWith("mailto:") && !href.startsWith("data:")) {
            try { a.setAttribute("href", new URL(href, location.href).href); } catch {}
          }
        });

        return "<!DOCTYPE html>\n" + clone.outerHTML;
      },
    });

    const html = results?.[0]?.result;
    if (!html) throw new Error("Could not capture page content.");

    const htmlBlob = new Blob([html], { type: "text/html;charset=utf-8" });
    const dataUrl = await blobToDataUrl(htmlBlob);
    await chrome.downloads.download({ url: dataUrl, filename: `${rawName}.html`, conflictAction: "uniquify" });
  } catch (err) {
    console.error("Save without images failed:", err);
  }
}

// ── CDX API — reliable snapshot detection ───────────────────
//
// The Availability API (archive.org/wayback/available) is unreliable —
// it often returns empty results for URLs that DO have snapshots.
// The CDX API is the authoritative source and always returns real data.
//
// We cache results for 10 minutes to avoid hammering the API on
// every tab switch, and add a fetch timeout to avoid hanging.

const cdxCache = new Map();        // url → { result, expiry }
const CDX_CACHE_TTL = 10 * 60_000; // 10 minutes
const CDX_TIMEOUT   = 8_000;       // 8 second fetch timeout
const pendingChecks = new Map();   // url → Promise (dedup in-flight requests)

async function checkWaybackCDX(targetUrl) {
  // 1. Check cache first
  const cached = cdxCache.get(targetUrl);
  if (cached && Date.now() < cached.expiry) {
    return cached.result;
  }

  // 2. Dedup: if a request for this URL is already in flight, reuse it
  if (pendingChecks.has(targetUrl)) {
    return pendingChecks.get(targetUrl);
  }

  const promise = _fetchCDX(targetUrl);
  pendingChecks.set(targetUrl, promise);

  try {
    const result = await promise;
    // Cache the result
    cdxCache.set(targetUrl, { result, expiry: Date.now() + CDX_CACHE_TTL });
    return result;
  } finally {
    pendingChecks.delete(targetUrl);
  }
}

async function _fetchCDX(targetUrl) {
  const maxRetries = 2;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const cdxUrl = `https://web.archive.org/cdx/search/cdx?url=` +
        `${encodeURIComponent(targetUrl)}&output=json&limit=1` +
        `&fl=timestamp,statuscode&sort=reverse`;

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), CDX_TIMEOUT);

      const response = await fetch(cdxUrl, { signal: controller.signal });
      clearTimeout(timeoutId);

      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const rows = await response.json();

      if (rows && rows.length > 1) {
        const [timestamp, statuscode] = rows[1];
        return {
          available: true, timestamp, statuscode,
          url: `https://web.archive.org/web/${timestamp}/${targetUrl}`,
        };
      }
      return { available: false };

    } catch (err) {
      if (err.name === "AbortError") {
        console.warn("CDX API timed out for:", targetUrl);
        return { available: false, error: true };
      }
      // On last attempt, give up gracefully
      if (attempt === maxRetries) {
        // Only log as warn, not error — this is expected when offline
        console.warn("CDX API failed after retries:", err.message);
        return { available: false, error: true };
      }
      // Wait before retry: 1s, then 2s
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
    }
  }
}

async function checkAndOpen(targetUrl, tab) {
  const result = await checkWaybackCDX(targetUrl);

  if (result.available) {
    chrome.tabs.create({ url: result.url });
  } else {
    chrome.tabs.create({ url: "https://web.archive.org/web/*/" + targetUrl });
    setBadge("✗", "#E74C3C", tab.id);
  }
}

// ── Badge indicator ─────────────────────────────────────────

function setBadge(text, color, tabId) {
  chrome.action.setBadgeText({ text, tabId }, () => {
    if (chrome.runtime.lastError) { /* tab closed, ignore */ }
  });
  chrome.action.setBadgeBackgroundColor({ color, tabId }, () => {
    if (chrome.runtime.lastError) { /* tab closed, ignore */ }
  });
}

async function updateBadgeForTab(tabId, url) {
  if (!url || url.startsWith("chrome://") || url.startsWith("chrome-extension://")) {
    setBadge("", "#000000", tabId);
    return;
  }

  // Show a loading indicator while checking
  setBadge("…", "#5C6275", tabId);

  const result = await checkWaybackCDX(url);
  if (result.error) {
    // API failed — don't show a misleading ✗, just clear the badge
    setBadge("?", "#F5A623", tabId);
  } else if (result.available) {
    setBadge("✓", "#2ECC71", tabId);
  } else {
    setBadge("✗", "#E74C3C", tabId);
  }
}

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  updateBadgeForTab(tabId, tab.url);
});

chrome.tabs.onActivated.addListener(async (activeInfo) => {
  try {
    const tab = await chrome.tabs.get(activeInfo.tabId);
    updateBadgeForTab(activeInfo.tabId, tab.url);
  } catch (err) {
    // Tab was closed before we could read it — ignore
  }
});

