// UI Elements
const urlListInput = document.getElementById('urlList');
const stepDelayInput = document.getElementById('stepDelay');
const queueCountEl = document.getElementById('queueCount');
const statusPanel = document.getElementById('statusPanel');
const configPanel = document.getElementById('configPanel');

const progressPercent = document.getElementById('progressPercent');
const progressFraction = document.getElementById('progressFraction');
const progressBar = document.getElementById('progressBar');
const statBlocked = document.getElementById('statBlocked');
const statRemaining = document.getElementById('statRemaining');
const activeTarget = document.getElementById('activeTarget');

const logConsole = document.getElementById('logConsole');
const btnDownloadLog = document.getElementById('btnDownloadLog');
const btnExpand = document.getElementById('btnExpand');

const btnStart = document.getElementById('btnStart');
const btnPause = document.getElementById('btnPause');
const btnStop = document.getElementById('btnStop');
const btnResetTool = document.getElementById('btn-reset-tool');

const modeBlock = document.getElementById('modeBlock');
const modeUnblock = document.getElementById('modeUnblock');

const statusIndicator = document.getElementById('statusIndicator');
const statusText = document.getElementById('statusText');

// Application Mode state
let currentMode = 'block'; // 'block' | 'unblock'
let latestLogs = [];       // Keep reference to logs for downloading

// Check if running inside a full tab vs a transient popup
const isTab = new URLSearchParams(window.location.search).get('view') === 'tab';

// Log helper
function appendLog(message, type = 'info') {
  const entry = document.createElement('div');
  entry.className = `log-entry ${type}`;
  
  const timeSpan = document.createElement('span');
  timeSpan.className = 'log-entry time';
  const now = new Date();
  timeSpan.textContent = `[${now.toTimeString().split(' ')[0]}]`;
  
  const textSpan = document.createElement('span');
  textSpan.textContent = message;
  
  entry.appendChild(timeSpan);
  entry.appendChild(textSpan);
  logConsole.appendChild(entry);
  
  // Keep scroll at bottom
  logConsole.scrollTop = logConsole.scrollHeight;
}

// Update queue count label
function updateQueueCount() {
  const text = urlListInput.value.trim();
  if (!text) {
    queueCountEl.textContent = '0 loaded';
    return;
  }
  const lines = text.split('\n').filter(line => line.trim().length > 0);
  queueCountEl.textContent = `${lines.length} loaded`;
}

// Textarea input changes trigger count and reactive reset button updates
urlListInput.addEventListener('input', () => {
  updateQueueCount();
  // Trigger update check on reset button if not running
  chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
    if (state) updateUI(state);
  });
});

// Initialize State from Background/Storage
async function init() {
  updateQueueCount();
  
  // Apply tab view adaptations if loaded inside a standalone tab
  if (isTab) {
    document.body.classList.add('is-tab-view');
    btnExpand.style.display = 'none'; // Hide expand icon when already expanded
  }
  
  // Setup Mode Buttons
  modeBlock.addEventListener('click', () => {
    if (configPanel.classList.contains('disabled')) return;
    setMode('block');
  });
  
  modeUnblock.addEventListener('click', () => {
    if (configPanel.classList.contains('disabled')) return;
    setMode('unblock');
  });

  // Setup Download Logs Button
  btnDownloadLog.addEventListener('click', downloadLogs);
  
  // Setup Expand View Button
  btnExpand.addEventListener('click', () => {
    chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') });
    window.close(); // Close the transient popup
  });

  // Setup Reset Tool Button
  btnResetTool.addEventListener('click', () => {
    // 1. Clears keys from storage exactly as requested
    chrome.storage.local.remove(['queue', 'log', 'progress', 'counters']);
    
    // Symmetrically clear state keys inside digitineState so it doesn't reload on next startup
    chrome.storage.local.get('digitineState', (data) => {
      if (data && data.digitineState) {
        const updatedState = {
          ...data.digitineState,
          urls: [],
          total: 0,
          blocked: 0,
          activeUrl: null,
          logs: []
        };
        chrome.storage.local.set({ digitineState: updatedState });
      }
    });
    
    // 2. Cross-context alarms clearance
    chrome.alarms.clear('next-block');
    
    // 3. Clear background worker in-memory state
    chrome.runtime.sendMessage({ action: 'reset' });

    // 4. Reset visible popup elements immediately
    logConsole.innerHTML = '';
    progressBar.style.width = '0%';
    progressPercent.textContent = '0%';
    progressFraction.textContent = '0 / 0';
    statBlocked.textContent = '0';
    statRemaining.textContent = '0';
    urlListInput.value = '';
    updateQueueCount();
    activeTarget.textContent = 'None';
    
    // Restore button idle states
    btnStart.disabled = false;
    btnPause.disabled = true;
    btnStop.disabled = true;
    btnResetTool.disabled = true;
    
    // Log single entry with neutral timestamp
    appendLog('Tool reset.', 'info');
  });
  
  // Ask background for current state
  chrome.runtime.sendMessage({ action: 'getState' }, (state) => {
    if (chrome.runtime.lastError) {
      appendLog('Failed to connect to background service worker.', 'danger');
      return;
    }
    
    if (state) {
      updateUI(state);
    }
  });
}

function setMode(mode) {
  currentMode = mode;
  if (mode === 'block') {
    modeBlock.classList.add('active');
    modeUnblock.classList.remove('active');
    
    btnStart.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      Start Blocking
    `;
    
    document.querySelector('.stat-card.success .stat-label').textContent = 'Blocked';
  } else {
    modeBlock.classList.remove('active');
    modeUnblock.classList.add('active');
    
    btnStart.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      Start Unblocking
    `;
    
    document.querySelector('.stat-card.success .stat-label').textContent = 'Unblocked';
  }
}

// Update UI elements based on state
function updateUI(state) {
  const { status, urls, total, blocked, activeUrl, logs, stepDelay, mode } = state;
  
  latestLogs = logs || [];
  
  if (mode) {
    setMode(mode);
  }

  // Buttons and Panel visibility
  if (status === 'running') {
    btnStart.disabled = true;
    btnPause.disabled = false;
    btnStop.disabled = false;
    
    statusIndicator.className = 'status-indicator running';
    statusText.textContent = 'Running';
    
    urlListInput.disabled = true;
    stepDelayInput.disabled = true;
    modeBlock.disabled = true;
    modeUnblock.disabled = true;
  } else if (status === 'paused') {
    btnStart.disabled = false;
    btnStart.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>
      Resume
    `;
    btnPause.disabled = true;
    btnStop.disabled = false;
    
    statusIndicator.className = 'status-indicator paused';
    statusText.textContent = 'Paused';
    
    urlListInput.disabled = true;
    stepDelayInput.disabled = true;
    modeBlock.disabled = true;
    modeUnblock.disabled = true;
  } else { // stopped or ready
    btnStart.disabled = false;
    setMode(currentMode);
    btnPause.disabled = true;
    btnStop.disabled = true;
    
    statusIndicator.className = 'status-indicator ready';
    statusText.textContent = 'Ready';
    
    urlListInput.disabled = false;
    stepDelayInput.disabled = false;
    modeBlock.disabled = false;
    modeUnblock.disabled = false;
  }
  
  // Reactive enable/disable rule for the Reset Button
  const isRunningOrPaused = status === 'running' || status === 'paused';
  if (isRunningOrPaused) {
    btnResetTool.disabled = true;
  } else {
    // Idle or stopped state
    const hasLogs = logs && logs.length > 0;
    const hasProgress = total > 0;
    const hasQueueText = urlListInput.value.trim().length > 0;
    
    btnResetTool.disabled = !(hasLogs || hasProgress || hasQueueText);
  }
  
  // Set delay value if available
  if (stepDelay && !urlListInput.disabled) {
    stepDelayInput.value = stepDelay;
  }

  // Set URL List value if background has a list and we are running/paused
  if ((status === 'running' || status === 'paused') && urls) {
    const fullQueue = [...(activeUrl ? [activeUrl] : []), ...urls];
    urlListInput.value = fullQueue.join('\n');
    updateQueueCount();
  }

  // Progress calculations
  if (total > 0) {
    const processed = total - urls.length - (activeUrl ? 1 : 0);
    const percent = Math.round((processed / total) * 100);
    
    progressPercent.textContent = `${percent}%`;
    progressFraction.textContent = `${processed} / ${total}`;
    progressBar.style.width = `${percent}%`;
    
    statBlocked.textContent = blocked;
    statRemaining.textContent = total - processed;
  } else {
    // Reset defaults if no active queue
    progressPercent.textContent = '0%';
    progressFraction.textContent = '0 / 0';
    progressBar.style.width = '0%';
    statBlocked.textContent = '0';
    statRemaining.textContent = '0';
  }

  // Active target
  if (activeUrl) {
    const username = activeUrl.replace(/\/$/, '').split('/').pop() || activeUrl;
    activeTarget.textContent = username;
  } else {
    activeTarget.textContent = 'None';
  }

  // Synchronize logs
  if (logs && logs.length > 0) {
    logConsole.innerHTML = '';
    logs.forEach(log => {
      const entry = document.createElement('div');
      entry.className = `log-entry ${log.type}`;
      
      const timeSpan = document.createElement('span');
      timeSpan.className = 'log-entry time';
      timeSpan.textContent = log.time;
      
      const textSpan = document.createElement('span');
      textSpan.textContent = log.message;
      
      entry.appendChild(timeSpan);
      entry.appendChild(textSpan);
      logConsole.appendChild(entry);
    });
    logConsole.scrollTop = logConsole.scrollHeight;
  }
}

// Download Logs Function
function downloadLogs() {
  if (latestLogs.length === 0) {
    appendLog('No logs available to download.', 'warning');
    return;
  }
  
  const textContent = latestLogs
    .map(log => `${log.time} [${log.type.toUpperCase()}] ${log.message}`)
    .join('\r\n');
    
  const blob = new Blob([textContent], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  
  const a = document.createElement('a');
  a.href = url;
  a.download = `digitine_${currentMode}_logs_${new Date().toISOString().slice(0,10)}.txt`;
  
  document.body.appendChild(a);
  a.click();
  
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  
  appendLog('Logs downloaded successfully.', 'success');
}

// Button click handlers
btnStart.addEventListener('click', () => {
  const text = urlListInput.value.trim();
  if (!text) {
    appendLog('Error: Please enter at least one Instagram URL or username.', 'danger');
    return;
  }
  
  const rawUrls = text.split('\n').filter(line => line.trim().length > 0);
  
  // Sanitize inputs into full URLs
  const sanitizedUrls = rawUrls.map(item => {
    let clean = item.trim();
    if (!clean.startsWith('http://') && !clean.startsWith('https://')) {
      if (clean.startsWith('@')) {
        clean = clean.substring(1);
      }
      return `https://www.instagram.com/${clean}/`;
    }
    if (!clean.endsWith('/')) {
      clean += '/';
    }
    return clean;
  });

  const delay = parseInt(stepDelayInput.value, 10) || 3;
  
  appendLog(`Initializing ${currentMode} queue...`, 'info');
  
  chrome.runtime.sendMessage({
    action: 'start',
    urls: sanitizedUrls,
    stepDelay: delay,
    mode: currentMode
  }, (response) => {
    if (response && response.success) {
      appendLog('Automation started.', 'success');
      
      if (!isTab) {
        chrome.tabs.create({ url: chrome.runtime.getURL('popup.html?view=tab') });
        window.close();
      }
    }
  });
});

btnPause.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'pause' }, (response) => {
    if (response && response.success) {
      appendLog('Automation paused.', 'warning');
    }
  });
});

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'stop' }, (response) => {
    if (response && response.success) {
      appendLog('Automation stopped and reset.', 'danger');
      urlListInput.value = '';
      updateQueueCount();
    }
  });
});

// Listen for updates from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'stateUpdated' && request.state) {
    updateUI(request.state);
  }
});

// Run init
document.addEventListener('DOMContentLoaded', init);