document.addEventListener('DOMContentLoaded', () => {
  const googleApiKeyInput = document.getElementById('googleApiKey');
  const saveBtn = document.getElementById('saveBtn');
  const statusMessage = document.getElementById('statusMessage');
  const toggleKeyVisibility = document.getElementById('toggleKeyVisibility');

  // Load existing configuration from chrome.storage.local safely
  try {
    chrome.storage.local.get(['googleApiKey'], (result) => {
      if (chrome.runtime.lastError) {
        console.warn("[CRL] Storage read error:", chrome.runtime.lastError.message);
        return;
      }
      if (result && result.googleApiKey) {
        googleApiKeyInput.value = result.googleApiKey;
      }
    });
  } catch (err) {
    console.error("[CRL] Exception loading settings from storage:", err);
  }

  // Toggle Google API Key visibility
  toggleKeyVisibility.addEventListener('click', () => {
    const isPassword = googleApiKeyInput.type === 'password';
    googleApiKeyInput.type = isPassword ? 'text' : 'password';
    toggleKeyVisibility.textContent = isPassword ? '🙈' : '👁️';
  });

  // Save configurations safely
  saveBtn.addEventListener('click', () => {
    const googleApiKey = googleApiKeyInput.value.trim();

    // Minor validation: check if Google API key looks valid if filled
    if (googleApiKey && !googleApiKey.startsWith('AIzaSy')) {
      showStatus('Warning: Google Places API Key usually starts with "AIzaSy". Make sure it is correct.', 'error');
      return;
    }

    try {
      chrome.storage.local.set({
        googleApiKey: googleApiKey
      }, () => {
        if (chrome.runtime.lastError) {
          showStatus('Error saving settings: ' + chrome.runtime.lastError.message, 'error');
          return;
        }
        showStatus('Settings saved successfully! You can start searching.', 'success');
        
        // Auto fade-out status message after 3 seconds
        setTimeout(() => {
          statusMessage.style.display = 'none';
        }, 3000);
      });
    } catch (err) {
      console.error("[CRL] Exception saving settings to storage:", err);
      showStatus('Error: Chrome storage is unavailable.', 'error');
    }
  });

  function showStatus(text, type) {
    statusMessage.textContent = text;
    statusMessage.className = `status-msg ${type}`;
    statusMessage.style.display = 'block';
  }
});
