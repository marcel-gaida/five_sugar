/* ============================================================
   Wayback Machine Link-Checker — Popup Logic (v2.0)
   ============================================================ */

document.addEventListener("DOMContentLoaded", async () => {
  // ── DOM refs ──────────────────────────────────────────────
  const spinner         = document.getElementById("spinner");
  const statusContent   = document.getElementById("status-content");
  const statusCard      = document.getElementById("status-card");
  const statusIndicator = document.getElementById("status-indicator");
  const statusLabel     = document.getElementById("status-label");
  const statusMeta      = document.getElementById("status-meta");
  const currentUrlEl    = document.getElementById("current-url");
  const snapshotCard    = document.getElementById("snapshot-card");
  const snapshotDate    = document.getElementById("snapshot-date");
  const snapshotCount   = document.getElementById("snapshot-count");
  const timelineCard    = document.getElementById("timeline-card");
  const timelineList    = document.getElementById("timeline-list");
  const timelineBadge   = document.getElementById("timeline-badge");
  const btnView         = document.getElementById("btn-view");
  const btnTimeline     = document.getElementById("btn-timeline");
  const btnSaveOffline  = document.getElementById("btn-save-offline");

  // ── Get active tab ────────────────────────────────────────
  let tab;
  try {
    const [activeTab] = await chrome.tabs.query({ active: true, currentWindow: true });
    tab = activeTab;
  } catch (err) {
    showError("Could not get the current tab.");
    return;
  }

  if (!tab?.url || tab.url.startsWith("chrome://") || tab.url.startsWith("chrome-extension://")) {
    showUnavailable("This page cannot be checked.", "Chrome internal pages are not archivable.");
    currentUrlEl.textContent = tab?.url || "—";
    currentUrlEl.title = tab?.url || "";
    return;
  }

  // Display the current URL
  const displayUrl = tab.url.replace(/^https?:\/\//, "").replace(/\/$/, "");
  currentUrlEl.textContent = displayUrl;
  currentUrlEl.title = tab.url;

  // ── Wire up buttons ───────────────────────────────────────

  // Timeline button — always works
  btnTimeline.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://web.archive.org/web/*/" + tab.url });
  });

  // Save Offline button — with or without images
  const chkImages = document.getElementById("chk-images");

  btnSaveOffline.addEventListener("click", async () => {
    btnSaveOffline.disabled = true;
    const includeImages = chkImages.checked;

    const rawName = (tab.title || tab.url || "page")
      .replace(/[^a-zA-Z0-9_\- ]/g, "")
      .trim()
      .slice(0, 80) || "page";

    try {
      if (includeImages) {
        // ── SingleFile-style save (one self-contained HTML file) ──
        btnSaveOffline.textContent = "Capturing page…";

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
              } catch {
                return null;
              }
            }

            // ─── Helper: resolve relative URLs in CSS ───
            function makeUrlsAbsolute(css, baseUrl) {
              try {
                const base = new URL(baseUrl);
                css = css.replace(
                  /@import\s+["'](?!data:)(?!https?:\/\/)(?!\/\/)([^"']+)["']/gi,
                  (m, p) => {
                    try {
                      return `@import "${new URL(p.trim(), base).href}"`;
                    } catch {
                      return m;
                    }
                  }
                );
                css = css.replace(
                  /url\(\s*["']?(?!data:)(?!https?:\/\/)(?!blob:)(?!\/\/)([^"')]+?)["']?\s*\)/gi,
                  (m, p) => {
                    try {
                      return `url("${new URL(p.trim(), base).href}")`;
                    } catch {
                      return m;
                    }
                  }
                );
                return css;
              } catch {
                return css;
              }
            }

            // ─── Phase 1: Force lazy images + scroll ───
            document.querySelectorAll("img").forEach((img) => {
              const lazySrc =
                img.dataset.src ||
                img.dataset.lazySrc ||
                img.dataset.original;
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
                img.complete
                  ? Promise.resolve()
                  : new Promise((res) => {
                      img.addEventListener("load", res, { once: true });
                      img.addEventListener("error", res, { once: true });
                      setTimeout(res, 8000);
                    })
              )
            );

            // ─── Phase 2: Collect ALL CSS (external + inline) ───
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

            // ─── Phase 2b: Resolve remaining relative URLs ───
            //     Catches font paths like url(fonts/family/...) that
            //     need document.baseURI prepended to become absolute.
            fullCss = fullCss.replace(
              /url\(\s*["']?(?!data:)(?!https?:\/\/)(?!blob:)(?!\/\/)([^"')]+?)["']?\s*\)/gi,
              (m, p) => {
                try {
                  return `url("${new URL(p.trim(), document.baseURI).href}")`;
                } catch {
                  return m;
                }
              }
            );

            // ─── Phase 3: Inline all url() resources in CSS ───
            //     (fonts, background-images, cursors, etc.)
            const cssUrlRegex =
              /url\(\s*["']?(https?:\/\/[^"')]+?)["']?\s*\)/gi;
            const urlsToFetch = new Set();
            let urlMatch;
            while ((urlMatch = cssUrlRegex.exec(fullCss)) !== null) {
              urlsToFetch.add(urlMatch[1]);
            }

            const fetchedCssUrls = new Map();
            const urlArr = Array.from(urlsToFetch);
            console.log(`[SingleFile] Fetching ${urlArr.length} CSS resources via service worker…`);
            for (let i = 0; i < urlArr.length; i += 6) {
              const batch = urlArr.slice(i, i + 6);
              await Promise.allSettled(
                batch.map(async (url) => {
                  const du = await fetchAsDataUrl(url);
                  if (du) fetchedCssUrls.set(url, du);
                })
              );
            }
            console.log(`[SingleFile] Inlined ${fetchedCssUrls.size}/${urlArr.length} CSS resources`);

            for (const [origUrl, dataUrl] of fetchedCssUrls) {
              fullCss = fullCss.split(origUrl).join(dataUrl);
            }

            // ─── Phase 4: Convert all <img> to base64 data URIs ───
            const imgDataMap = new Map();
            const allImgs = Array.from(document.querySelectorAll("img"));
            console.log(`[SingleFile] Converting ${allImgs.length} images to base64…`);

            for (let i = 0; i < allImgs.length; i += 6) {
              const batch = allImgs.slice(i, i + 6);
              await Promise.allSettled(
                batch.map(async (img) => {
                  const src = img.src;
                  if (
                    !src ||
                    src.startsWith("data:") ||
                    src.startsWith("blob:") ||
                    imgDataMap.has(src)
                  )
                    return;

                  // Fetch via service worker (bypasses CORS)
                  let du = await fetchAsDataUrl(src);

                  // Fallback: canvas (works for same-origin / CORS images)
                  if (!du) {
                    try {
                      const cvs = document.createElement("canvas");
                      cvs.width = img.naturalWidth || img.width || 1;
                      cvs.height = img.naturalHeight || img.height || 1;
                      if (cvs.width > 0 && cvs.height > 0) {
                        cvs.getContext("2d").drawImage(img, 0, 0);
                        du = cvs.toDataURL();
                      }
                    } catch {}
                  }

                  if (du) imgDataMap.set(src, du);
                })
              );
            }
            console.log(`[SingleFile] Converted ${imgDataMap.size} images to base64`);

            // ─── Phase 5: Clone DOM and apply all changes ───
            const clone = document.documentElement.cloneNode(true);

            // Remove all scripts (prevents paywall / auth errors offline)
            // Keep JSON-LD structured data (non-executable metadata)
            clone.querySelectorAll("script").forEach((s) => {
              if (s.type !== "application/ld+json") s.remove();
            });

            // Strip tracking pixels, analytics, ad iframes, prefetch links
            const junkSelectors = [
              'img[src*="tracking"]',
              'img[src*="pixel"]',
              'img[src*="beacon"]',
              'img[width="1"][height="1"]',
              'img[src*="1x1"]',
              'iframe[src*="doubleclick"]',
              'iframe[src*="googlesyndication"]',
              'iframe[src*="analytics"]',
              'iframe[src*="facebook.com/tr"]',
              'iframe[src*="googletagmanager"]',
              'link[rel="prefetch"]',
              'link[rel="dns-prefetch"]',
              'link[rel="preconnect"]',
            ].join(", ");
            clone.querySelectorAll(junkSelectors).forEach((el) => el.remove());
            clone
              .querySelectorAll("noscript")
              .forEach((el) => el.remove());

            // Remove ALL <style> and stylesheet <link>s (replaced by one block)
            clone
              .querySelectorAll(
                "style, link[rel='stylesheet'], link[rel='preload'][as='style']"
              )
              .forEach((el) => el.remove());

            // Inject fully-inlined CSS as one <style> block
            if (fullCss) {
              const styleEl = document.createElement("style");
              styleEl.textContent = fullCss;
              const head = clone.querySelector("head");
              if (head) head.appendChild(styleEl);
            }

            // Replace <img> src with embedded base64 data URIs
            clone.querySelectorAll("img").forEach((img) => {
              const du = imgDataMap.get(img.src);
              if (du) img.setAttribute("src", du);
              img.removeAttribute("srcset");
              img.removeAttribute("data-src");
              img.removeAttribute("data-srcset");
              img.removeAttribute("data-lazy-src");
              img.removeAttribute("data-original");
              img.removeAttribute("loading");
            });

            // Remove <picture><source> (the <img> fallback has the data URI)
            clone
              .querySelectorAll("picture source")
              .forEach((s) => s.remove());
            clone
              .querySelectorAll("[srcset]")
              .forEach((el) => el.removeAttribute("srcset"));

            // Make <a href> absolute for clickable navigation
            clone.querySelectorAll("a[href]").forEach((a) => {
              const href = a.getAttribute("href");
              if (
                href &&
                !href.startsWith("#") &&
                !href.startsWith("javascript:") &&
                !href.startsWith("mailto:") &&
                !href.startsWith("data:")
              ) {
                try {
                  a.setAttribute(
                    "href",
                    new URL(href, location.href).href
                  );
                } catch {}
              }
            });

            // Make remaining <link href> absolute
            clone.querySelectorAll("link[href]").forEach((l) => {
              try {
                l.setAttribute(
                  "href",
                  new URL(l.getAttribute("href"), location.href).href
                );
              } catch {}
            });

            return "<!DOCTYPE html>\n" + clone.outerHTML;
          },
        });

        const html = results?.[0]?.result;
        if (!html) throw new Error("Could not capture page content.");

        btnSaveOffline.textContent = "Saving…";
        const htmlBlob = new Blob([html], {
          type: "text/html;charset=utf-8",
        });
        const blobUrl = URL.createObjectURL(htmlBlob);

        await chrome.downloads.download({
          url: blobUrl,
          filename: `${rawName}.html`,
          conflictAction: "uniquify",
        });

        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      } else {
        // ── Lightweight save (no images, CSS inlined) ────────
        btnSaveOffline.textContent = "Capturing…";

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
            clone.querySelectorAll("script").forEach((s) => {
              if (s.type !== "application/ld+json") s.remove();
            });

            // Strip tracking, analytics, ads
            const junkSelectors = [
              'img[src*="tracking"]', 'img[src*="pixel"]', 'img[src*="beacon"]',
              'img[width="1"][height="1"]', 'img[src*="1x1"]',
              'iframe[src*="doubleclick"]', 'iframe[src*="googlesyndication"]',
              'iframe[src*="analytics"]', 'iframe[src*="facebook.com/tr"]',
              'iframe[src*="googletagmanager"]',
              'link[rel="prefetch"]', 'link[rel="dns-prefetch"]',
              'link[rel="preconnect"]',
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
        const blobUrl = URL.createObjectURL(htmlBlob);

        await chrome.downloads.download({
          url: blobUrl,
          filename: `${rawName}.html`,
          conflictAction: "uniquify",
        });

        setTimeout(() => URL.revokeObjectURL(blobUrl), 5000);
      }

      btnSaveOffline.textContent = "✓ Saved!";
      setTimeout(() => {
        btnSaveOffline.textContent = "Save Page Offline";
        btnSaveOffline.disabled = false;
      }, 2000);
    } catch (err) {
      console.error("Save offline error:", err);
      btnSaveOffline.textContent = "✗ Failed";
      setTimeout(() => {
        btnSaveOffline.textContent = "Save Page Offline";
        btnSaveOffline.disabled = false;
      }, 2000);
    }
  });

  // ── Check Wayback & load timeline (single CDX call) ────────
  //
  // We make ONE CDX request and use the results for both the
  // status card and the snapshot timeline, avoiding rate limits.

  // Human-readable status code mapping
  function getStatusInfo(code) {
    const map = {
      "200": { label: "Available",      cls: "status-ok"      },
      "301": { label: "Redirect",       cls: "status-ok"      },
      "302": { label: "Redirect",       cls: "status-ok"      },
      "304": { label: "Not Modified",   cls: "status-ok"      },
      "-":   { label: "Captured",       cls: "status-ok"      },
      "400": { label: "Bad Request",    cls: "status-err"     },
      "401": { label: "Unauthorized",   cls: "status-err"     },
      "403": { label: "Forbidden",      cls: "status-err"     },
      "404": { label: "Not Found",      cls: "status-err"     },
      "410": { label: "Gone",           cls: "status-err"     },
      "429": { label: "Rate Limited",   cls: "status-warn"    },
      "500": { label: "Server Error",   cls: "status-err"     },
      "502": { label: "Bad Gateway",    cls: "status-err"     },
      "503": { label: "Unavailable",    cls: "status-err"     },
      "504": { label: "Timeout",        cls: "status-err"     },
    };

    if (map[code]) return map[code];

    const num = parseInt(code, 10);
    if (num >= 200 && num < 300) return { label: "Success",    cls: "status-ok"  };
    if (num >= 300 && num < 400) return { label: "Redirect",   cls: "status-ok"  };
    if (num >= 400 && num < 500) return { label: "Client Err", cls: "status-err" };
    if (num >= 500)              return { label: "Server Err", cls: "status-err" };

    return { label: "Captured", cls: "status-ok" };
  }

  // Fetch with retry (handles 503 rate limits from the CDX API)
  async function fetchWithRetry(url, retries = 3, delayMs = 2000) {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const response = await fetch(url);
        if (response.status === 503 && attempt < retries) {
          // Rate limited — wait and retry
          await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
          continue;
        }
        return response;
      } catch (err) {
        if (attempt < retries) {
          await new Promise((r) => setTimeout(r, delayMs * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }
  }

  try {
    const cdxUrl =
      `https://web.archive.org/cdx/search/cdx?url=${encodeURIComponent(tab.url)}` +
      `&output=json&limit=20&fl=timestamp,statuscode&sort=reverse&collapse=timestamp:8`;

    const response = await fetchWithRetry(cdxUrl);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const rows = await response.json();

    if (rows && rows.length > 1) {
      const data = rows.slice(1); // skip header row

      // Use the first (latest) snapshot for the status card
      const [latestTs, latestCode] = data[0];
      const latestUrl = `https://web.archive.org/web/${latestTs}/${tab.url}`;
      showAvailable({ timestamp: latestTs, statuscode: latestCode, url: latestUrl });

      // Build the timeline from the same data
      renderTimeline(data, tab.url);
    } else {
      showUnavailable(
        "No snapshots found",
        "This page has not been archived yet."
      );
    }
  } catch (err) {
    console.error("CDX API error:", err);
    showError("Could not reach the Wayback Machine API.");
  }

  // ── Render timeline from already-fetched data ─────────────

  function renderTimeline(data, pageUrl) {
    timelineCard.style.display = "flex";

    snapshotCount.textContent = data.length >= 20 ? "20+" : String(data.length);
    timelineBadge.textContent = data.length >= 20 ? "20+" : String(data.length);

    timelineList.innerHTML = "";

    data.forEach((row) => {
      const ts         = row[0];
      const statusCode = row[1];

      const year  = ts.slice(0, 4);
      const month = ts.slice(4, 6);
      const day   = ts.slice(6, 8);
      const hour  = ts.slice(8, 10);
      const min   = ts.slice(10, 12);

      const dateStr = `${year}-${month}-${day}`;
      const timeStr = `${hour}:${min}`;
      const snapshotUrl = `https://web.archive.org/web/${ts}/${pageUrl}`;

      const info = getStatusInfo(statusCode);
      const isOk = info.cls !== "status-err";
      const codeNote = statusCode === "-" ? "" : `Code ${statusCode}`;

      const item = document.createElement("a");
      item.className = "timeline-item";
      item.href = snapshotUrl;
      item.target = "_blank";
      item.rel = "noopener";

      item.innerHTML = `
        <div class="timeline-dot ${isOk ? "dot-ok" : "dot-err"}"></div>
        <div class="timeline-info">
          <span class="timeline-date">${dateStr}</span>
          <span class="timeline-time">${timeStr} UTC</span>
        </div>
        <div class="timeline-status-group">
          <span class="timeline-status ${info.cls}">${info.label}</span>
          ${codeNote ? `<span class="timeline-code">${codeNote}</span>` : ""}
        </div>
        <svg class="timeline-arrow" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      `;

      item.addEventListener("click", (e) => {
        e.preventDefault();
        chrome.tabs.create({ url: snapshotUrl });
      });

      timelineList.appendChild(item);
    });
  }

  // ── UI helpers ────────────────────────────────────────────

  function showAvailable(snapshot) {
    spinner.style.display = "none";
    statusContent.style.display = "flex";
    statusCard.classList.remove("loading");

    statusIndicator.textContent = "✓";
    statusIndicator.classList.add("available");

    statusLabel.textContent = "Archived";
    statusMeta.textContent = "This page has captures on the Wayback Machine.";

    // Snapshot info card
    snapshotCard.style.display = "flex";

    const ts = snapshot.timestamp;
    if (ts && ts.length >= 8) {
      const year  = ts.slice(0, 4);
      const month = ts.slice(4, 6);
      const day   = ts.slice(6, 8);
      snapshotDate.textContent = `${year}-${month}-${day}`;
    } else {
      snapshotDate.textContent = "—";
    }

    // Enable "View Latest"
    btnView.disabled = false;
    btnView.addEventListener("click", () => {
      chrome.tabs.create({ url: snapshot.url });
    });
  }

  function showUnavailable(title, detail) {
    spinner.style.display = "none";
    statusContent.style.display = "flex";
    statusCard.classList.remove("loading");

    statusIndicator.textContent = "✗";
    statusIndicator.classList.add("unavailable");

    statusLabel.textContent = title;
    statusMeta.textContent = detail;

    btnView.disabled = true;
  }

  function showError(msg) {
    spinner.style.display = "none";
    statusContent.style.display = "flex";
    statusCard.classList.remove("loading");

    statusIndicator.textContent = "!";
    statusIndicator.classList.add("unavailable");

    statusLabel.textContent = "Error";
    statusMeta.textContent = msg;

    btnView.disabled = true;
  }
});
