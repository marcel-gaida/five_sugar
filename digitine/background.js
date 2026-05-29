// Digitine Background Queue Manager & Orchestrator
let state = {
  urls: [],
  total: 0,
  blocked: 0,
  status: 'ready', // 'ready' | 'running' | 'paused' | 'stopped'
  stepDelay: 3,    // safety delay in seconds
  mode: 'block',   // 'block' | 'unblock'
  activeUrl: null,
  activeTabId: null,
  logs: []
};

// Loading Timeout Reference
let loadTimeoutId = null;

// Helpers
function log(message, type = 'info') {
  const now = new Date();
  const timeString = `[${now.toTimeString().split(' ')[0]}]`;
  
  const logEntry = {
    time: timeString,
    message: message,
    type: type
  };
  
  state.logs.push(logEntry);
  // Task 5: Cap state logs to exactly 200 elements in memory and local storage
  if (state.logs.length > 200) {
    state.logs.shift();
  }
  
  console.log(`[DIGITINE] [${type}] ${message}`);
  saveState();
  broadcastState();
}

function broadcastState() {
  chrome.runtime.sendMessage({
    action: 'stateUpdated',
    state: getState()
  }).catch(() => {
    // Popup is closed, this is expected
  });
}

function getState() {
  return {
    urls: state.urls,
    total: state.total,
    blocked: state.blocked,
    status: state.status,
    stepDelay: state.stepDelay,
    mode: state.mode,
    activeUrl: state.activeUrl,
    logs: state.logs
  };
}

async function saveState() {
  // Task 5: Cap activity log before serializing to storage
  if (state.logs && state.logs.length > 200) {
    state.logs = state.logs.slice(-200);
  }
  await chrome.storage.local.set({ digitineState: state });
}

async function loadState() {
  const data = await chrome.storage.local.get('digitineState');
  if (data && data.digitineState) {
    // Merge loaded data
    state = { ...state, ...data.digitineState };
    // If it was running when closed, set to paused so it doesn't run in background automatically on startup
    if (state.status === 'running') {
      state.status = 'paused';
      state.activeTabId = null;
      state.activeUrl = null;
    }
  }
}

// Initialize on startup
chrome.runtime.onInstalled.addListener(async () => {
  await loadState();
  log('Digitine Background Service Worker Installed.', 'info');
});

chrome.runtime.onStartup.addListener(async () => {
  await loadState();
  log('Digitine Service Worker Started.', 'info');
});

// Alarm Listener (Task 3)
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === 'next-block' && state.status === 'running') {
    processNext();
  }
});

// Process Command Messages from Popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'getState') {
    sendResponse(getState());
    return true;
  }
  
  if (request.action === 'reset') {
    state.urls = [];
    state.total = 0;
    state.blocked = 0;
    state.activeUrl = null;
    state.logs = [];
    state.status = 'ready';
    saveState();
    broadcastState();
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'start') {
    const isResuming = state.status === 'paused' && state.urls.length > 0;
    
    if (isResuming) {
      state.status = 'running';
      log('Resuming block queue automation...', 'info');
      processNext();
    } else {
      state.urls = request.urls || [];
      state.total = state.urls.length;
      state.blocked = 0;
      state.stepDelay = request.stepDelay || 3;
      state.mode = request.mode || 'block';
      state.status = 'running';
      state.activeUrl = null;
      state.activeTabId = null;
      state.logs = []; // Clear log console for new run
      
      log(`Starting ${state.mode} queue automation for ${state.total} profiles.`, 'success');
      processNext();
    }
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'pause') {
    state.status = 'paused';
    log('Automation paused by user. Current page will finish/hold.', 'warning');
    
    // Task 3: Cancel pending alarm safety delay
    chrome.alarms.clear('next-block');
    
    sendResponse({ success: true });
    return true;
  }
  
  if (request.action === 'stop') {
    state.status = 'stopped';
    log('Automation stopped and queue cleared.', 'danger');
    
    // Clean up timers & alarms
    if (loadTimeoutId) clearTimeout(loadTimeoutId);
    loadTimeoutId = null;
    chrome.alarms.clear('next-block');
    
    // Close active tab
    if (state.activeTabId) {
      const tabId = state.activeTabId;
      state.activeTabId = null;
      chrome.tabs.remove(tabId).catch(() => {});
    }
    
    state.urls = [];
    state.total = 0;
    state.blocked = 0;
    state.activeUrl = null;
    
    saveState();
    broadcastState();
    sendResponse({ success: true });
    return true;
  }
  
  // Script Messages (from Injected Content Script)
  if (request.action === 'logProgress') {
    log(request.message, request.type || 'info');
    return true;
  }
  
  if (request.action === 'blockComplete') {
    if (sender.tab && sender.tab.id === state.activeTabId) {
      const username = state.activeUrl.replace(/\/$/, '').split('/').pop();
      const verb = state.mode === 'unblock' ? 'unblocked' : 'blocked';
      
      if (request.result === 'success') {
        state.blocked++;
        log(`Successfully ${verb} @${username}!`, 'success');
      } else if (request.result === 'skipped') {
        log(`@${username} is already ${verb}. Skipping profile.`, 'warning');
      } else {
        log(`Failed to ${state.mode} @${username}: ${request.reason || 'Unknown error'}`, 'danger');
      }
      
      handleTaskEnd(request.result);
    }
    return true;
  }
});

// Watch if the automated tab is closed by the user
chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === state.activeTabId && state.status === 'running') {
    state.activeTabId = null;
    log('Active automated tab was closed by user.', 'warning');
    handleTaskEnd('failed');
  }
});

// Finalize active profile and schedule next
function handleTaskEnd(result) {
  if (loadTimeoutId) {
    clearTimeout(loadTimeoutId);
    loadTimeoutId = null;
  }
  
  const currentTabId = state.activeTabId;
  state.activeTabId = null;
  state.activeUrl = null;
  
  // Close the tab
  if (currentTabId) {
    chrome.tabs.remove(currentTabId).catch(() => {});
  }
  
  if (state.status !== 'running') {
    // If paused/stopped, don't trigger the next item
    broadcastState();
    return;
  }
  
  // Task 3: Enforce safety delay via chrome.alarms instead of bare setTimeout
  const waitMs = state.stepDelay * 1000 + (Math.random() * 1500); // Add slight human randomness
  log(`Waiting ${Math.round(waitMs / 100) / 10}s before opening next profile...`, 'info');
  
  // Create alarm (delay in minutes)
  const delayMin = waitMs / 60000;
  chrome.alarms.create('next-block', { delayInMinutes: delayMin });
}

// Queue Worker
async function processNext() {
  if (state.status !== 'running') return;
  
  if (state.urls.length === 0) {
    state.status = 'ready';
    state.activeUrl = null;
    state.activeTabId = null;
    const verb = state.mode === 'unblock' ? 'unblocked' : 'blocked';
    log(`Automation queue complete! Total accounts ${verb}: ${state.blocked}`, 'success');
    saveState();
    broadcastState();
    return;
  }
  
  // Get next profile URL
  const nextUrl = state.urls.shift();
  
  // Task 4: Validate constructed URLs against regex before opening tabs
  const isUrlValid = /^https:\/\/www\.instagram\.com\/[\w.]+\/?$/.test(nextUrl);
  if (!isUrlValid) {
    log(`Warning: Skipped invalid profile URL: "${nextUrl}".`, 'warning');
    state.activeUrl = nextUrl;
    handleTaskEnd('failed');
    return;
  }
  
  state.activeUrl = nextUrl;
  const username = nextUrl.replace(/\/$/, '').split('/').pop();
  
  const actionText = state.mode === 'unblock' ? 'unblock' : 'block';
  log(`Opening profile to ${actionText}: @${username}...`, 'info');
  saveState();
  broadcastState();
  
  try {
    // 1. Resolve URL to load (Unblock page vs specific profile URL)
    const targetUrl = state.mode === 'unblock' ? 'https://www.instagram.com/accounts/blocked_accounts/' : nextUrl;
    
    // 2. Create active focused tab
    const tab = await chrome.tabs.create({ url: targetUrl, active: true });
    state.activeTabId = tab.id;
    saveState();
    
    // Set 45-second fallback load/execution timeout
    loadTimeoutId = setTimeout(() => {
      log(`Timeout waiting for @${username} to finish ${state.mode}ing. Skipping to next.`, 'danger');
      handleTaskEnd('failed');
    }, 45000);
    
    // Wait for the tab to load and then inject our state-machine automation script
    chrome.tabs.onUpdated.addListener(function tabListener(tabId, changeInfo) {
      if (tabId === state.activeTabId && changeInfo.status === 'complete') {
        chrome.tabs.onUpdated.removeListener(tabListener);
        
        // Brief pause after load complete before running the automator script
        setTimeout(() => {
          if (state.activeTabId === tabId && state.status === 'running') {
            runAutomatorInTab(tabId);
          }
        }, 1500);
      }
    });
    
  } catch (error) {
    log(`Failed to initiate tab: ${error.message}`, 'danger');
    handleTaskEnd('failed');
  }
}

// Inject and execute the Page Block State Machine in the Instagram page context
function runAutomatorInTab(tabId) {
  const username = state.activeUrl.replace(/\/$/, '').split('/').pop();
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: executeBlockSequence,
    args: [state.stepDelay, state.mode, username]
  }).catch((error) => {
    log(`Script injection failed: ${error.message}`, 'danger');
    handleTaskEnd('failed');
  });
}

// --- INJECTED FUNCTION ---
// Runs strictly inside the DOM context of the opened Instagram profile page.
function executeBlockSequence(stepDelay, mode = 'block', targetUsername = '') {
  console.log(`[DIGITINE] Page automator active. Mode: ${mode}, Target: ${targetUsername}`);
  
  let stepTimeout = null;
  let automatorInterval = null;
  let currentState = 'START';
  let lastActionTime = Date.now();
  
  // Communication helpers
  function reportLog(message, type = 'info') {
    chrome.runtime.sendMessage({ action: 'logProgress', message: message, type: type });
  }
  
  function reportResult(result, reason = '') {
    // Clean up
    if (automatorInterval) clearInterval(automatorInterval);
    if (stepTimeout) clearTimeout(stepTimeout);
    
    chrome.runtime.sendMessage({ action: 'blockComplete', result: result, reason: reason });
  }
  
  // Visibility Helper
  function isVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    try {
      const style = window.getComputedStyle(el);
      return style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
    } catch (e) {
      return true; // Fallback
    }
  }

  // Element Finding Utilities
  function getUnblockButton() {
    // Already blocked profiles display a button containing 'Unblock'
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (btn.textContent.trim().toLowerCase() === 'unblock' && isVisible(btn)) {
        return btn;
      }
    }
    return null;
  }

  // Row locator for the Blocked Accounts page
  function getTargetUserRow(username) {
    if (!username) return null;
    const spans = document.querySelectorAll('span, div');
    for (const el of spans) {
      // Find the element containing exactly the target username
      if (el.textContent.trim().toLowerCase() === username.toLowerCase() && isVisible(el)) {
        // Walk up to find the enclosing container row that contains the 'Unblock' button
        let parent = el.parentElement;
        while (parent && parent !== document.body) {
          const btn = Array.from(parent.querySelectorAll('button, [role="button"], div[role="button"]'))
            .find(b => b.textContent.trim() === 'Unblock' && isVisible(b));
          if (btn) {
            return { row: parent, button: btn };
          }
          parent = parent.parentElement;
        }
      }
    }
    return null;
  }
  
  function getOptionsButton() {
    // Find options button via SVG labels (Instagram uses aria-label="Options" or svg[aria-label="Options"])
    const svg = document.querySelector('svg[aria-label="Options"]');
    if (svg && isVisible(svg)) {
      return svg.closest('button') || svg.closest('[role="button"]') || svg;
    }
    
    // Scan all buttons containing an SVG with 'Options' or aria-label
    const buttons = document.querySelectorAll('button, [role="button"]');
    for (const btn of buttons) {
      if (isVisible(btn) && (btn.querySelector('svg[aria-label="Options"]') || 
          btn.getAttribute('aria-label') === 'Options')) {
        return btn;
      }
    }
    
    // Fallback: search buttons with exact text '...'
    for (const btn of buttons) {
      if (btn.textContent.trim() === '...' && isVisible(btn)) {
        return btn;
      }
    }
    return null;
  }
  
  function getBlockInMenu() {
    // Find the 'Block' option in the Options popup list
    const buttons = document.querySelectorAll('button, [role="button"], span');
    for (const el of buttons) {
      if (el.textContent.trim() === 'Block' && isVisible(el)) {
        return el.closest('button') || el.closest('[role="button"]') || el;
      }
    }
    return null;
  }
  
  function getBlockConfirmation() {
    // 1. Extract target username
    const username = targetUsername || '';
    
    // 2. Find the active heading saying "Block [username]?" or "Unblock [username]?"
    const headings = document.querySelectorAll('h1, h2, [role="heading"], div');
    let targetHeading = null;
    const headingPrefix = mode === 'unblock' ? 'unblock ' : 'block ';
    const buttonText = mode === 'unblock' ? 'Unblock' : 'Block';
    
    for (const h of headings) {
      const text = h.textContent.trim().toLowerCase();
      // Match "block [username]?" or "unblock [username]?"
      if (text.startsWith(headingPrefix) && text.endsWith('?') && isVisible(h)) {
        targetHeading = h;
        break;
      }
    }
    
    if (targetHeading) {
      reportLog(`Found confirmation header: "${targetHeading.textContent.trim()}"`, 'info');
      // Traverse up to find the enclosing dialog box and select the button inside it
      let parent = targetHeading.parentElement;
      while (parent && parent !== document.body) {
        const btn = Array.from(parent.querySelectorAll('button, [role="button"], div[role="button"]'))
          .find(b => b.textContent.trim() === buttonText && isVisible(b));
        if (btn) {
          return btn;
        }
        parent = parent.parentElement;
      }
    }
    
    // 3. Fallback: Find a visible button with target text that has a sibling 'Cancel' button
    const buttons = document.querySelectorAll('button, [role="button"], div[role="button"]');
    for (const el of buttons) {
      if (el.textContent.trim() === buttonText && isVisible(el)) {
        const container = el.parentElement;
        if (container) {
          const hasCancelSibling = Array.from(container.querySelectorAll('button, [role="button"], div[role="button"]'))
            .some(b => b.textContent.trim() === 'Cancel');
          if (hasCancelSibling) {
            reportLog('Found confirmation button via sibling Cancel matcher.', 'info');
            return el;
          }
        }
      }
    }
    
    return null;
  }
  
  // State Machine Loop
  function tick() {
    const elapsed = Date.now() - lastActionTime;
    
    // Timeout safeguard (stuck in any single state for >12 seconds)
    if (elapsed > 12000) {
      reportLog(`Operation timeout in state: ${currentState}. Aborting.`, 'danger');
      reportResult('failed', `Timeout in state: ${currentState}`);
      return;
    }
    
    if (mode === 'unblock') {
      // --- UNBLOCK AUTOMATION BRANCH (BLOCKED ACCOUNTS LIST PAGE) ---
      switch (currentState) {
        case 'START':
          const target = getTargetUserRow(targetUsername);
          if (target) {
            reportLog(`Found @${targetUsername} in blocklist. Clicking Unblock...`, 'info');
            target.button.click();
            currentState = 'WAIT_CONFIRM';
            lastActionTime = Date.now();
          } else {
            // Scroll down periodically to load more accounts
            if (elapsed > 5500) {
              reportLog(`@${targetUsername} not found in blocked accounts list. Presuming already unblocked.`, 'warning');
              reportResult('skipped');
              return;
            }
            
            // Trigger scrolling
            window.scrollTo(0, document.body.scrollHeight);
            const divs = document.querySelectorAll('div');
            for (const d of divs) {
              if (d.scrollHeight > d.clientHeight) {
                d.scrollTop = d.scrollHeight;
              }
            }
          }
          break;
          
        case 'WAIT_CONFIRM':
          if (elapsed < 600) return;
          
          const confirmUnblockBtn = getBlockConfirmation();
          if (confirmUnblockBtn) {
            reportLog('Confirming account unblock...', 'info');
            confirmUnblockBtn.click();
            currentState = 'VERIFY_BLOCK';
            lastActionTime = Date.now();
          }
          break;
          
        case 'VERIFY_BLOCK':
          if (elapsed < 1500) return;
          
          reportLog('Verifying unblock success...', 'info');
          // If unblock succeeded, the username row should be gone
          if (!getTargetUserRow(targetUsername)) {
            reportResult('success');
          } else {
            // Fallback: confirmation dialog has closed
            if (!getBlockConfirmation()) {
              reportLog('Verification fallback: dialog closed. Unblock presumed successful.', 'success');
              reportResult('success');
            } else {
              reportLog('Could not verify unblock completion. Retrying click...', 'warning');
              const retryConfirm = getBlockConfirmation();
              if (retryConfirm) {
                retryConfirm.click();
                lastActionTime = Date.now();
              }
            }
          }
          break;
      }
    } else {
      // --- BLOCK AUTOMATION BRANCH (PROFILE PAGES) ---
      switch (currentState) {
        case 'START':
          reportLog('Checking account status...', 'info');
          
          // 1. Detect if already blocked
          if (getUnblockButton()) {
            reportLog('Account is already blocked! Skipping.', 'warning');
            reportResult('skipped');
            return;
          }
          
          // 2. Find options button
          const optBtn = getOptionsButton();
          if (optBtn) {
            reportLog('Opening options menu...', 'info');
            optBtn.click();
            currentState = 'WAIT_MENU';
            lastActionTime = Date.now();
          } else {
            // If we couldn't find options right away, check if user is not found
            const bodyText = document.body.textContent;
            if (bodyText.includes("Sorry, this page isn't available") || 
                bodyText.includes('User not found')) {
              reportLog('Profile not accessible (User not found or deleted). skipping.', 'warning');
              reportResult('failed', 'Page not available');
              return;
            }
          }
          break;
          
        case 'WAIT_MENU':
          // Wait for animation to settle
          if (elapsed < 600) return;
          
          const blockMenuBtn = getBlockInMenu();
          if (blockMenuBtn) {
            reportLog('Triggering Block option...', 'info');
            blockMenuBtn.click();
            currentState = 'WAIT_CONFIRM';
            lastActionTime = Date.now();
          }
          break;
          
        case 'WAIT_CONFIRM':
          // Wait for dialog animation
          if (elapsed < 600) return;
          
          const confirmBtn = getBlockConfirmation();
          if (confirmBtn) {
            reportLog('Confirming account block...', 'info');
            confirmBtn.click();
            currentState = 'VERIFY_BLOCK';
            lastActionTime = Date.now();
          }
          break;
          
        case 'VERIFY_BLOCK':
          // Wait for API request and UI redraw
          if (elapsed < 1500) return;
          
          reportLog('Verifying block success...', 'info');
          // If block succeeded, the options popup goes away, and the profile page displays 'Unblock'
          if (getUnblockButton()) {
            reportResult('success');
          } else {
            // Fallback verify: if options menu is gone and confirmation dialouge closed, we assume success
            if (!getBlockConfirmation() && !getBlockInMenu()) {
              reportLog('Verification fallback: dialog closed. Block presumed successful.', 'success');
              reportResult('success');
            } else {
              reportLog('Could not verify block completion. Retrying click...', 'warning');
              const retryConfirm = getBlockConfirmation();
              if (retryConfirm) {
                retryConfirm.click();
                lastActionTime = Date.now(); // reset timeout
              }
            }
          }
          break;
      }
    }
  }
  
  // Kick off state machine
  reportLog('Profile loaded. Starting automation flow...', 'info');
  automatorInterval = setInterval(tick, 600);
}