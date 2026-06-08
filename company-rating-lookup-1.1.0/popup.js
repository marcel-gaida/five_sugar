document.addEventListener('DOMContentLoaded', () => {
  const googleApiKeyInput = document.getElementById('googleApiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusMessage = document.getElementById('statusMessage');
  const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');
  const openLinkedInScanner = document.getElementById('openLinkedInScanner');
  const openIndeedScanner = document.getElementById('openIndeedScanner');

  // Load existing API key
  try {
    chrome.storage.local.get(['googleApiKey'], (result) => {
      if (chrome.runtime.lastError) {
        console.warn('[CRL] Storage read error:', chrome.runtime.lastError.message);
        return;
      }
      if (result && result.googleApiKey) {
        googleApiKeyInput.value = result.googleApiKey;
      }
    });
  } catch (err) {
    console.error('[CRL] Exception loading settings:', err);
  }

  // Show LinkedIn scan state from the active tab's page cache
  // This reads window.__crlRatingCache via scripting.executeScript so the
  // popup reflects what already scanned without triggering a new scan
  chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
  const isJobPage = tab.url?.includes('linkedin.com/jobs') || tab.url?.includes('indeed.com');
  if (!tab?.id || !isJobPage) return;

    const scanStatusEl = document.getElementById('liScanStatus');
    if (!scanStatusEl) return;

    chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const cache = window.__crlRatingCache;
        if (!cache || cache.size === 0) return null;
        return {
          count: cache.size,
          topCompanies: [...cache.entries()]
            .filter(([, v]) => v?.glassdoor?.rating)
            .sort((a, b) => (b[1].glassdoor.rating) - (a[1].glassdoor.rating))
            .slice(0, 3)
            .map(([name, v]) => ({ name, rating: v.glassdoor.rating.toFixed(1) }))
        };
      }
    }).then((results) => {
      const data = results?.[0]?.result;
      if (!data) {
        scanStatusEl.innerHTML = `<span class="li-scan-dot"></span> No scan run yet on this page`;
        return;
      }
      scanStatusEl.classList.add('has-results');
      const topList = data.topCompanies.map(c => `${c.name} <strong>${c.rating}</strong>`).join(' · ');
      scanStatusEl.innerHTML = `
        <span class="li-scan-dot"></span>
        <span>${data.count} companies scanned${data.topCompanies.length ? ` · Top: ${topList}` : ''}</span>
      `;
    }).catch(() => {
      // Not on a LinkedIn page or scripting not available — hide silently
    });
  });

  // LinkedIn Scanner button
  openLinkedInScanner.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const url = tab?.url || '';
      if (url.includes('linkedin.com/jobs')) {
        chrome.tabs.sendMessage(tab.id, { action: 'CRL_SHOW_LI_PANEL' }).catch(() => {}).finally(() => window.close());
      } else {
        chrome.tabs.create({ url: 'https://www.linkedin.com/jobs/' });
        window.close();
      }
    });
  });

  // Indeed Scanner button
  openIndeedScanner.addEventListener('click', () => {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      const url = tab?.url || '';
      if (url.includes('indeed.com')) {
        chrome.tabs.sendMessage(tab.id, { action: 'CRL_SHOW_INDEED_PANEL' }).catch(() => {}).finally(() => window.close());
      } else {
        chrome.tabs.create({ url: 'https://www.indeed.com/' });
        window.close();
      }
    });
  });

  // Toggle API key visibility
  toggleKeyVisibility.addEventListener('click', () => {
    const isPassword = googleApiKeyInput.type === 'password';
    googleApiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVisibility.textContent = isPassword ? '🙈' : '👁️';
  });

  // Save settings
  saveBtn.addEventListener('click', () => {
    const googleApiKey = googleApiKeyInput.value.trim();
    if (googleApiKey && !googleApiKey.startsWith('AIzaSy')) {
      showStatus('Warning: Google Places API Key usually starts with "AIzaSy".', 'error');
      return;
    }
    try {
      chrome.storage.local.set({ googleApiKey }, () => {
        if (chrome.runtime.lastError) {
          showStatus('Error saving: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        showStatus('Settings saved!', 'success');
        setTimeout(() => { statusMessage.style.display = 'none'; }, 3000);
      });
    } catch (err) {
      showStatus('Error: Chrome storage unavailable.', 'error');
    }
  });

  function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-msg ${type}`;
    statusMessage.style.display = 'block';
  }
});
