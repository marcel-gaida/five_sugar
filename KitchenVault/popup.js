/**
 * Kitchen Vault — popup.js
 * Main application logic for the Kitchen Vault Chrome Extension.
 * Handles folder scanning, file browsing, tagging, ratings,
 * bookmarks, PDF viewing, and thumbnail generation.
 *
 * Dependencies: PDF.js (pdf.min.js + pdf.worker.min.js)
 * Storage: chrome.storage.local (metadata) + IndexedDB (thumbnails)
 */


// ============================================================
// SECTION 1: Constants & State
// ============================================================
const state = {
    directoryHandle: null,
    files: [], // Array of { handle, path, name, type, parentPath }
    folders: [], // Array of { path, name, level }
    currentPath: "",
    metadata: {
        tags: {}, // path -> []
        ratings: {}, // path -> number
        bookmarks: {} // path -> [{label, pos}]
    },
    tagLibrary: [],
    settings: {
        showExtensions: true,
        compactGrid: false,
        showThumbnails: true,
        viewMode: 'grid',
        cardSize: 160,
        theme: 'light',
        firstLoadCompleted: false,
        resolvedAbsolutePath: "",
        annotationBehavior: "only-annotated",
        showInFolderEnabled: false
    },
    searchQuery: '',
    filters: { type: 'all', rating: '0' },
    sortBy: 'name-asc',
    viewer: {
        activeFile: null,
        pdfDoc: null,
        pageNum: 1,
        zoom: 0.75,
        renderTask: null
    },
    converter: {
        selectedIngredient: null
    },
    pendingIncomingRecipe: null
};

const DEFAULT_TAG_COLORS = ["#2c5e43","#d97d36","#4e6b5c","#8ca395","#c94a47","#e8c88a","#6f4e37","#4a6b82"];
const PREDEFINED_TAGS = [
    { label: "Dessert", color: "#2c5e43", isDefault: true },
    { label: "Baking", color: "#d97d36", isDefault: true },
    { label: "Mains", color: "#4e6b5c", isDefault: true },
    { label: "Appetizers", color: "#8ca395", isDefault: true },
    { label: "Quick & Easy", color: "#c94a47", isDefault: true },
    { label: "Vegetarian", color: "#e8c88a", isDefault: true },
    { label: "Vegan", color: "#6f4e37", isDefault: true },
    { label: "Gluten-Free", color: "#4a6b82", isDefault: true },
    { label: "Holiday", color: "#2c5e43", isDefault: true },
    { label: "Beginner", color: "#d97d36", isDefault: true },
    { label: "Advanced", color: "#4e6b5c", isDefault: true },
    { label: "Favorite", color: "#8ca395", isDefault: true }
];
const ALLOWED_EXTS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif', '.html', '.htm'];

// Setup PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';
}

/** Load Storage function. */
async function loadStorage() {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (data) => {
            if (data.metadata) {
                state.metadata = data.metadata;
                if (!state.metadata.annotations) state.metadata.annotations = {};
                if (!state.metadata.bookmarks) state.metadata.bookmarks = {};
                if (!state.metadata.tags) state.metadata.tags = {};
                if (!state.metadata.ratings) state.metadata.ratings = {};
            } else {
                state.metadata = { tags: {}, ratings: {}, bookmarks: {}, annotations: {} };
            }
            if (data.settings) {
                state.settings = { ...state.settings, ...data.settings };
            }
            if (data.tagLibrary && Array.isArray(data.tagLibrary)) {
                state.tagLibrary = data.tagLibrary;
            } else {
                state.tagLibrary = PREDEFINED_TAGS.map(t => ({...t, id: crypto.randomUUID()}));
                saveTagLibrary();
            }
            resolve(data);
        });
    });
}

/** Save Metadata function. */
async function saveMetadata() {
    scheduleAutoBackup();
    return new Promise((resolve) => {
        chrome.storage.local.set({ metadata: state.metadata }, resolve);
    });
}

/** Save Tag Library function. */
async function saveTagLibrary() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ tagLibrary: state.tagLibrary }, resolve);
    });
}

/** Save Settings function. */
async function saveSettings() {
    return new Promise((resolve) => {
        chrome.storage.local.set({ settings: state.settings }, resolve);
    });
}


/** Open DB function. */

// ============================================================
// SECTION 2: Storage (chrome.storage + IndexedDB)
// ============================================================
function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open('KitchenVaultDB', 2);
      req.onupgradeneeded = e => {
          const db = e.target.result;
          if (!db.objectStoreNames.contains('handles')) db.createObjectStore('handles');
          if (!db.objectStoreNames.contains('thumbnails')) db.createObjectStore('thumbnails');
      };
      req.onsuccess = e => resolve(e.target.result);
      req.onerror = reject;
    });
}

/** Tx Complete function. */
function txComplete(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = resolve;
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

/** Save Handle function. */
async function saveHandle(handle) {
    const db = await openDB();
    const tx = db.transaction('handles', 'readwrite');
    tx.objectStore('handles').put(handle, 'rootDir');
    await txComplete(tx);
}

/** Load Handle function. */
async function loadHandle() {
    const db = await openDB();
    const tx = db.transaction('handles', 'readonly');
    const req = tx.objectStore('handles').get('rootDir');
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Get Cached Thumb function. */
async function getCachedThumb(filePath) {
    const db = await openDB();
    const tx = db.transaction('thumbnails', 'readonly');
    const req = tx.objectStore('thumbnails').get(filePath);
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

/** Cache Thumb function. */
async function cacheThumb(filePath, base64DataUrl) {
    const db = await openDB();
    const tx = db.transaction('thumbnails', 'readwrite');
    tx.objectStore('thumbnails').put(base64DataUrl, filePath);
    await txComplete(tx);
}

/** Clear Thumbnail Cache function. */
async function clearThumbnailCache() {
    const db = await openDB();
    const tx = db.transaction('thumbnails', 'readwrite');
    tx.objectStore('thumbnails').clear();
    await txComplete(tx);
}



// ============================================================
// SECTION 3: File System (scanDirectory, folder walking)
// ============================================================
/** Select Folder function. */
async function selectFolder() {
    try {
        const handle = await window.showDirectoryPicker({ mode: 'readwrite' });
        state.directoryHandle = handle;
        chrome.storage.local.set({ prevFolderName: handle.name });
        await saveHandle(handle);
        state.settings.resolvedAbsolutePath = "";
        await saveSettings();
        await scanDirectory();
    } catch (err) {
        console.error("User cancelled or error:", err);
    }
}

let scanComplete = false;

/** Scan Directory function. */
async function scanDirectory() {
    state.files = [];
    state.folders = [];
    
    async function traverse(handle, currentPath, level) {
        // Skip hidden/system folders like .kv
        if (handle.name.startsWith('.')) return;
        state.folders.push({ path: currentPath, name: handle.name, level });
        
        for await (const entry of handle.values()) {
            const entryPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
            if (entry.kind === 'file') {
                const ext = entry.name.slice((Math.max(0, entry.name.lastIndexOf(".")) || Infinity)).toLowerCase();
                if (ALLOWED_EXTS.includes(ext)) {
                    state.files.push({
                        handle: entry,
                        path: entryPath,
                        name: entry.name,
                        type: ext === '.pdf' ? 'pdf' : ((ext === '.html' || ext === '.htm') ? 'html' : 'image'),
                        parentPath: currentPath
                    });
                }
            } else if (entry.kind === 'directory') {
                // Skip hidden/system folders like .kv
                if (entry.name.startsWith('.')) continue;
                await traverse(entry, entryPath, level + 1);
            }
        }
    }

    try {
        const db = await openDB();
        const tx = db.transaction('thumbnails', 'readonly');
        const store = tx.objectStore('thumbnails');
        const countReq = store.count();
        const cachedCount = await new Promise(r => countReq.onsuccess = () => r(countReq.result));
        
        await traverse(state.directoryHandle, state.directoryHandle.name, 0);
        
        // Check if metadata is empty and attempt auto-recovery from local backup file
        const isEmpty = !state.metadata.tags || (
            Object.keys(state.metadata.tags).length === 0 &&
            Object.keys(state.metadata.ratings || {}).length === 0 &&
            Object.keys(state.metadata.bookmarks || {}).length === 0 &&
            Object.keys(state.metadata.annotations || {}).length === 0
        );

        if (isEmpty) {
            try {
                const fileHandle = await state.directoryHandle.getFileHandle('kitchenvault_backup.json', { create: false });
                const file = await fileHandle.getFile();
                const text = await file.text();
                const imported = JSON.parse(text);
                if (imported) {
                    state.metadata.tags = imported.tags || {};
                    state.metadata.ratings = imported.ratings || {};
                    state.metadata.bookmarks = imported.bookmarks || {};
                    state.metadata.annotations = imported.annotations || {};
                    await saveMetadata();
                    console.log("Automatically restored metadata from kitchenvault_backup.json!");
                }
            } catch (e) {
                // Ignore error if backup file doesn't exist
            }
        }
        
        state.currentPath = state.directoryHandle.name; // start at root
        scanComplete = true;
        
        showAppShell();
        renderApp();
        populateFolderDropdowns();
        scheduleAutoBackup();

        // Clear welcome status if visible
        const welcomeStatus = document.getElementById('welcome-status');
        if (welcomeStatus) welcomeStatus.classList.add('hidden');

        // Process pending incoming recipe if any
        if (state.pendingIncomingRecipe) {
            const pr = state.pendingIncomingRecipe;
            state.pendingIncomingRecipe = null;
            setTimeout(() => {
                handleIncomingRecipe(pr.title, pr.url, pr.html);
            }, 200);
        }

        // Show indexing prompt if first time
        if (!state.settings.firstLoadCompleted) {
            const promptEl = document.getElementById('indexing-prompt');
            const countEl = document.getElementById('prompt-file-count');
            if (promptEl) promptEl.classList.remove('hidden');
            if (countEl) countEl.textContent = 'Found ' + state.files.length + ' recipes.';
        } else if (state.settings.showThumbnails) {
            setupLazyThumbnails(state.files);
        }
    } catch (err) {
        console.error("Error scanning directory:", err);
        alert("Failed to read directory. Please try selecting it again.");
        state.directoryHandle = null;
        showWelcomeView();
    }
}



// ============================================================
// SECTION 4: UI Rendering (showAppShell, renderApp, renderSidebar, renderGrid, etc.)
// ============================================================
/** Show App Shell function. */
function showAppShell() {
    const elWelcome = document.getElementById('welcome-view');
    if (elWelcome) elWelcome.classList.add('hidden');
    const elAppShell = document.getElementById('app-shell');
    if (elAppShell) elAppShell.classList.remove('hidden');
}

/** Show Welcome View function. */
function showWelcomeView() {
    const elAppShell = document.getElementById('app-shell');
    if (elAppShell) elAppShell.classList.add('hidden');
    const elWelcome = document.getElementById('welcome-view');
    if (elWelcome) elWelcome.classList.remove('hidden');
}

/** Render App function. */
function renderApp() {
    renderSidebar();
    renderBreadcrumbs();
    renderGrid();
    applySettingsToUI();
}

/** Render Sidebar function. */
function renderSidebar() {
    const tree = document.getElementById('folder-tree');
    tree.innerHTML = '';
    
    state.folders
        .filter(folder => !folder.name.startsWith('.'))
        .forEach(folder => {
        const div = document.createElement('div');
        div.className = `folder-item ${state.currentPath === folder.path ? 'active' : ''}`;
        div.innerHTML = `
            <div class="folder-indent" style="width: ${folder.level * 16}px"></div>
            <svg class="folder-icon" viewBox="0 0 24 24"><path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/></svg>
            <span>${folder.name}</span>
        `;
        div.onclick = () => {
            state.currentPath = folder.path;
            state.searchQuery = "";
            document.getElementById('search-input').value = "";
            renderApp();
        };
        tree.appendChild(div);
    });
}

/** Render Breadcrumbs function. */
function renderBreadcrumbs() {
    const container = document.getElementById('breadcrumbs');
    container.innerHTML = '';
    
    const parts = state.currentPath ? state.currentPath.split('/') : [];
    
    let html = '';
    let currentPath = "";
    
    parts.forEach((part, index) => {
        if (!part) return;
        currentPath += currentPath ? `/${part}` : part;
        if (index > 0) {
            html += `<span class="breadcrumb-separator"> / </span>`;
        }
        html += `<span class="breadcrumb-item" data-path="${currentPath}">${part}</span>`;
    });
    
    container.innerHTML = html;
    
    container.querySelectorAll('.breadcrumb-item').forEach(item => {
        item.onclick = () => {
            state.currentPath = item.dataset.path;
            renderApp();
        };
    });
}



// ============================================================
// SECTION 9: Search & Filter & Sort
// ============================================================
/** Get Filtered Files function. */
function getFilteredFiles() {
    let files = state.files;
    
    // Apply search query (global search)
    if (state.searchQuery) {
        const q = state.searchQuery.toLowerCase().replace(/_/g, ' ');
        files = files.filter(f => {
            const cleanName = f.name.replace(/_/g, ' ').toLowerCase();
            const matchName = cleanName.includes(q);
            const cleanPath = f.parentPath.replace(/_/g, ' ').toLowerCase();
            const matchPath = cleanPath.includes(q);
            const tags = state.metadata.tags[f.path] || [];
            const matchTags = tags.some(t => t.toLowerCase().includes(q));
            return matchName || matchPath || matchTags;
        });
    } else {
        // Show everything recursively if we are at the main/root folder
        const isRoot = state.directoryHandle && (state.currentPath === state.directoryHandle.name);
        if (!isRoot) {
            // Otherwise show current folder only
            files = files.filter(f => f.parentPath === state.currentPath);
        }
    }
    
    // Apply type filter
    if (state.filters.type !== 'all') {
        files = files.filter(f => f.type === state.filters.type);
    }
    
    // Apply rating filter
    if (state.filters.rating !== '0') {
        const minRating = parseInt(state.filters.rating);
        files = files.filter(f => (state.metadata.ratings[f.path] || 0) >= minRating);
    }
    
    // Apply sort
    const sortBy = state.sortBy || 'name-asc';

    if (sortBy === 'name-asc') {
        files.sort((a, b) =>
            a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
        );
    } else if (sortBy === 'name-desc') {
        files.sort((a, b) =>
            b.name.localeCompare(a.name, undefined, { numeric: true, sensitivity: 'base' })
        );
    } else if (sortBy === 'rating-desc') {
        files.sort((a, b) =>
            (state.metadata.ratings[b.path] || 0) - (state.metadata.ratings[a.path] || 0)
        );
    } else if (sortBy === 'rating-asc') {
        files.sort((a, b) =>
            (state.metadata.ratings[a.path] || 0) - (state.metadata.ratings[b.path] || 0)
        );
    }
    
    return files;
}

/** Update Card Meta function. */
function updateCardMeta(path) {
    const safePath = path.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
    const card = document.querySelector(`.file-card[data-path="${safePath}"]`);
    if (!card) return;
    
    // Update Rating
    const rating = state.metadata.ratings[path] || 0;
    const ratingEl = card.querySelector('.card-rating');
    if (ratingEl) {
        let starsHtml = '';
        for(let i=1; i<=5; i++) {
            starsHtml += `<span class="star ${i <= rating ? 'filled' : ''}">★</span>`;
        }
        ratingEl.innerHTML = starsHtml;
        // Re-attach handlers
        ratingEl.querySelectorAll('.star').forEach((node, idx) => {
            node.onclick = (e) => {
                e.stopPropagation();
                const newRating = rating === idx + 1 ? 0 : idx + 1;
                state.metadata.ratings[path] = newRating;
                saveMetadata();
                updateCardMeta(path);
                if(state.viewer.activeFile && state.viewer.activeFile.path === path) {
                    renderViewerHeader();
                }
            };
        });
    }
    
    // Update Bookmarks & Annotations
    const bookmarks = state.metadata.bookmarks[path] || [];
    const fileAnns = state.metadata.annotations[path] || {};
    const hasAnnotations = Object.values(fileAnns).some(text => text.trim() !== "");
    const badgesEl = card.querySelector('.card-badges');
    if (badgesEl) {
        let badgesHtml = '';
        if (bookmarks.length) {
            badgesHtml += `<div class="badge badge-bookmark" title="${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''}">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
  </svg>
  ${bookmarks.length}
</div>`;
        }
        if (hasAnnotations) {
            badgesHtml += `<div class="badge badge-annotation" title="Has annotations">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</div>`;
        }
        badgesEl.innerHTML = badgesHtml;
    }
    
    // Update Tags
    const tags = state.metadata.tags[path] || [];
    const tagsEl = card.querySelector('.card-tags');
    if (tagsEl) {
        let tagsHtml = '';
        tags.forEach(t => {
            const tagInfo = state.tagLibrary.find(x => x.label === t);
            const color = tagInfo ? tagInfo.color : '#8a6e5c';
            tagsHtml += `<span class="tag-chip" style="background-color:${color};color:#fff">${t}</span>`;
        });
        tagsEl.innerHTML = tagsHtml;
    }
}

/** Render Grid function. */
function renderGrid() {
    const grid = document.getElementById('grid-container');
    const files = getFilteredFiles();
    
    const searchCountEl = document.getElementById('search-count');
    if (searchCountEl) {
        searchCountEl.classList.toggle('hidden', !state.searchQuery);
        searchCountEl.textContent = `${files.length} results`;
    }
    
    if (files.length === 0) {
        grid.innerHTML = '';
        if (scanComplete) {
            if (state.searchQuery) {
                document.getElementById('no-results-view').classList.remove('hidden');
                document.getElementById('empty-folder-view').classList.add('hidden');
            } else {
                document.getElementById('no-results-view').classList.add('hidden');
                document.getElementById('empty-folder-view').classList.remove('hidden');
            }
        }
        return;
    }
    
    document.getElementById('no-results-view').classList.add('hidden');
    document.getElementById('empty-folder-view').classList.add('hidden');
    
    grid.innerHTML = '';
    files.forEach(f => {
        const card = document.createElement('div');
        card.className = 'file-card';
        card.dataset.path = f.path;
        
        const rating = state.metadata.ratings[f.path] || 0;
        const tags = state.metadata.tags[f.path] || [];
        const bookmarks = state.metadata.bookmarks[f.path] || [];
        
        let starsHtml = '';
        for(let i=1; i<=5; i++) {
            starsHtml += `<span class="star ${i <= rating ? 'filled' : ''}">★</span>`;
        }
        
        let tagsHtml = tags.map(t => {
            const libTag = state.tagLibrary.find(lt => lt.label === t);
            const color = libTag ? libTag.color : '#8a6e5c';
            return `<span class="tag-chip" style="background-color: ${color}; color: #fff">${t}</span>`;
        }).join('');
        
        let displayName = state.settings.showExtensions ? f.name : f.name.replace(/\.[^/.]+$/, "");
        if (!displayName || displayName.trim() === '') {
            displayName = f.handle.name;
        }
        displayName = displayName.replace(/_/g, ' ');

        const hlName = highlightText(displayName, state.searchQuery);
        
        let iconEmoji = '📄';
        if (f.type === 'html') iconEmoji = '🌐';
        else if (f.type === 'image') iconEmoji = '🖼️';
        const placeholderSvg = `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23e8eee5'/%3E%3Ctext x='50' y='55' font-size='30' text-anchor='middle' fill='%234e6b5c'%3E${encodeURIComponent(iconEmoji)}%3C/text%3E%3C/svg%3E`;
        
        const fileAnns = state.metadata.annotations[f.path] || {};
        const hasAnnotations = Object.values(fileAnns).some(text => text.trim() !== "");

        card.innerHTML = `
            <img class="card-thumb" data-path="${f.path}" src="${placeholderSvg}">
            <div class="card-footer">
                <div class="card-name" title="${displayName}">${hlName}</div>
                <div class="card-meta">
                    <div class="star-rating card-rating">${starsHtml}</div>
                    <div class="card-badges" style="display:flex; gap:4px; align-items:center;">
                        ${bookmarks.length ? `<div class="badge badge-bookmark" title="${bookmarks.length} bookmark${bookmarks.length !== 1 ? 's' : ''}">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
  </svg>
  ${bookmarks.length}
</div>` : ''}
                        ${hasAnnotations ? `<div class="badge badge-annotation" title="Has annotations">
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
</div>` : ''}
                    </div>
                </div>
                <div class="card-tags">${tagsHtml}</div>
            </div>
        `;
        
        card.classList.remove('skeleton');
        card.classList.add('loaded');
        
        card.onclick = (e) => {
            if(!e.target.closest('.card-rating')) {
                openViewer(f);
            }
        };
        
        // Rating handler
        const starNodes = card.querySelectorAll('.card-rating .star');
        starNodes.forEach((node, idx) => {
            node.onclick = (e) => {
                e.stopPropagation();
                const newRating = rating === idx + 1 ? 0 : idx + 1; // toggle
                state.metadata.ratings[f.path] = newRating;
                saveMetadata();
                updateCardMeta(f.path);
                if(state.viewer.activeFile && state.viewer.activeFile.path === f.path) {
                    renderViewerHeader();
                }
            };
        });
        
        grid.appendChild(card);
    });
    
    if (scanComplete) {
        setupLazyThumbnails(files);
    }
}

/** Highlight Text function. */
function highlightText(text, query) {
    if (!query) return text;
    const cleanQuery = query.replace(/_/g, ' ');
    const regex = new RegExp(`(${cleanQuery.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
    return text.replace(regex, '<mark>$1</mark>');
}

/** Get Tag Color function. */
function getTagColor(tag) {
    let hash = 0;
    for (let i = 0; i < tag.length; i++) {
        hash = tag.charCodeAt(i) + ((hash << 5) - hash);
    }
    return TAG_COLORS[Math.abs(hash) % TAG_COLORS.length];
}


// ============================================================
// SECTION 3B: Web Clipper & URL Saving
// ============================================================
async function verifyWritePermission(handle) {
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') {
        return true;
    }
    if ((await handle.requestPermission(opts)) === 'granted') {
        return true;
    }
    return false;
}

async function reconnectFolder() {
    try {
        const savedHandle = await loadHandle();
        if (savedHandle) {
            const permission = await savedHandle.requestPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                state.directoryHandle = savedHandle;
                await scanDirectory();
                return;
            }
        }
    } catch (e) {
        console.error("Folder reconnection failed:", e);
    }
    selectFolder();
}

async function getFolderHandle(rootHandle, path) {
    if (!path || path === rootHandle.name) return rootHandle;
    const parts = path.split('/');
    let currentHandle = rootHandle;
    for (let i = 1; i < parts.length; i++) {
        currentHandle = await currentHandle.getDirectoryHandle(parts[i], { create: false });
    }
    return currentHandle;
}

function makeUrlsAbsolute(htmlText, baseUrl) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(htmlText, 'text/html');
    
    // Clean up script tags for offline execution
    doc.querySelectorAll('script').forEach(script => {
        // 1. Remove all <script> tags with data-cfasync="false"
        if (script.getAttribute('data-cfasync') === 'false') {
            script.remove();
            return;
        }

        const src = script.getAttribute('src') || "";
        const content = script.textContent || "";

        // 2. Remove any <script> tag whose content or src contains forbidden ad/tracking patterns
        const forbiddenPatterns = [
            'html-load.com', 'html-load.cc', 'adthrive', 'raptive', 
            'slickstream', 'optable.co', 'disqus', 'doubleclick', 
            'googlesyndication', 'amazon-adsystem', 'moatads', 
            'criteo', 'pubmatic', 'rubiconproject'
        ];
        const matchesPattern = forbiddenPatterns.some(pat => 
            src.toLowerCase().includes(pat) || content.toLowerCase().includes(pat)
        );
        if (matchesPattern) {
            script.remove();
            return;
        }

        // 3. Remove any <script> tag whose inline content contains WebSocket
        if (content.includes('WebSocket')) {
            script.remove();
            return;
        }

        // 4. Remove any <script> tag whose inline content contains obfuscated patterns
        // Heuristic: inline content has more than 3 occurrences of 0x hex literals,
        // or is longer than 500 chars and has high frequency of hex escapes
        const hexLiterals = (content.match(/0x[0-9a-fA-F]+/gi) || []).length;
        if (hexLiterals > 3) {
            script.remove();
            return;
        }
        if (content.length > 500) {
            const hexEscapes = (content.match(/\\x[0-9a-fA-F]{2}/g) || []).length;
            if (hexEscapes > 10) {
                script.remove();
                return;
            }
        }

        // 5. Remove all <script> tags that load external JS files via src=
        if (script.hasAttribute('src')) {
            script.remove();
            return;
        }
        
        // Remove the inline script block that contains class RocketLazyLoadScripts
        if (content.includes('RocketLazyLoadScripts')) {
            script.remove();
            return;
        }

        // Remove the IE redirect inline script that checks for MSIE/Internet Explorer and ?nowprocket=1
        if ((content.includes('MSIE') || content.includes('Internet Explorer')) && content.includes('nowprocket')) {
            script.remove();
            return;
        }

        // Patch WPRecipeMaker config to prevent absolute URL navigation offline
        if (script.id === 'wprm-public-js-extra' || (script.textContent || '').includes('jump_output_hash')) {
            script.textContent = (script.textContent || '').replace('"jump_output_hash":true', '"jump_output_hash":false');
        }

        // Replace all data-rocket-status="executed" attributes with data-rocket-status="stripped" on inline script tags
        if (script.getAttribute('data-rocket-status') === 'executed') {
            script.setAttribute('data-rocket-status', 'stripped');
        }

        // Convert any type="text/rocketlazyloadscript" script tags to type="text/plain"
        if (script.getAttribute('type') === 'text/rocketlazyloadscript') {
            script.setAttribute('type', 'text/plain');
        }
    });

    // Remove all <iframe> tags as they are not needed for offline recipe viewing
    doc.querySelectorAll('iframe').forEach(iframe => {
        iframe.remove();
    });

    // Remove broken rocketonclick onclick attributes left behind by WP Rocket on anchor elements
    doc.querySelectorAll('[onclick="this.rocketonclick(event)"]').forEach(el => {
        el.removeAttribute('onclick');
    });

    // Move id="recipe" onto the actual recipe container div
    const recipeAnchor = doc.getElementById('recipe');
    if (recipeAnchor && recipeAnchor.children.length === 0) {
        // It's an empty placeholder - find the next wprm-recipe-container sibling
        let next = recipeAnchor.nextElementSibling;
        while (next) {
            if (next.classList.contains('wprm-recipe-container') || 
                next.querySelector('.wprm-recipe-container')) {
                next.id = 'recipe';
                recipeAnchor.removeAttribute('id');
                break;
            }
            next = next.nextElementSibling;
        }
    }

    // Remove extension-injected overlay layers that block selection and clicks
    doc.querySelectorAll('#kitchenvault-modal-container, #panel-overlay, #viewer-panel, .modal-overlay, .overlay, [style*="z-index: 999999"], [style*="position: fixed"][style*="inset: 0"], [style*="position:fixed"][style*="inset:0"]').forEach(el => {
        el.remove();
    });

    // Remove any fixed full-screen containers that are likely extension UI remnants
    doc.querySelectorAll('div').forEach(el => {
        const style = (el.getAttribute('style') || '').replace(/\s+/g, ' ').toLowerCase();
        if (
            style.includes('position: fixed') &&
            (style.includes('inset: 0') || style.includes('top: 0') || style.includes('left: 0')) &&
            (style.includes('z-index: 999999') || style.includes('z-index:999999'))
        ) {
            el.remove();
        }
    });

    // Resolve absolute URLs for resources like image src, script src, etc.
    doc.querySelectorAll('[src]').forEach(el => {
        try {
            const src = el.getAttribute('src');
            if (src) el.setAttribute('src', new URL(src, baseUrl).href);
        } catch(e) {}
    });

    // Resolve absolute URLs for link elements (e.g., stylesheets, icons)
    doc.querySelectorAll('link[href]').forEach(el => {
        try {
            const href = el.getAttribute('href');
            if (href) el.setAttribute('href', new URL(href, baseUrl).href);
        } catch(e) {}
    });

    // Resolve relative URLs inside meta image tags
    doc.querySelectorAll('meta[property="og:image"], meta[name="twitter:image"]').forEach(meta => {
        try {
            const content = meta.getAttribute('content');
            if (content) meta.setAttribute('content', new URL(content, baseUrl).href);
        } catch(e) {}
    });

    // Process all anchor elements
    doc.querySelectorAll('a').forEach(a => {
        try {
            const href = a.getAttribute('href');
            if (href) {
                const cleanHref = href.trim();
                let isLocalHash = false;
                let targetHash = "";

                if (cleanHref.startsWith('#')) {
                    isLocalHash = true;
                    targetHash = cleanHref;
                } else {
                    try {
                        const urlObj = new URL(cleanHref, baseUrl);
                        const baseObj = new URL(baseUrl);
                        
                        const host1 = urlObj.hostname.toLowerCase().replace(/^www\./, '');
                        const host2 = baseObj.hostname.toLowerCase().replace(/^www\./, '');
                        
                        const normPath1 = urlObj.pathname.toLowerCase().replace(/\/+$/, '');
                        const normPath2 = baseObj.pathname.toLowerCase().replace(/\/+$/, '');
                        
                        if (host1 === host2 && normPath1 === normPath2) {
                            if (urlObj.hash) {
                                isLocalHash = true;
                                targetHash = urlObj.hash;
                            }
                        }
                    } catch(e) {}
                }

                if (isLocalHash) {
                    // Keep the local anchor jump target
                    a.setAttribute('href', targetHash);
                } else {
                    // Remove the link (inert span) to prevent broken offline frame navigation
                    const span = doc.createElement('span');
                    span.className = a.className;
                    if (a.getAttribute('style')) span.setAttribute('style', a.getAttribute('style'));
                    span.style.textDecoration = 'none';
                    span.style.color = 'inherit';
                    span.style.cursor = 'default';
                    while (a.firstChild) {
                        span.appendChild(a.firstChild);
                    }
                    a.parentNode.replaceChild(span, a);
                }
            }
        } catch(e) {}
    });

    // Inject source metadata in head
    if (doc.head) {
        let metaUrl = doc.querySelector('meta[name="recipe-source-url"]');
        if (!metaUrl) {
            metaUrl = doc.createElement('meta');
            metaUrl.setAttribute('name', 'recipe-source-url');
            doc.head.appendChild(metaUrl);
        }
        metaUrl.setAttribute('content', baseUrl);

        let metaDate = doc.querySelector('meta[name="recipe-saved-date"]');
        if (!metaDate) {
            metaDate = doc.createElement('meta');
            metaDate.setAttribute('name', 'recipe-saved-date');
            doc.head.appendChild(metaDate);
        }
        metaDate.setAttribute('content', new Date().toLocaleDateString());
    }
    
    return doc.documentElement.outerHTML;
}

function populateFolderDropdowns() {
    const folderSelect = document.getElementById('recipe-folder-select');
    const defaultSelect = document.getElementById('setting-default-folder');
    if (!folderSelect || !defaultSelect) return;
    
    folderSelect.innerHTML = `<option value="">Root Folder</option>`;
    defaultSelect.innerHTML = `<option value="">Root Folder</option>`;
    
    state.folders.forEach(folder => {
        const indentStr = "  ".repeat(folder.level);
        const displayName = indentStr + folder.name;
        
        const opt1 = document.createElement('option');
        opt1.value = folder.path;
        opt1.textContent = displayName;
        folderSelect.appendChild(opt1);
        
        const opt2 = document.createElement('option');
        opt2.value = folder.path;
        opt2.textContent = displayName;
        defaultSelect.appendChild(opt2);
    });
    
    if (state.settings.defaultWebRecipePath) {
        defaultSelect.value = state.settings.defaultWebRecipePath;
        folderSelect.value = state.settings.defaultWebRecipePath;
    }
}

async function saveWebRecipe() {
    const urlInput = document.getElementById('recipe-url-input');
    const titleInput = document.getElementById('recipe-title-input');
    const folderSelect = document.getElementById('recipe-folder-select');
    const statusMsg = document.getElementById('add-url-status');
    
    if (!urlInput || !titleInput || !folderSelect || !statusMsg) return;
    
    const url = urlInput.value.trim();
    let title = titleInput.value.trim();
    const folderPath = folderSelect.value;
    
    if (!url) {
        showStatus("Please enter a valid URL.", "error");
        return;
    }
    
    if (!title) {
        showStatus("Please enter a recipe name.", "error");
        return;
    }
    
    showStatus("Fetching webpage...", "info");
    
    try {
        if (!state.directoryHandle) {
            showStatus("No folder selected. Please choose a folder first.", "error");
            return;
        }
        
        const hasPermission = await verifyWritePermission(state.directoryHandle);
        if (!hasPermission) {
            showStatus("Write permission was denied.", "error");
            return;
        }
        
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const rawHtml = await response.text();
        
        const absoluteHtml = makeUrlsAbsolute(rawHtml, url);
        const targetFolderHandle = await getFolderHandle(state.directoryHandle, folderPath);
        
        let filename = title.replace(/[/\\?%*:|"<>. ]/g, "_") + ".html";
        const fileHandle = await targetFolderHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(absoluteHtml);
        await writable.close();
        
        showStatus("Recipe saved successfully!", "success");
        
        urlInput.value = "";
        titleInput.value = "";
        
        await scanDirectory();
        
        setTimeout(() => {
            const relativeFilePath = folderPath ? `${folderPath}/${filename}` : `${state.directoryHandle.name}/${filename}`;
            const fileObj = state.files.find(f => f.path === relativeFilePath);
            if (fileObj) {
                openViewer(fileObj);
            }
            closeAddUrlPanel();
        }, 800);
        
    } catch (err) {
        console.error("Failed to save web recipe:", err);
        showStatus("Failed: " + err.message, "error");
    }
}

function showStatus(message, type) {
    const el = document.getElementById('add-url-status');
    if (!el) return;
    el.textContent = message;
    el.className = `status-message ${type}`;
    el.classList.remove('hidden');
}

function closeAddUrlPanel() {
    const ov = document.getElementById('panel-overlay');
    if (ov) { ov.classList.remove('visible'); ov.classList.add('hidden'); }
    document.getElementById('add-url-panel').classList.remove('open');
    const el = document.getElementById('add-url-status');
    if (el) el.classList.add('hidden');
}

/** Handle Incoming Recipe function from context menu. */
async function handleIncomingRecipe(title, url, html) {
    try {
        if (!state.directoryHandle) {
            state.pendingIncomingRecipe = { title, url, html };
            
            const welcomeStatus = document.getElementById('welcome-status');
            if (welcomeStatus) {
                welcomeStatus.textContent = `🍳 Recipe "${title}" is queued. Please select or reconnect your recipe folder to save it.`;
                welcomeStatus.classList.remove('hidden');
            }
            return;
        }
        
        const hasPermission = await verifyWritePermission(state.directoryHandle);
        if (!hasPermission) {
            state.pendingIncomingRecipe = { title, url, html };
            
            const welcomeStatus = document.getElementById('welcome-status');
            if (welcomeStatus) {
                welcomeStatus.textContent = `🍳 Recipe "${title}" is queued. Please select or reconnect your recipe folder to save it.`;
                welcomeStatus.classList.remove('hidden');
            }
            showWelcomeView();
            return;
        }
        
        const folderPath = state.settings.defaultWebRecipePath || "";
        const absoluteHtml = makeUrlsAbsolute(html, url);
        const targetFolderHandle = await getFolderHandle(state.directoryHandle, folderPath);
        
        let filename = title.replace(/[/\\?%*:|"<>. ]/g, "_") + ".html";
        const fileHandle = await targetFolderHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(absoluteHtml);
        await writable.close();
        
        // Scan directory to index the new recipe
        await scanDirectory();
        
        // Open the imported recipe in the viewer
        setTimeout(() => {
            const relativeFilePath = folderPath ? `${folderPath}/${filename}` : `${state.directoryHandle.name}/${filename}`;
            const fileObj = state.files.find(f => f.path === relativeFilePath);
            if (fileObj) {
                openViewer(fileObj);
            }
        }, 800);
        
    } catch (err) {
        console.error("Failed to save incoming recipe:", err);
        alert("Failed to save recipe: " + err.message);
    }
}


// --- 4. THUMBNAILS (Queue and Cache) ---
let thumbnailQueue = [];
let isProcessingThumbnails = false;
let indexingCancelled = false;
let totalThumbsToProcess = 0;
let processedThumbsCount = 0;



// ============================================================
// SECTION 5: Thumbnails (queue, cache, IndexedDB)
// ============================================================
/** Setup Lazy Thumbnails function. */
function setupLazyThumbnails(files) {
    if (!state.settings.showThumbnails) return;
    checkUncachedAndQueue(files);
}

/** Check Uncached And Queue function. */
async function checkUncachedAndQueue(files) {
    const db = await openDB();
    const tx = db.transaction('thumbnails', 'readonly');
    const store = tx.objectStore('thumbnails');
    
    let uncached = [];
    for (let f of files) {
        const req = store.get(f.path);
        const res = await new Promise(r => req.onsuccess = () => r(req.result));
        if (!res) uncached.push(f.path);
        else {
            // Apply cached thumbnail to grid if already present
            const img = document.querySelector(`.card-thumb[data-path="${f.path.replace(/"/g, '\\"')}"]`);
            if (img) img.src = res;
        }
    }
    
    if (uncached.length > 0) {
        thumbnailQueue = uncached;
        totalThumbsToProcess = uncached.length;
        processedThumbsCount = 0;
        
        document.getElementById('indexing-banner').classList.remove('hidden');
        document.getElementById('indexing-banner-text').textContent = `Indexing thumbnails... 0 / ${totalThumbsToProcess}`;
        document.getElementById('indexing-progress-fill').style.width = '0%';
        document.getElementById('btn-indexing-stop').classList.remove('hidden');
        document.getElementById('btn-indexing-resume').classList.add('hidden');
        document.getElementById('btn-indexing-dismiss').classList.add('hidden');
        
        if (!isProcessingThumbnails) {
            processQueue();
        }
    } else {
        document.getElementById('indexing-banner').classList.add('hidden');
    }
}

/** Update Progress UI function. */
function updateProgressUI() {
    const p = Math.round((processedThumbsCount / Math.max(1, totalThumbsToProcess)) * 100) || 0;
    document.getElementById('indexing-progress-fill').style.width = p + '%';
    
    if (indexingCancelled) {
        document.getElementById('indexing-banner-text').textContent = `Indexing paused at ${processedThumbsCount} / ${totalThumbsToProcess}`;
    } else {
        document.getElementById('indexing-banner-text').textContent = `Indexing thumbnails... ${processedThumbsCount} / ${totalThumbsToProcess}`;
        if (processedThumbsCount >= totalThumbsToProcess) {
             document.getElementById('indexing-banner-text').textContent = `Indexing complete!`;
             setTimeout(() => {
                 document.getElementById('indexing-banner').classList.add('hidden');
             }, 2000);
        }
    }
}

/** Process Queue function. */
async function processQueue() {
    if (isProcessingThumbnails) return;
    isProcessingThumbnails = true;
    indexingCancelled = false;
    
    while (thumbnailQueue.length > 0) {
        if (indexingCancelled) {
            isProcessingThumbnails = false;
            updateProgressUI();
            document.getElementById('btn-indexing-stop').classList.add('hidden');
            document.getElementById('btn-indexing-resume').classList.remove('hidden');
            document.getElementById('btn-indexing-dismiss').classList.remove('hidden');
            return;
        }
        
        const path = thumbnailQueue.shift();
        
        await generateAndCacheThumb(path);
        
        processedThumbsCount++;
        updateProgressUI();
        
        // Yield to UI thread after EVERY single file
        await new Promise(r => setTimeout(r, 0));
    }
    
    isProcessingThumbnails = false;
}

/** Generate And Cache Thumb function. */
async function generateAndCacheThumb(path) {
    try {
        const cached = await getCachedThumb(path);
        if (cached) {
            const imgEl = document.querySelector(`.card-thumb[data-path="${path.replace(/"/g, '\\"')}"]`);
            if (imgEl) imgEl.src = cached;
            return cached;
        }

        const fileObj = state.files.find(f => f.path === path);
        if (!fileObj) return null;

        const file = await fileObj.handle.getFile();
        const canvas = document.createElement('canvas');

        if (fileObj.type === 'image') {
            const img = new Image();
            img.src = URL.createObjectURL(file);
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
            });
            const maxW = 200;
            const scale = Math.min(1, maxW / img.width);
            canvas.width = img.width * scale;
            canvas.height = img.height * scale;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
            URL.revokeObjectURL(img.src);
        } else if (fileObj.type === 'pdf') {
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(arrayBuffer)});
            const pdf = await loadingTask.promise;
            const page = await pdf.getPage(1);
            
            const viewport = page.getViewport({ scale: 0.4 });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            const renderContext = {
                canvasContext: canvas.getContext('2d'),
                viewport: viewport
            };
            await page.render(renderContext).promise;
        } else if (fileObj.type === 'html') {
            // Web Recipe HTML thumbnail extraction
            const arrayBuffer = await file.arrayBuffer();
            const decoder = new TextDecoder('utf-8');
            const htmlText = decoder.decode(arrayBuffer);
            
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlText, 'text/html');
            
            let imgUrl = "";
            
            // 1. Try Open Graph image
            const ogImg = doc.querySelector('meta[property="og:image"]');
            if (ogImg) imgUrl = ogImg.getAttribute('content');
            
            // 2. Try Twitter image
            if (!imgUrl) {
                const twitterImg = doc.querySelector('meta[name="twitter:image"]');
                if (twitterImg) imgUrl = twitterImg.getAttribute('content');
            }
            
            // 3. Try first body image that isn't ad/icon/logo/pixel
            if (!imgUrl) {
                const imgs = doc.querySelectorAll('body img');
                for (const tempImg of imgs) {
                    const src = tempImg.getAttribute('src');
                    if (src && !src.startsWith('data:') && !src.includes('pixel') && !src.includes('ad') && !src.includes('logo') && !src.includes('icon')) {
                        imgUrl = src;
                        break;
                    }
                }
            }
            
            // 4. Try first raw image anywhere
            if (!imgUrl) {
                const firstImg = doc.querySelector('img');
                if (firstImg) imgUrl = firstImg.getAttribute('src');
            }
            
            if (imgUrl) {
                const imgRes = await fetch(imgUrl);
                if (imgRes.ok) {
                    const imgBlob = await imgRes.blob();
                    const img = new Image();
                    img.src = URL.createObjectURL(imgBlob);
                    await new Promise((resolve, reject) => {
                        img.onload = resolve;
                        img.onerror = reject;
                    });
                    
                    const maxW = 200;
                    const scale = Math.min(1, maxW / img.width);
                    canvas.width = img.width * scale;
                    canvas.height = img.height * scale;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                    URL.revokeObjectURL(img.src);
                } else {
                    return null; // Fail to fetch, show placeholder
                }
            } else {
                return null; // No image candidate, show placeholder
            }
        } else {
            return null;
        }

        const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
        await cacheThumb(path, dataUrl);
        
        const imgEl = document.querySelector(`.card-thumb[data-path="${path.replace(/"/g, '\\"')}"]`);
        if (imgEl) imgEl.src = dataUrl;
        
        return dataUrl;
    } catch (e) {
        console.error("Error generating thumbnail for", path, e);
        return null;
    }
}

// --- 5. VIEWER ---
function setZoom(delta) {
    if (delta === 0) {
        state.viewer.zoom = 0.75;
    } else {
        state.viewer.zoom = Math.max(0.25, Math.min(4, state.viewer.zoom + delta));
    }
    
    if (state.viewer.activeFile && state.viewer.activeFile.type === 'pdf') {
        renderPdfPage();
    } else if (state.viewer.activeFile && state.viewer.activeFile.type === 'html') {
        const iframe = document.getElementById('html-view');
        if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
            try {
                iframe.contentDocument.body.style.zoom = state.viewer.zoom;
            } catch(e) {}
        }
    } else {
        const img = document.getElementById('image-view');
        if (img) {
            const panelWidth = document.getElementById('viewer-canvas-container').clientWidth - 32;
            img.style.width = (panelWidth * state.viewer.zoom) + 'px';
        }
    }
    
    const resetBtn = document.getElementById('btn-zoom-reset');
    if (resetBtn) resetBtn.textContent = Math.round(state.viewer.zoom * 100) + '%';
}


// ============================================================
// SECTION 5B: Cooking Timer & Screen Wake Lock
// ============================================================
state.timer = {
    intervalId: null,
    timeLeft: 0,
    isRunning: false,
    duration: 0
};

function playAlarmSound() {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        
        function chime(delay, frequency, duration) {
            setTimeout(() => {
                const osc = audioCtx.createOscillator();
                const gain = audioCtx.createGain();
                osc.type = 'sine';
                osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);
                gain.gain.setValueAtTime(0.4, audioCtx.currentTime);
                gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration);
                osc.connect(gain);
                gain.connect(audioCtx.destination);
                osc.start();
                osc.stop(audioCtx.currentTime + duration);
            }, delay);
        }
        
        // Play pleasant chord chimes
        chime(0, 523.25, 0.8);   // C5
        chime(250, 659.25, 0.8); // E5
        chime(500, 783.99, 1.2); // G5
    } catch(e) {
        console.error("Failed to play synthesized alarm:", e);
    }
}

function formatTime(totalSeconds) {
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

function updateTimerUI() {
    const timeStr = formatTime(state.timer.timeLeft);
    
    // Update displays
    const viewerDisplay = document.getElementById('viewer-timer-display');
    if (viewerDisplay) viewerDisplay.textContent = timeStr;
    
    const sidebarDisplay = document.getElementById('sidebar-timer-display');
    if (sidebarDisplay) sidebarDisplay.textContent = timeStr;
    
    const isViewerOpen = document.getElementById('viewer-panel').classList.contains('open');
    const hasTimer = state.timer.timeLeft > 0;
    const isRunning = state.timer.isRunning;
    
    // Show/hide timer boxes
    const viewerTimerContainer = document.getElementById('viewer-timer-container');
    if (viewerTimerContainer) {
        viewerTimerContainer.classList.toggle('hidden', !isViewerOpen);
    }
    
    const sidebarTimerContainer = document.getElementById('sidebar-timer-container');
    if (sidebarTimerContainer) {
        sidebarTimerContainer.classList.toggle('hidden', isViewerOpen || !hasTimer);
    }
    
    // Toggle start/pause button text
    const startBtn = document.getElementById('btn-timer-start');
    if (startBtn) {
        startBtn.textContent = isRunning ? "Pause" : "Start";
        startBtn.className = isRunning ? "btn btn-secondary" : "btn btn-primary";
    }
    
    const sidebarPauseBtn = document.getElementById('btn-sidebar-timer-pause');
    if (sidebarPauseBtn) {
        sidebarPauseBtn.textContent = isRunning ? "⏸️" : "▶️";
    }
}

function startTimer() {
    if (state.timer.isRunning) {
        pauseTimer();
        return;
    }
    
    if (state.timer.timeLeft <= 0) {
        // Read from inputs
        const minVal = parseInt(document.getElementById('timer-min-input').value) || 0;
        const secVal = parseInt(document.getElementById('timer-sec-input').value) || 0;
        state.timer.timeLeft = minVal * 60 + secVal;
        state.timer.duration = state.timer.timeLeft;
    }
    
    if (state.timer.timeLeft <= 0) return;
    
    state.timer.isRunning = true;
    updateTimerUI();
    
    if (state.timer.intervalId) clearInterval(state.timer.intervalId);
    state.timer.intervalId = setInterval(() => {
        if (state.timer.timeLeft > 0) {
            state.timer.timeLeft--;
            updateTimerUI();
        } else {
            clearInterval(state.timer.intervalId);
            state.timer.intervalId = null;
            state.timer.isRunning = false;
            playAlarmSound();
            alert("Timer finished!");
            resetTimer();
        }
    }, 1000);
}

function pauseTimer() {
    state.timer.isRunning = false;
    if (state.timer.intervalId) {
        clearInterval(state.timer.intervalId);
        state.timer.intervalId = null;
    }
    updateTimerUI();
}

function resetTimer() {
    pauseTimer();
    state.timer.timeLeft = 0;
    state.timer.duration = 0;
    document.getElementById('timer-min-input').value = 10;
    document.getElementById('timer-sec-input').value = 0;
    updateTimerUI();
}

function applyKeepAwake() {
    if (state.settings.keepAwake) {
        if (chrome.power) {
            chrome.power.requestKeepAwake('display');
        }
    } else {
        if (chrome.power) {
            chrome.power.releaseKeepAwake();
        }
    }
}


// ============================================================
// SECTION 6: File Viewer (openViewer, renderPdfPage, closeViewer)
// ============================================================
/** Open Viewer function. */
async function openViewer(fileObj) {
    state.viewer.activeFile = fileObj;
    state.viewer.zoom = 0.75;
    
    if (typeof resetConverterPanel === 'function') {
        resetConverterPanel();
    }
    if (typeof resetAltitudePanel === 'function') {
        resetAltitudePanel();
    }
    
    const resetBtn = document.getElementById('btn-zoom-reset');
    if (resetBtn) resetBtn.textContent = '75%';
    
    const sourceBanner = document.getElementById('source-banner');
    if (sourceBanner) {
        sourceBanner.classList.add('hidden');
        sourceBanner.innerHTML = '';
    }
    
    renderViewerHeader();
    renderViewerTags();
    renderBookmarks();
    
    document.getElementById('pdf-controls').classList.add('hidden');
    document.getElementById('viewer-control-divider').classList.add('hidden');
    document.getElementById('pdf-canvas').classList.add('hidden');
    document.getElementById('image-view').classList.add('hidden');
    document.getElementById('html-view').classList.add('hidden');
    
    const overlay = document.getElementById('panel-overlay');
    if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('visible'); }
    document.getElementById('viewer-panel').classList.add('open');
    
    try {
        const file = await fileObj.handle.getFile();
        if (fileObj.type === 'pdf') {
            document.getElementById('pdf-controls').classList.remove('hidden');
            document.getElementById('viewer-control-divider').classList.remove('hidden');
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(arrayBuffer)});
            state.viewer.pdfDoc = await loadingTask.promise;
            document.getElementById('page-count').textContent = state.viewer.pdfDoc.numPages;
            state.viewer.pageNum = 1;
            document.getElementById('page-num-input').max = state.viewer.pdfDoc.numPages;
            document.getElementById('page-num-input').value = 1;
            await renderPdfPage();
        } else if (fileObj.type === 'html') {
            const iframe = document.getElementById('html-view');
            
            iframe.onload = () => {
                try {
                    const iframeDoc = iframe.contentDocument;
                    if (iframeDoc && iframeDoc.body) {
                        iframeDoc.body.style.zoom = state.viewer.zoom;
                        
                        // Remove any legacy inline banners from the iframe document body
                        const legacyBanner = iframeDoc.getElementById('kv-saved-source-banner');
                        if (legacyBanner) {
                            legacyBanner.remove();
                        }
                        
                        iframeDoc.querySelectorAll('div').forEach(div => {
                            if (div.style.cssText.includes('background:#2c5e43') || 
                                div.style.cssText.includes('background: rgb(44, 94, 67)') ||
                                div.textContent.includes('Saved from:')) {
                                div.remove();
                            }
                        });
                        
                        // Set up a MutationObserver inside the iframe to continuously clean up any legacy banners
                        const cleaner = new MutationObserver(() => {
                            cleaner.disconnect();
                            const b = iframeDoc.getElementById('kv-saved-source-banner');
                            if (b) b.remove();
                            iframeDoc.querySelectorAll('div').forEach(div => {
                                if (div.style.cssText.includes('background:#2c5e43') || 
                                    div.style.cssText.includes('background: rgb(44, 94, 67)') ||
                                    div.textContent.includes('Saved from:')) {
                                    div.remove();
                                }
                            });
                            cleaner.observe(iframeDoc.body, { childList: true, subtree: true });
                        });
                        cleaner.observe(iframeDoc.body, { childList: true, subtree: true });

                        // Intercept local anchor jumps to ensure they always scroll properly
                        iframeDoc.addEventListener('click', (event) => {
                            const anchor = event.target.closest('a');
                            if (anchor) {
                                const href = anchor.getAttribute('href');
                                if (href && href.startsWith('#')) {
                                    const targetId = href.substring(1);
                                    const targetEl = iframeDoc.getElementById(targetId) || iframeDoc.querySelector(`[name="${CSS.escape(targetId)}"]`);
                                    if (targetEl) {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                    }
                                }
                            }
                        }, true);
                    }
                } catch(e) {
                    console.error("Iframe onload banner/zoom/scroll error:", e);
                }
            };

            iframe.src = URL.createObjectURL(file);
            iframe.classList.remove('hidden');
            
            try {
                const fileText = await file.text();
                
                // Parse using DOMParser to search for meta tags
                const parser = new DOMParser();
                const doc = parser.parseFromString(fileText, 'text/html');
                
                let baseUrl = "";
                let savedDate = "";
                
                const metaUrl = doc.querySelector('meta[name="recipe-source-url"]');
                const metaDate = doc.querySelector('meta[name="recipe-saved-date"]');
                
                if (metaUrl) {
                    baseUrl = metaUrl.getAttribute('content');
                }
                if (metaDate) {
                    savedDate = metaDate.getAttribute('content');
                }
                
                // Fallback to regex if meta tags not present (e.g. for legacy files)
                if (!baseUrl) {
                    const savedFromMatch = fileText.match(/Saved from:\s*<a\s+[^>]*href="([^"]+)"/i);
                    if (savedFromMatch) {
                        baseUrl = savedFromMatch[1];
                    } else {
                        const fallbackMatch = fileText.match(/class="kv-source-link"[^>]*href="([^"]+)"/i) || fileText.match(/href="([^"]+)"[^>]*class="kv-source-link"/i);
                        if (fallbackMatch) {
                            baseUrl = fallbackMatch[1];
                        }
                    }
                }
                
                if (!savedDate) {
                    const dateMatch = fileText.match(/Saved from:\s*<a\s+[^>]*href="[^"]+"[^>]*>[^<]+<\/a>\s*on\s*([^\s<]+)/i);
                    if (dateMatch) {
                        savedDate = dateMatch[1];
                    } else {
                        savedDate = new Date().toLocaleDateString();
                    }
                }
                
                if (baseUrl) {
                    const bannerEl = document.getElementById('source-banner');
                    if (bannerEl) {
                        bannerEl.innerHTML = `
                            <span style="font-weight:500; color:white !important;">
                                Saved from: <a href="#" class="kv-source-link"
                                style="color:#e8c88a !important; text-decoration:underline !important;">${baseUrl}</a>
                                on ${savedDate}
                            </span>
                            <button class="kv-source-btn">
                                <svg viewBox="0 0 24 24" width="13" height="13"
                                     stroke="currentColor" stroke-width="2" fill="none"
                                     stroke-linecap="round" stroke-linejoin="round"
                                     style="flex-shrink:0; margin-right:5px; vertical-align:middle;">
                                    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
                                    <polyline points="15 3 21 3 21 9"/>
                                    <line x1="10" y1="14" x2="21" y2="3"/>
                                </svg>
                                View Source
                            </button>
                        `;
                        bannerEl.classList.remove('hidden');
                        
                        const link = bannerEl.querySelector('.kv-source-link');
                        const btn = bannerEl.querySelector('.kv-source-btn');
                        
                        const openLink = (e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            chrome.tabs.create({ url: baseUrl });
                        };
                        
                        if (link) link.onclick = openLink;
                        if (btn) btn.onclick = openLink;
                    }
                }
            } catch (err) {
                console.error("Error reading HTML file for banner:", err);
            }
        } else {
            const img = document.getElementById('image-view');
            img.src = URL.createObjectURL(file);
            img.classList.remove('hidden');
            const panelWidth = document.getElementById('viewer-canvas-container').clientWidth - 32;
            img.style.width = (panelWidth * state.viewer.zoom) + 'px';
        }
    } catch (e) {
        console.error("Error rendering file in viewer", e);
    }
    
    renderAnnotationPanel();
    updateAnnotationsPanelVisibility();
    
    // Update timer placement to viewer header
    updateTimerUI();
}

/** Render Viewer Header function. */
// ============================================================
// SECTION 7B: Recipe Deletion
// ============================================================

/**
 * Remove a recipe entry from Kitchen Vault's in-memory state and metadata.
 * Does NOT touch the disk file — that is handled separately.
 * @param {object} fileObj  The state.files entry to remove.
 */
async function removeRecipeFromVault(fileObj) {
    const path = fileObj.path;

    // Remove from in-memory file list
    state.files = state.files.filter(f => f.path !== path);

    // Purge all metadata keyed by this path
    delete state.metadata.tags[path];
    delete state.metadata.ratings[path];
    delete state.metadata.bookmarks[path];
    if (state.metadata.annotations) delete state.metadata.annotations[path];

    await saveMetadata();
}

/**
 * Resolve the parent directory handle for a file entry by walking the
 * directory tree from the root handle using the parentPath segments.
 * Returns null if the path cannot be resolved or write permission is denied.
 * @param {object} fileObj  The state.files entry.
 * @returns {Promise<FileSystemDirectoryHandle|null>}
 */
async function resolveParentDirHandle(fileObj) {
    if (!state.directoryHandle) return null;

    // parentPath is relative to the root, e.g. "Recipes/Desserts"
    // The root handle name is the first segment of every path.
    const rootName = state.directoryHandle.name;
    let segments = (fileObj.parentPath || '').split('/').filter(s => s.length > 0);
    if (segments.length > 0 && segments[0] === rootName) {
        segments = segments.slice(1);
    }

    let dirHandle = state.directoryHandle;
    for (const seg of segments) {
        try {
            dirHandle = await dirHandle.getDirectoryHandle(seg);
        } catch (e) {
            return null;
        }
    }

    // Verify write permission before returning
    try {
        const perm = await dirHandle.requestPermission({ mode: 'readwrite' });
        if (perm !== 'granted') return null;
    } catch (e) {
        return null;
    }

    return dirHandle;
}

/**
 * Show the two-choice delete confirmation modal for a recipe.
 * Safe path: removes from Kitchen Vault only.
 * Destructive path: also deletes the local file from disk via File System Access API.
 * @param {object} fileObj  The state.files entry being deleted.
 */
function showDeleteRecipeModal(fileObj) {
    const cleanName = fileObj.name.replace(/\.[^/.]+$/, '').replace(/_/g, ' ');

    // Build shadow-DOM modal (same technique as background.js showRecipeNameModal)
    const container = document.createElement('div');
    container.id = 'kv-delete-modal-container';
    container.style.cssText = 'position:fixed; inset:0; z-index:99999; display:flex; align-items:center; justify-content:center; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;';

    const shadow = container.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
        .overlay {
            position: absolute;
            inset: 0;
            background: rgba(0,0,0,0.45);
            backdrop-filter: blur(4px);
        }
        .modal {
            position: relative;
            background: #ffffff;
            border-radius: 12px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.18);
            width: 380px;
            padding: 24px;
            display: flex;
            flex-direction: column;
            gap: 16px;
            animation: slideUp 0.22s cubic-bezier(0.16,1,0.3,1);
            border: 1px solid #d2ded0;
            color: #1b2e24;
        }
        @keyframes slideUp {
            from { transform: translateY(16px); opacity:0; }
            to   { transform: translateY(0);    opacity:1; }
        }
        .modal-title {
            font-size: 16px;
            font-weight: 700;
            display: flex;
            align-items: center;
            gap: 8px;
            color: #c94a47;
        }
        .modal-body {
            font-size: 13px;
            line-height: 1.5;
            color: #4e6b5c;
        }
        .recipe-name {
            font-weight: 600;
            color: #1b2e24;
        }
        .btn-row {
            display: flex;
            flex-direction: column;
            gap: 8px;
        }
        button {
            padding: 10px 16px;
            border-radius: 7px;
            font-size: 13px;
            font-weight: 600;
            cursor: pointer;
            border: 1px solid transparent;
            transition: opacity 0.15s;
            text-align: left;
        }
        button:hover { opacity: 0.82; }
        .btn-vault-only {
            background: #f1f5f0;
            color: #1b2e24;
            border-color: #d2ded0;
        }
        .btn-delete-file {
            background: #c94a47;
            color: #fff;
        }
        .btn-cancel {
            background: transparent;
            color: #4e6b5c;
            font-weight: 400;
        }
        .warning-note {
            font-size: 11px;
            color: #c94a47;
            margin: -4px 0 0 0;
            line-height: 1.4;
        }
    `;

    const overlay = document.createElement('div');
    overlay.className = 'overlay';

    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-title">🗑️ Delete Recipe</div>
        <div class="modal-body">
            How would you like to remove
            <span class="recipe-name">${cleanName}</span>?
        </div>
        <div class="btn-row">
            <button class="btn-vault-only">📚 Remove from Kitchen Vault only</button>
            <button class="btn-delete-file">🗑️ Remove from Kitchen Vault + delete local file</button>
            <p class="warning-note">⚠ The local file will be permanently deleted from your drive. This cannot be undone.</p>
            <button class="btn-cancel">Cancel</button>
        </div>
    `;

    shadow.appendChild(style);
    shadow.appendChild(overlay);
    shadow.appendChild(modal);
    document.body.appendChild(container);

    function dismiss() {
        if (container.parentNode) container.parentNode.removeChild(container);
    }

    // Cancel — close without doing anything
    overlay.addEventListener('click', dismiss);
    modal.querySelector('.btn-cancel').addEventListener('click', dismiss);

    // Safe path: remove from vault, keep file
    modal.querySelector('.btn-vault-only').addEventListener('click', async () => {
        dismiss();
        await removeRecipeFromVault(fileObj);
        closeViewer();
        renderApp();
    });

    // Destructive path: remove from vault + delete file from disk
    modal.querySelector('.btn-delete-file').addEventListener('click', async () => {
        dismiss();

        // Always remove from vault first so partial failures leave a clean state
        await removeRecipeFromVault(fileObj);
        closeViewer();

        let fileDeleted = false;
        try {
            const parentDirHandle = await resolveParentDirHandle(fileObj);
            if (parentDirHandle) {
                await parentDirHandle.removeEntry(fileObj.handle.name);
                fileDeleted = true;
            } else {
                alert('Kitchen Vault could not obtain write access to the folder.\n\nThe recipe was removed from Kitchen Vault, but the local file was NOT deleted.');
            }
        } catch (e) {
            console.error('KitchenVault: failed to delete local file:', e);
            alert(`Could not delete the local file: ${e.message}\n\nThe recipe has been removed from Kitchen Vault.`);
        }

        renderApp();

        if (fileDeleted) {
            const statusEl = document.getElementById('welcome-status');
            if (statusEl) {
                statusEl.textContent = `🗑️ "${cleanName}" deleted from disk.`;
                statusEl.classList.remove('hidden');
                setTimeout(() => statusEl.classList.add('hidden'), 3500);
            }
        }
    });
}

/** Render Viewer Header function. */

function renderViewerHeader() {
    const f = state.viewer.activeFile;
    if(!f) return;
    const cleanName = f.name.replace(/\.[^/.]+$/, "").replace(/_/g, ' ');
    document.getElementById('viewer-title').textContent = cleanName;
    
    const rating = state.metadata.ratings[f.path] || 0;
    const ratingContainer = document.getElementById('viewer-rating');
    let starsHtml = '';
    for(let i=1; i<=5; i++) {
        starsHtml += `<span class="star ${i <= rating ? 'filled' : ''}">★</span>`;
    }
    ratingContainer.innerHTML = starsHtml;
    
    ratingContainer.querySelectorAll('.star').forEach((node, idx) => {
        node.onclick = () => {
            const newRating = rating === idx + 1 ? 0 : idx + 1;
            state.metadata.ratings[f.path] = newRating;
            saveMetadata();
            renderViewerHeader();
            updateCardMeta(f.path);
        };
    });
}

/** Close Viewer function. */
function closeViewer() {
    const overlay = document.getElementById('panel-overlay');
    if (overlay) { overlay.classList.remove('visible'); overlay.classList.add('hidden'); }
    document.getElementById('viewer-panel').classList.remove('open');
    document.getElementById('annotations-panel').classList.remove('open');
    
    const sourceBanner = document.getElementById('source-banner');
    if (sourceBanner) {
        sourceBanner.classList.add('hidden');
        sourceBanner.innerHTML = '';
    }
    if (typeof resetConverterPanel === 'function') {
        resetConverterPanel();
    }
    if (typeof resetAltitudePanel === 'function') {
        resetAltitudePanel();
    }
    state.viewer.activeFile = null;
    if (state.viewer.renderTask) {
        try { state.viewer.renderTask.cancel(); } catch (err) {}
        state.viewer.renderTask = null;
    }
    if(state.viewer.pdfDoc) {
        state.viewer.pdfDoc.destroy();
        state.viewer.pdfDoc = null;
    }
    const iframe = document.getElementById('html-view');
    if (iframe) {
        if (iframe.src) URL.revokeObjectURL(iframe.src);
        iframe.src = "";
    }
    
    // Update timer placement to sidebar
    updateTimerUI();
}



/** Render Pdf Page function. */
async function renderPdfPage() {
    if (!state.viewer.pdfDoc) return;
    
    if (state.viewer.renderTask) {
        try {
            state.viewer.renderTask.cancel();
        } catch (err) {
            // Ignore if task was already finished
        }
        state.viewer.renderTask = null;
    }
    
    const page = await state.viewer.pdfDoc.getPage(state.viewer.pageNum);
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    
    const panelWidth = document.getElementById('viewer-canvas-container').clientWidth - 32;
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = (panelWidth / unscaledViewport.width) * state.viewer.zoom;
    const viewport = page.getViewport({ scale: scale });
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.classList.remove('hidden');
    
    const renderContext = {
        canvasContext: ctx,
        viewport: viewport
    };
    
    state.viewer.renderTask = page.render(renderContext);
    try {
        await state.viewer.renderTask.promise;
    } catch (err) {
        if (err.name === 'HeadingTaskCancelledException' || err.name === 'RenderingCancelledException') {
            // Render was cancelled, ignore
            return;
        }
        console.error("PDF render error:", err);
    }
    
    const pageInput = document.getElementById('page-num-input');
    if (pageInput) pageInput.value = state.viewer.pageNum;

    renderAnnotationPanel();
    updateAnnotationsPanelVisibility();
}



// ============================================================
// SECTION 7: Bookmarks
// ============================================================
/** Save Bookmark function. */
async function saveBookmark() {
    const label = document.getElementById('bookmark-label-input').value.trim();
    if (!label || !state.viewer.activeFile) return;
    
    const path = state.viewer.activeFile.path;
    const type = state.viewer.activeFile.type;
    
    let posData = {};
    let posDesc = "";
    
    if (type === 'pdf') {
        posData = { page: state.viewer.pageNum };
        posDesc = `Pg ${state.viewer.pageNum}`;
    } else {
        const container = document.getElementById('viewer-canvas-container');
        posData = { scroll: container.scrollTop };
        posDesc = `Scroll ${Math.round(container.scrollTop)}px`;
    }
    
    if (!state.metadata.bookmarks[path]) state.metadata.bookmarks[path] = [];
    state.metadata.bookmarks[path].push({ label, posData, posDesc });
    
    saveMetadata();
    renderBookmarks();
    updateCardMeta(path);
    renderSidebarBookmarks();
    
    document.getElementById('bookmark-label-input').value = "";
    document.getElementById('add-bookmark-form').classList.add('hidden');
}

window.deleteBookmark = function(idx) {
    const path = state.viewer.activeFile.path;
    state.metadata.bookmarks[path].splice(idx, 1);
    saveMetadata();
    renderBookmarks();
    updateCardMeta(path);
    renderSidebarBookmarks();
}

window.jumpToBookmark = function(idx) {
    const path = state.viewer.activeFile.path;
    const b = state.metadata.bookmarks[path][idx];
    if(state.viewer.activeFile.type === 'pdf') {
        state.viewer.pageNum = b.posData.page;
        renderPdfPage();
    } else {
        document.getElementById('viewer-canvas-container').scrollTop = b.posData.scroll;
    }
}

/** Render Bookmarks function. */
function renderBookmarks() {
    const list = document.getElementById('viewer-bookmarks-list');
    if (!list) return;
    
    list.innerHTML = '';
    const file = state.viewer.activeFile;
    if (!file) return;
    
    const bmarks = state.metadata.bookmarks[file.path] || [];
    bmarks.forEach((b, idx) => {
        const item = document.createElement('div');
        item.className = 'bookmark-item';
        const isAnn = !!b.isAnnotation;
        const typeClass = isAnn ? 'annotation' : 'normal';
        item.innerHTML = `
            <svg class="bookmark-icon ${typeClass}" viewBox="0 0 24 24" width="14" height="14" fill="currentColor" style="display:inline-block; vertical-align:middle; margin-right:4px;"><path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"></path></svg>
            <span class="bookmark-label" title="${b.label}">${b.label}</span>
            <span class="bookmark-page ${typeClass}">${b.posDesc}</span>
            <button class="btn-icon btn-del-bookmark" title="Delete Bookmark">✕</button>
        `;
        item.querySelector('.bookmark-label').onclick = () => jumpToBookmark(idx);
        item.querySelector('.btn-del-bookmark').onclick = () => deleteBookmark(idx);
        list.appendChild(item);
    });
}



// ============================================================
// SECTION 10: Settings & Theme
// ============================================================
// Theme system
const THEMES = ['light', 'dark', 'solarized'];

function applyTheme(theme) {
    if (!THEMES.includes(theme)) theme = 'light';
    document.documentElement.setAttribute('data-theme', theme);
    state.settings.theme = theme;
    document.querySelectorAll('.theme-select-control')
        .forEach(el => el.value = theme);
}

/** Set View Mode function. */
function setViewMode(mode) {
    state.settings.viewMode = mode;
    saveSettings();
    const grid = document.getElementById('grid-container');
    if (!grid) return;
    
    grid.classList.remove('view-list');
    document.getElementById('btn-view-grid').classList.remove('active');
    document.getElementById('btn-view-list').classList.remove('active');
    
    if (mode === 'list') {
        grid.classList.add('view-list');
        document.getElementById('btn-view-list').classList.add('active');
        document.getElementById('size-slider-group').classList.add('hidden');
    } else {
        document.getElementById('btn-view-grid').classList.add('active');
        document.getElementById('size-slider-group').classList.remove('hidden');
    }
}

/** Apply Settings To UI function. */
function applySettingsToUI() {
    const grid = document.getElementById('grid-container');
    if (!grid) return;
    
    setViewMode(state.settings.viewMode || 'grid');
    
    applyTheme(state.settings.theme || 'light');
    
    const cardSize = state.settings.cardSize || 160;
    document.documentElement.style.setProperty('--card-size', `${cardSize}px`);
    const slider = document.getElementById('card-size-slider');
    if (slider) {
        slider.value = cardSize;
        const min = parseInt(slider.min) || 100;
        const max = parseInt(slider.max) || 400;
        const pct = ((cardSize - min) / (max - min)) * 100;
        slider.style.setProperty('--slider-pct', `${pct}%`);
    }
    
    const iconComfortable = document.getElementById('icon-comfortable');
    const iconCompact = document.getElementById('icon-compact');
    
    if (state.settings.compactGrid) {
        grid.classList.add('grid-compact');
        if (iconComfortable) iconComfortable.classList.add('hidden');
        if (iconCompact) iconCompact.classList.remove('hidden');
    } else {
        grid.classList.remove('grid-compact');
        if (iconComfortable) iconComfortable.classList.remove('hidden');
        if (iconCompact) iconCompact.classList.add('hidden');
    }
    
    const extBtn = document.getElementById('btn-toggle-ext');
    if (extBtn) {
        if (state.settings.showExtensions) {
            extBtn.classList.add('active');
        } else {
            extBtn.classList.remove('active');
        }
    }
    
    const thumbToggle = document.getElementById('setting-thumbnails');
    if (thumbToggle) thumbToggle.checked = state.settings.showThumbnails;
    
    const keepAwakeToggle = document.getElementById('setting-keep-awake');
    if (keepAwakeToggle) keepAwakeToggle.checked = state.settings.keepAwake || false;

    const behavior = state.settings.annotationBehavior || "only-annotated";
    const radio = document.querySelector(`input[name="annotation-behavior"][value="${behavior}"]`);
    if (radio) radio.checked = true;
}

/** Render Sidebar Bookmarks function. */
function renderSidebarBookmarks() {
    const list = document.getElementById('sidebar-bookmarks-list');
    if (!list) return;
    
    list.innerHTML = '';
    const bookmarks = state.metadata.bookmarks;
    
    // Group by file path
    for (const [path, items] of Object.entries(bookmarks)) {
        if (!items || items.length === 0) continue;
        
        const fileObj = state.files.find(f => f.path === path);
        if (!fileObj) continue; 
        
        const groupDiv = document.createElement('div');
        groupDiv.className = 'bookmark-file-group';
        
        const titleDiv = document.createElement('div');
        titleDiv.className = 'bookmark-file-title';
        titleDiv.title = fileObj.name.replace(/_/g, ' ');
        titleDiv.textContent = fileObj.name.replace(/\.[^/.]+$/, "").replace(/_/g, ' ');
        titleDiv.onclick = () => openViewer(fileObj);
        groupDiv.appendChild(titleDiv);
        
        items.forEach((b, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'sidebar-bookmark-item';
            const isAnn = !!b.isAnnotation;
            const typeClass = isAnn ? 'annotation' : 'normal';
            const iconClass = isAnn ? 'bookmark-icon--annotated' : 'bookmark-icon--plain';
            itemDiv.innerHTML = `
                <span class="sidebar-bookmark-icon ${iconClass}">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                    <path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>
                  </svg>
                </span>
                <span class="sidebar-bookmark-label" title="${b.label}">${b.label}</span>
                <span class="sidebar-bookmark-page ${typeClass}">${b.posDesc}</span>
            `;
            itemDiv.onclick = async () => {
                await openViewer(fileObj);
                setTimeout(() => jumpToBookmark(idx), 300);
            };
            groupDiv.appendChild(itemDiv);
        });
        
        list.appendChild(groupDiv);
    }
    
    if (list.innerHTML === '') {
        list.innerHTML = '<div style="padding: 16px; text-align: center; color: var(--color-text-muted); font-size: 12px;">No bookmarks yet</div>';
    }
}



// ============================================================
// SECTION 8: Tagging System
// ============================================================
/** Init Tag Autocomplete function. */
function initTagAutocomplete() {
  const dropdown = document.getElementById('tag-autocomplete-dropdown');
  if (!dropdown) return;

  document.addEventListener('click', (e) => {
    if (!e.target.closest('#viewer-tag-input-wrapper')) {
      dropdown.classList.add('hidden');
      dropdown.innerHTML = '';
    }
  });
}

/** Attach Tag Autocomplete function. */
function attachTagAutocomplete(inputEl, filePath) {
  const dropdown = document.getElementById('tag-autocomplete-dropdown');
  if (!inputEl || !dropdown) return;

  inputEl.addEventListener('input', () => {
    const query = inputEl.value.trim().toLowerCase();
    dropdown.innerHTML = '';
    if (!query) { dropdown.classList.add('hidden'); return; }

    const existing = state.metadata.tags[filePath] || [];
    const matches = state.tagLibrary.filter(t =>
      t.label.toLowerCase().includes(query) && !existing.includes(t.label)
    );

    matches.forEach(tag => {
      const item = document.createElement('div');
      item.className = 'autocomplete-item';
      item.innerHTML = `<span class="autocomplete-dot" style="background:${tag.color}"></span>${tag.label}`;
      item.onclick = () => {
        addTagToFile(filePath, tag.label);
        inputEl.value = '';
        dropdown.classList.add('hidden');
      };
      dropdown.appendChild(item);
    });

    const exactMatch = state.tagLibrary.find(t => t.label.toLowerCase() === query);
    if (!exactMatch) {
      const createItem = document.createElement('div');
      createItem.className = 'autocomplete-item autocomplete-create';
      createItem.textContent = `+ Create "${inputEl.value.trim()}"`;
      createItem.onclick = () => {
        const newTag = {
          id: Date.now().toString(),
          label: inputEl.value.trim(),
          color: DEFAULT_TAG_COLORS[state.tagLibrary.length % DEFAULT_TAG_COLORS.length],
          isDefault: false
        };
        state.tagLibrary.push(newTag);
        saveTagLibrary();
        addTagToFile(filePath, newTag.label);
        inputEl.value = '';
        dropdown.classList.add('hidden');
      };
      dropdown.appendChild(createItem);
    }

    dropdown.classList.toggle('hidden', dropdown.children.length === 0);
  });

  inputEl.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = dropdown.querySelector('.autocomplete-item');
      if (first) first.click();
    }
    if (e.key === 'Escape') {
      dropdown.classList.add('hidden');
    }
  });
}

/** Add Tag To File function. */
function addTagToFile(filePath, label) {
  if (!state.metadata.tags[filePath]) state.metadata.tags[filePath] = [];
  if (!state.metadata.tags[filePath].includes(label)) {
    state.metadata.tags[filePath].push(label);
    saveMetadata();
    renderViewerTags();
    updateCardMeta(filePath);
  }
}

/** Render Viewer Tags function. */
function renderViewerTags() {
  const container = document.getElementById('viewer-tags-container');
  if (!container || !state.viewer.activeFile) return;
  const path = state.viewer.activeFile.path;
  const tags = state.metadata.tags[path] || [];
  container.innerHTML = '';
  tags.forEach((label) => {
    const libTag = state.tagLibrary.find(t => t.label === label);
    const color = libTag ? libTag.color : '#8a6e5c';
    const chip = document.createElement('span');
    chip.className = 'tag-chip removable';
    chip.style.backgroundColor = color;
    chip.style.color = '#fff';
    chip.innerHTML = `${label} <button class="tag-remove" data-tag="${label}">×</button>`;
    chip.querySelector('.tag-remove').onclick = (e) => {
      e.stopPropagation();
      state.metadata.tags[path] = state.metadata.tags[path].filter(t => t !== label);
      saveMetadata();
      renderViewerTags();
      updateCardMeta(path);
    };
    container.appendChild(chip);
  });
  const input = document.getElementById('viewer-tag-input');
  if (input) attachTagAutocomplete(input, path);
}

/** Render Settings Tag List function. */
function renderSettingsTagList() {
  const container = document.getElementById('settings-tag-list');
  if (!container) return;
  container.innerHTML = '';
  
  if (!Array.isArray(state.tagLibrary)) {
      state.tagLibrary = [];
  }
  
  state.tagLibrary.forEach((tag, idx) => {
    if (!tag) return;
    const row = document.createElement('div');
    row.className = 'tag-list-row';
    row.innerHTML = `
      <span class="tag-chip" style="background-color:${tag.color};color:#fff">${tag.label}</span>
      <button class="btn-icon btn-del-tag" title="Delete tag">✕</button>
    `;
    row.querySelector('.btn-del-tag').onclick = () => deleteTagFromLibrary(idx);
    container.appendChild(row);
  });
}

window.deleteTagFromLibrary = function(idx) {
  const removed = state.tagLibrary.splice(idx, 1)[0];
  for (const path in state.metadata.tags) {
    state.metadata.tags[path] = state.metadata.tags[path].filter(t => t !== removed.label);
  }
  saveTagLibrary();
  saveMetadata();
  renderSettingsTagList();
  renderGrid();
};

/** Setup Add Tag Btn function. */
function setupAddTagBtn() {
  const btn = document.getElementById('btn-add-tag-to-viewer');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const input = document.getElementById('viewer-tag-input');
    if (input) {
      input.focus();
      input.scrollIntoView({ behavior: 'smooth' });
    }
  });
}

// --- 9. EVENT DELEGATION & INIT ---

// --- 10. LOCAL FILE SYSTEM LOCATION LOCATOR (NATIVE MESSAGING HOST) ---
async function writeLocatorFile(locatorId) {
    try {
        const hasPermission = await verifyWritePermission(state.directoryHandle);
        if (!hasPermission) return false;
        const fileHandle = await state.directoryHandle.getFileHandle(`.kv_locator_${locatorId}`, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(locatorId);
        await writable.close();
        return true;
    } catch (e) {
        console.error("Error writing locator file:", e);
        return false;
    }
}

async function removeLocatorFile(locatorId) {
    try {
        await state.directoryHandle.removeEntry(`.kv_locator_${locatorId}`);
    } catch (e) {
        // Safe to ignore if host deleted it first
    }
}

async function triggerShowInExplorer(relativeFilePath, rootFolderName) {
    const btnShowExplorer = document.getElementById('btn-show-explorer');
    const origHTML = btnShowExplorer ? btnShowExplorer.innerHTML : "";
    
    const openingHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg> Opening...`;
    const locatingHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg> Locating...`;

    if (state.settings.resolvedAbsolutePath) {
        // Attempt direct open
        if (btnShowExplorer) btnShowExplorer.innerHTML = openingHTML;
        chrome.runtime.sendNativeMessage(
            'kitchenvault_host',
            {
                action: 'open_direct',
                absolutePath: state.settings.resolvedAbsolutePath,
                relativePath: relativeFilePath,
                rootFolderName: rootFolderName
            },
            function(response) {
                if (btnShowExplorer) btnShowExplorer.innerHTML = origHTML;
                if (chrome.runtime.lastError) {
                    console.error("Native messaging error:", chrome.runtime.lastError);
                    alert("Could not connect to Native Explorer. Please run 'install_host.py' in the extension folder first!");
                    return;
                }
                if (response && response.status === 'error') {
                    console.warn("Direct open failed, retrying via locator. Error:", response.error);
                    state.settings.resolvedAbsolutePath = "";
                    saveSettings();
                    // Retry with locator
                    triggerShowInExplorer(relativeFilePath, rootFolderName);
                }
            }
        );
    } else {
        // Need to locate
        if (btnShowExplorer) btnShowExplorer.innerHTML = locatingHTML;
        const locatorId = Math.random().toString(36).substring(2, 15);
        const written = await writeLocatorFile(locatorId);
        if (!written) {
            if (btnShowExplorer) btnShowExplorer.innerHTML = origHTML;
            alert("Could not write locator file to verify absolute path.");
            return;
        }

        chrome.runtime.sendNativeMessage(
            'kitchenvault_host',
            {
                action: 'locate_and_open',
                locatorId: locatorId,
                relativePath: relativeFilePath,
                rootFolderName: rootFolderName
            },
            async function(response) {
                // Clean up the locator file
                await removeLocatorFile(locatorId);
                if (btnShowExplorer) btnShowExplorer.innerHTML = origHTML;

                if (chrome.runtime.lastError) {
                    console.error("Native messaging error:", chrome.runtime.lastError);
                    alert("Could not connect to Native Explorer. Please run 'install_host.py' in the extension folder first!");
                    return;
                }

                if (response && response.status === 'success') {
                    state.settings.resolvedAbsolutePath = response.rootPath;
                    saveSettings();
                } else {
                    alert("Failed to locate file path automatically: " + (response ? response.error : "Unknown error"));
                }
            }
        );
    }
}

// --- 11. ANNOTATIONS SYSTEM ---
function getActivePageKey() {
    const f = state.viewer.activeFile;
    if (!f) return null;
    const pageNum = f.type === 'pdf' ? state.viewer.pageNum : 1;
    return `page_${pageNum}`;
}

function renderAnnotationPanel() {
    const f = state.viewer.activeFile;
    if (!f) return;

    const pageKey = getActivePageKey();
    if (!pageKey) return;

    const pageNum = f.type === 'pdf' ? state.viewer.pageNum : 1;
    const titleEl = document.getElementById('annotations-panel-title');
    if (titleEl) {
        titleEl.textContent = f.type === 'pdf' ? `Page ${pageNum} Annotation` : "Recipe Annotation";
    }

    const textarea = document.getElementById('annotation-text-input');
    if (textarea) {
        const fileAnns = state.metadata.annotations[f.path] || {};
        textarea.value = fileAnns[pageKey] || "";
    }

    // Toggle bookmark container at the bottom
    const fileAnns = state.metadata.annotations[f.path] || {};
    const text = fileAnns[pageKey] || "";
    const container = document.getElementById('annotation-bookmark-action-container');
    if (container) {
        if (text.trim() !== "") {
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
            // Reset forms
            document.getElementById('annotation-bookmark-form').classList.add('hidden');
            document.getElementById('btn-add-annotation-bookmark').classList.remove('hidden');
        }
    }
}

function updateAnnotationsPanelVisibility() {
    const f = state.viewer.activeFile;
    const panel = document.getElementById('annotations-panel');
    if (!panel) return;

    if (!f) {
        panel.classList.remove('open');
        return;
    }

    const behavior = state.settings.annotationBehavior || "only-annotated";
    if (behavior === 'always') {
        panel.classList.add('open');
    } else if (behavior === 'only-annotated') {
        const pageKey = getActivePageKey();
        const fileAnns = state.metadata.annotations[f.path] || {};
        const hasAnn = !!(fileAnns[pageKey] && fileAnns[pageKey].trim() !== "");
        if (hasAnn) {
            panel.classList.add('open');
        } else {
            panel.classList.remove('open');
        }
    }
}

async function saveAnnotationText(text) {
    const f = state.viewer.activeFile;
    if (!f) return;

    const pageKey = getActivePageKey();
    if (!pageKey) return;

    if (!state.metadata.annotations[f.path]) {
        state.metadata.annotations[f.path] = {};
    }

    if (text.trim() === "") {
        delete state.metadata.annotations[f.path][pageKey];
        if (Object.keys(state.metadata.annotations[f.path]).length === 0) {
            delete state.metadata.annotations[f.path];
        }
    } else {
        state.metadata.annotations[f.path][pageKey] = text;
    }

    await saveMetadata();
    
    // Update the bookmark button visibility dynamically
    const container = document.getElementById('annotation-bookmark-action-container');
    if (container) {
        if (text.trim() !== "") {
            container.classList.remove('hidden');
        } else {
            container.classList.add('hidden');
            document.getElementById('annotation-bookmark-form').classList.add('hidden');
            document.getElementById('btn-add-annotation-bookmark').classList.remove('hidden');
        }
    }

    // Update markers on grid card
    updateCardMeta(f.path);
}

document.addEventListener('DOMContentLoaded', async () => {
    const data = await loadStorage();
    
    // Apply Keep Awake on startup
    applyKeepAwake();

    // Listen for incoming recipes from context menu / background
    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message.action === "import_recipe") {
            handleIncomingRecipe(message.title, message.url, message.html);
        }
    });

    // Ready signal to retrieve any pending recipes from the background script
    chrome.runtime.sendMessage({ action: "popup_ready" }, (response) => {
        if (response && response.pendingRecipe) {
            handleIncomingRecipe(response.pendingRecipe.title, response.pendingRecipe.url, response.pendingRecipe.html);
        }
    });
    
    // Theme
    if(data.theme) document.documentElement.setAttribute('data-theme', data.theme);
    
    // First Launch check
    if(data.prevFolderName) {
        document.getElementById('reconnect-container').classList.remove('hidden');
        document.getElementById('prev-folder-name').textContent = data.prevFolderName;
    }
    
    try {
        const savedHandle = await loadHandle();
        if (savedHandle) {
            // queryPermission doesn't require user gesture, allows silent auto-opening
            const permission = await savedHandle.queryPermission({ mode: 'readwrite' });
            if (permission === 'granted') {
                state.directoryHandle = savedHandle;
                await scanDirectory();
            } else {
                showWelcomeView();
            }
        } else {
            showWelcomeView();
        }
    } catch (e) {
        showWelcomeView();
    }
    
    // --- Global Handlers ---
    const elBtnSelectFolder = document.getElementById('btn-select-folder');
    if (elBtnSelectFolder) elBtnSelectFolder.addEventListener('click', selectFolder);
    const elBtnReconnectFolder = document.getElementById('btn-reconnect-folder');
    if (elBtnReconnectFolder) elBtnReconnectFolder.addEventListener('click', reconnectFolder);
    const elBtnChangeFolder = document.getElementById('btn-change-folder');
    if (elBtnChangeFolder) elBtnChangeFolder.addEventListener('click', selectFolder);
    
    // --- Web Clipper Panel Handlers ---
    const elBtnAddUrl = document.getElementById('btn-add-url');
    if (elBtnAddUrl) elBtnAddUrl.addEventListener('click', () => {
        const ov = document.getElementById('panel-overlay');
        if (ov) { ov.classList.remove('hidden'); ov.classList.add('visible'); }
        document.getElementById('add-url-panel').classList.add('open');
        
        // Auto-select folder matching default settings if set
        if (state.settings.defaultWebRecipePath) {
            document.getElementById('recipe-folder-select').value = state.settings.defaultWebRecipePath;
        }
        
        setTimeout(() => document.getElementById('recipe-url-input').focus(), 300);
    });
    
    const elBtnCloseAddUrl = document.getElementById('btn-close-add-url');
    if (elBtnCloseAddUrl) elBtnCloseAddUrl.addEventListener('click', closeAddUrlPanel);
    
    const elBtnSaveUrlRecipe = document.getElementById('btn-save-url-recipe');
    if (elBtnSaveUrlRecipe) elBtnSaveUrlRecipe.addEventListener('click', saveWebRecipe);
    
    const elSettingDefaultFolder = document.getElementById('setting-default-folder');
    if (elSettingDefaultFolder) elSettingDefaultFolder.addEventListener('change', (e) => {
        state.settings.defaultWebRecipePath = e.target.value;
        saveSettings();
        
        const folderSelect = document.getElementById('recipe-folder-select');
        if (folderSelect) folderSelect.value = e.target.value;
    });
    
    // Indexing Prompt Handlers
    const elBtnPromptYes = document.getElementById('btn-prompt-yes');
    if (elBtnPromptYes) elBtnPromptYes.addEventListener('click', () => {
        state.settings.firstLoadCompleted = true;
        saveSettings();
        document.getElementById('indexing-prompt').classList.add('hidden');
        processQueue();
    });
    
    const elBtnPromptNo = document.getElementById('btn-prompt-no');
    
    if (elBtnPromptNo) elBtnPromptNo.addEventListener('click', () => {
        state.settings.firstLoadCompleted = true;
        saveSettings();
        document.getElementById('indexing-prompt').classList.add('hidden');
    });
    
    // Indexing Banner Handlers
    const elBtnIndexingStop = document.getElementById('btn-indexing-stop');
    if (elBtnIndexingStop) elBtnIndexingStop.addEventListener('click', () => {
        indexingCancelled = true;
        isProcessingThumbnails = false;
        document.getElementById('btn-indexing-stop').classList.add('hidden');
        document.getElementById('btn-indexing-resume').classList.remove('hidden');
        document.getElementById('btn-indexing-dismiss').classList.remove('hidden');
    });
    
    const elBtnIndexingResume = document.getElementById('btn-indexing-resume');
    
    if (elBtnIndexingResume) elBtnIndexingResume.addEventListener('click', () => {
        indexingCancelled = false;
        isProcessingThumbnails = true;
        document.getElementById('btn-indexing-stop').classList.remove('hidden');
        document.getElementById('btn-indexing-resume').classList.add('hidden');
        document.getElementById('btn-indexing-dismiss').classList.add('hidden');
        processQueue();
    });
    
    const elBtnIndexingDismiss = document.getElementById('btn-indexing-dismiss');
    
    if (elBtnIndexingDismiss) elBtnIndexingDismiss.addEventListener('click', () => {
        document.getElementById('indexing-banner').classList.add('hidden');
    });
    
    // Settings Scan Handlers
    const elBtnReindexAll = document.getElementById('btn-reindex-all');
    if (elBtnReindexAll) elBtnReindexAll.addEventListener('click', async () => {
        if(confirm("Re-index all thumbnails? This will clear the cache and might take a while.")) {
            await clearThumbnailCache();
            scanDirectory();
        }
    });
    
    const elBtnScanNew = document.getElementById('btn-scan-new');
    if (elBtnScanNew) elBtnScanNew.addEventListener('click', () => {
        scanDirectory();
    });
    
    document.querySelectorAll('.theme-select-control').forEach(el => {
        el.addEventListener('change', function () {
            applyTheme(this.value);
            saveSettings();
        });
    });
    
    const btnGrid = document.getElementById('btn-view-grid');
    const btnList = document.getElementById('btn-view-list');
    if (btnGrid) btnGrid.addEventListener('click', () => setViewMode('grid'));
    if (btnList) btnList.addEventListener('click', () => setViewMode('list'));
    
    const sizeSlider = document.getElementById('card-size-slider');
    if (sizeSlider) {
        sizeSlider.addEventListener('input', e => {
            const val = e.target.value;
            document.documentElement.style.setProperty('--card-size', `${val}px`);
            state.settings.cardSize = parseInt(val, 10);
            saveSettings();
            
            const min = parseInt(e.target.min) || 100;
            const max = parseInt(e.target.max) || 400;
            const pct = ((val - min) / (max - min)) * 100;
            e.target.style.setProperty('--slider-pct', `${pct}%`);
        });
    }
    
    // Search
    let searchTimeout;
    const elSearchInput = document.getElementById('search-input');
    if (elSearchInput) elSearchInput.addEventListener('input', (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
            state.searchQuery = e.target.value;
            renderGrid();
        }, 200);
    });
    
    const elBtnClearSearch = document.getElementById('btn-clear-search');
    
    if (elBtnClearSearch) elBtnClearSearch.addEventListener('click', () => {
        document.getElementById('search-input').value = '';
        state.searchQuery = '';
        renderGrid();
    });
    
    // Filters
    const elFilterType = document.getElementById('filter-type');
    if (elFilterType) elFilterType.addEventListener('change', (e) => {
        state.filters.type = e.target.value;
        renderGrid();
    });
    const elFilterRating = document.getElementById('filter-rating');
    if (elFilterRating) elFilterRating.addEventListener('change', (e) => {
        state.filters.rating = e.target.value;
        renderGrid();
    });
    const elSortBy = document.getElementById('sort-by');
    if (elSortBy) elSortBy.addEventListener('change', (e) => {
        state.sortBy = e.target.value;
        renderGrid();
    });
    
    // Viewer Overlay
    const elPanelOverlay = document.getElementById('panel-overlay');
    if (elPanelOverlay) elPanelOverlay.addEventListener('click', () => {
        closeViewer();
        document.getElementById('settings-panel').classList.remove('open');
        document.getElementById('add-url-panel').classList.remove('open');
        document.getElementById('annotations-panel').classList.remove('open');
        elPanelOverlay.classList.remove('visible');
        elPanelOverlay.classList.add('hidden');
    });
    
    // Viewer actions
    const elBtnCloseViewer = document.getElementById('btn-close-viewer');
    if (elBtnCloseViewer) elBtnCloseViewer.addEventListener('click', closeViewer);

    // Annotations panel close
    const btnCloseAnnotations = document.getElementById('btn-close-annotations');
    if (btnCloseAnnotations) {
        btnCloseAnnotations.addEventListener('click', () => {
            document.getElementById('annotations-panel').classList.remove('open');
        });
    }

    // Annotations panel toggle
    const btnAddAnnotation = document.getElementById('btn-add-annotation');
    if (btnAddAnnotation) {
        btnAddAnnotation.addEventListener('click', () => {
            document.getElementById('annotations-panel').classList.toggle('open');
            renderAnnotationPanel();
        });
    }

    // Annotation text input auto-saving
    const annTextInput = document.getElementById('annotation-text-input');
    if (annTextInput) {
        annTextInput.addEventListener('input', (e) => {
            saveAnnotationText(e.target.value);
        });
    }

    // Annotation Bookmark actions
    const btnAddAnnBookmark = document.getElementById('btn-add-annotation-bookmark');
    if (btnAddAnnBookmark) {
        btnAddAnnBookmark.addEventListener('click', () => {
            const form = document.getElementById('annotation-bookmark-form');
            const labelInput = document.getElementById('annotation-bookmark-label');
            const f = state.viewer.activeFile;
            
            form.classList.remove('hidden');
            btnAddAnnBookmark.classList.add('hidden');
            
            if (f) {
                const pageNum = f.type === 'pdf' ? state.viewer.pageNum : 1;
                const pageDesc = f.type === 'pdf' ? `Page ${pageNum}` : "";
                const cleanName = f.name.replace(/\.[^/.]+$/, "").replace(/_/g, ' ');
                labelInput.value = pageDesc ? `Annotation - ${cleanName} - ${pageDesc}` : `Annotation - ${cleanName}`;
            }
            
            labelInput.focus();
            labelInput.select();
        });
    }

    const btnCancelAnnBookmark = document.getElementById('btn-cancel-annotation-bookmark');
    if (btnCancelAnnBookmark) {
        btnCancelAnnBookmark.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        btnCancelAnnBookmark.addEventListener('click', () => {
            document.getElementById('annotation-bookmark-form').classList.add('hidden');
            document.getElementById('btn-add-annotation-bookmark').classList.remove('hidden');
        });
    }

    const btnSaveAnnBookmark = document.getElementById('btn-save-annotation-bookmark');
    if (btnSaveAnnBookmark) {
        btnSaveAnnBookmark.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        btnSaveAnnBookmark.addEventListener('click', async () => {
            const labelInput = document.getElementById('annotation-bookmark-label');
            const label = labelInput.value.trim();
            if (!label || !state.viewer.activeFile) return;

            const path = state.viewer.activeFile.path;
            const type = state.viewer.activeFile.type;

            let posData = {};
            let posDesc = "";

            if (type === 'pdf') {
                posData = { page: state.viewer.pageNum };
                posDesc = `Pg ${state.viewer.pageNum}`;
            } else {
                const container = document.getElementById('viewer-canvas-container');
                posData = { scroll: container.scrollTop };
                posDesc = `Scroll ${Math.round(container.scrollTop)}px`;
            }

            if (!state.metadata.bookmarks[path]) state.metadata.bookmarks[path] = [];
            state.metadata.bookmarks[path].push({ label, posData, posDesc, isAnnotation: true });

            await saveMetadata();
            renderBookmarks();
            updateCardMeta(path);
            renderSidebarBookmarks();

            labelInput.value = "";
            document.getElementById('annotation-bookmark-form').classList.add('hidden');
            document.getElementById('btn-add-annotation-bookmark').classList.remove('hidden');
        });
    }

    const annBookmarkLabel = document.getElementById('annotation-bookmark-label');
    if (annBookmarkLabel) {
        annBookmarkLabel.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                btnSaveAnnBookmark.click();
            } else if (e.key === 'Escape') {
                btnCancelAnnBookmark.click();
            }
        });
    }

    // Annotation settings behavior listener
    document.querySelectorAll('input[name="annotation-behavior"]').forEach(r => {
        r.addEventListener('change', (e) => {
            state.settings.annotationBehavior = e.target.value;
            saveSettings();
            updateAnnotationsPanelVisibility();
        });
    });
    
    const elBtnPrevPage = document.getElementById('btn-prev-page');
    
    if (elBtnPrevPage) elBtnPrevPage.addEventListener('click', () => {
        if(state.viewer.pageNum > 1) {
            state.viewer.pageNum--;
            renderPdfPage();
        }
    });
    const elBtnNextPage = document.getElementById('btn-next-page');
    if (elBtnNextPage) elBtnNextPage.addEventListener('click', () => {
        if(state.viewer.pageNum < state.viewer.pdfDoc.numPages) {
            state.viewer.pageNum++;
            renderPdfPage();
        }
    });
    const elPageNumInput = document.getElementById('page-num-input');
    if (elPageNumInput) elPageNumInput.addEventListener('change', (e) => {
        let val = parseInt(e.target.value);
        if(val >= 1 && val <= state.viewer.pdfDoc.numPages) {
            state.viewer.pageNum = val;
            renderPdfPage();
        } else {
            e.target.value = state.viewer.pageNum;
        }
    });
    
    document.addEventListener('keydown', (e) => {
        if (!state.viewer.activeFile || state.viewer.activeFile.type !== 'pdf' || !state.viewer.pdfDoc) return;
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
        
        if (e.key === 'ArrowLeft' && state.viewer.pageNum > 1) {
            state.viewer.pageNum--;
            renderPdfPage();
        } else if (e.key === 'ArrowRight' && state.viewer.pageNum < state.viewer.pdfDoc.numPages) {
            state.viewer.pageNum++;
            renderPdfPage();
        }
    });
    
    const elBtnZoomIn = document.getElementById('btn-zoom-in');
    
    if (elBtnZoomIn) elBtnZoomIn.addEventListener('click', () => setZoom(0.25));
    const elBtnZoomOut = document.getElementById('btn-zoom-out');
    if (elBtnZoomOut) elBtnZoomOut.addEventListener('click', () => setZoom(-0.25));
    const elBtnZoomReset = document.getElementById('btn-zoom-reset');
    if (elBtnZoomReset) elBtnZoomReset.addEventListener('click', () => setZoom(0));
    
    // Tags Autocomplete
    initTagAutocomplete();
    
    // Bookmarks Tab
    const tabFolders = document.getElementById('tab-folders');
    const tabBookmarks = document.getElementById('tab-bookmarks');
    const panelFolders = document.getElementById('panel-folders');
    const panelBookmarks = document.getElementById('panel-bookmarks');

    if (tabFolders && tabBookmarks) {
        tabFolders.onclick = () => {
            tabFolders.classList.add('active');
            tabBookmarks.classList.remove('active');
            panelFolders.classList.remove('hidden');
            panelBookmarks.classList.add('hidden');
        };
        tabBookmarks.onclick = () => {
            tabBookmarks.classList.add('active');
            tabFolders.classList.remove('active');
            panelBookmarks.classList.remove('hidden');
            panelFolders.classList.add('hidden');
            renderSidebarBookmarks();
        };
    }
    
    const elBtnAddBookmark = document.getElementById('btn-add-bookmark');
    
    if (elBtnAddBookmark) elBtnAddBookmark.addEventListener('click', () => {
        document.getElementById('add-bookmark-form').classList.remove('hidden');
        document.getElementById('bookmark-label-input').focus();
    });
    const elBtnCancelBookmark = document.getElementById('btn-cancel-bookmark');
    if (elBtnCancelBookmark) {
        elBtnCancelBookmark.addEventListener('mousedown', (e) => e.preventDefault());
        elBtnCancelBookmark.addEventListener('click', () => {
            document.getElementById('add-bookmark-form').classList.add('hidden');
        });
    }
    const elBtnSaveBookmark = document.getElementById('btn-save-bookmark');
    if (elBtnSaveBookmark) {
        elBtnSaveBookmark.addEventListener('mousedown', (e) => e.preventDefault());
        elBtnSaveBookmark.addEventListener('click', saveBookmark);
    }
    const elBookmarkLabelInput = document.getElementById('bookmark-label-input');
    if (elBookmarkLabelInput) elBookmarkLabelInput.addEventListener('keydown', (e) => {
        if(e.key === 'Enter') saveBookmark();
    });
    
    // Settings
    const elSettingsToggle = document.getElementById('settings-toggle');
    if (elSettingsToggle) elSettingsToggle.addEventListener('click', () => {
        const ov = document.getElementById('panel-overlay');
        if (ov) { ov.classList.remove('hidden'); ov.classList.add('visible'); }
        document.getElementById('settings-panel').classList.add('open');
        renderSettingsTagList();
    });
    const elBtnCloseSettings = document.getElementById('btn-close-settings');
    if (elBtnCloseSettings) elBtnCloseSettings.addEventListener('click', () => {
        const ov = document.getElementById('panel-overlay');
        if (ov) { ov.classList.remove('visible'); ov.classList.add('hidden'); }
        document.getElementById('settings-panel').classList.remove('open');
    });
    
    const elBtnToggleExt = document.getElementById('btn-toggle-ext');
    
    if (elBtnToggleExt) elBtnToggleExt.addEventListener('click', () => {
        state.settings.showExtensions = !state.settings.showExtensions;
        saveSettings();
        applySettingsToUI();
        renderGrid();
    });
    const elBtnToggleCompact = document.getElementById('btn-toggle-compact');
    if (elBtnToggleCompact) elBtnToggleCompact.addEventListener('click', () => {
        state.settings.compactGrid = !state.settings.compactGrid;
        saveSettings();
        applySettingsToUI();
    });
    
    const settingThumbnails = document.getElementById('setting-thumbnails');
    if (settingThumbnails) {
        settingThumbnails.addEventListener('change', (e) => {
            state.settings.showThumbnails = e.target.checked;
            saveSettings();
            renderGrid();
        });
    }

    const btnClearCache = document.getElementById('btn-clear-cache');
    if (btnClearCache) {
        btnClearCache.addEventListener('click', async () => {
            await clearThumbnailCache();
            alert("Thumbnail cache cleared.");
            renderGrid();
        });
    }
    
    setupAddTagBtn();
    
    // Data Sync
    const elBtnExportData = document.getElementById('btn-export-data');
    if (elBtnExportData) elBtnExportData.addEventListener('click', () => {
        const dataStr = JSON.stringify(state.metadata, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = "kitchen_vault_backup.json";
        a.click();
        URL.revokeObjectURL(url);
    });
    
    const elBtnImportData = document.getElementById('btn-import-data');
    
    if (elBtnImportData) elBtnImportData.addEventListener('click', () => {
        document.getElementById('import-data-input').click();
    });
    
    const elImportDataInput = document.getElementById('import-data-input');
    
    if (elImportDataInput) elImportDataInput.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if(!file) return;
        const reader = new FileReader();
        const statusMsg = document.getElementById('import-status');
        reader.onload = (ev) => {
            try {
                const imported = JSON.parse(ev.target.result);
                state.metadata = imported;
                if (!state.metadata.annotations) state.metadata.annotations = {};
                saveMetadata();
                renderApp();
                if (statusMsg) {
                    statusMsg.textContent = "Data imported successfully!";
                    statusMsg.className = "status-message success";
                } else {
                    alert("Data imported successfully!");
                }
            } catch(err) {
                if (statusMsg) {
                    statusMsg.textContent = "Invalid JSON file.";
                    statusMsg.className = "status-message error";
                } else {
                    alert("Invalid JSON file.");
                }
            }
        };
        reader.readAsText(file);
    });
    
    const elBtnClearData = document.getElementById('btn-clear-data');
    
    if (elBtnClearData) elBtnClearData.addEventListener('click', () => {
        if(confirm("Are you sure you want to delete all tags, ratings, bookmarks, and annotations? This cannot be undone.")) {
            state.metadata = { tags: {}, ratings: {}, bookmarks: {}, annotations: {} };
            saveMetadata();
            renderApp();
        }
    });

    // Keep Awake toggle listener
    const keepAwakeSetting = document.getElementById('setting-keep-awake');
    if (keepAwakeSetting) {
        keepAwakeSetting.addEventListener('change', (e) => {
            state.settings.keepAwake = e.target.checked;
            saveSettings();
            applyKeepAwake();
        });
    }

    // Timer Event Listeners
    const btnToggleTimerSetup = document.getElementById('btn-toggle-timer-setup');
    if (btnToggleTimerSetup) {
        btnToggleTimerSetup.addEventListener('click', () => {
            const popup = document.getElementById('timer-setup-popup');
            if (popup) popup.classList.toggle('hidden');
        });
    }

    const btnTimerStart = document.getElementById('btn-timer-start');
    if (btnTimerStart) btnTimerStart.addEventListener('click', startTimer);

    const btnTimerReset = document.getElementById('btn-timer-reset');
    if (btnTimerReset) btnTimerReset.addEventListener('click', resetTimer);

    const btnSidebarTimerPause = document.getElementById('btn-sidebar-timer-pause');
    if (btnSidebarTimerPause) btnSidebarTimerPause.addEventListener('click', startTimer);

    const btnSidebarTimerStop = document.getElementById('btn-sidebar-timer-stop');
    if (btnSidebarTimerStop) btnSidebarTimerStop.addEventListener('click', resetTimer);

    // Show in Folder button listener
    const btnShowExplorer = document.getElementById('btn-show-explorer');
    if (btnShowExplorer) {
        btnShowExplorer.addEventListener('click', async () => {
            if (!state.viewer.activeFile) return;
            
            const relativeFilePath = state.viewer.activeFile.path;
            const rootFolderName = state.directoryHandle ? state.directoryHandle.name : "";
            
            await triggerShowInExplorer(relativeFilePath, rootFolderName);
        });
    }

    // Delete Recipe button listener
    const btnDeleteRecipe = document.getElementById('btn-delete-recipe');
    if (btnDeleteRecipe) {
        btnDeleteRecipe.addEventListener('click', () => {
            if (!state.viewer.activeFile) return;
            showDeleteRecipeModal(state.viewer.activeFile);
        });
    }

    // Initialize Conversion Calculator
    initConverter();

    // Initialize High-Altitude Baking Adjuster
    initAltitudeAdjuster();
});

// ============================================================
// SECTION 12: Conversion Calculator
// ============================================================
function parseMixed(str) {
    if (!str) return { isRange: false, val: 0 };
    str = str.toString().trim().toLowerCase();
    if (str.includes(" to ")) {
        const parts = str.split(" to ");
        const start = parseSingleValue(parts[0]);
        const end = parseSingleValue(parts[1]);
        return { isRange: true, start, end, val: (start + end) / 2 };
    }
    return { isRange: false, val: parseSingleValue(str) };
}

function parseSingleValue(str) {
    str = str.trim();
    if (!str) return 0;
    const parts = str.split(/[\s-]+/);
    if (parts.length > 1) {
        let total = 0;
        for (const p of parts) {
            total += parseFraction(p);
        }
        return total;
    }
    return parseFraction(str);
}

function parseFraction(str) {
    if (str.includes("/")) {
        const fParts = str.split("/");
        if (fParts.length === 2) {
            const num = parseFloat(fParts[0]);
            const den = parseFloat(fParts[1]);
            if (!isNaN(num) && !isNaN(den) && den !== 0) {
                return num / den;
            }
        }
    }
    const val = parseFloat(str);
    return isNaN(val) ? 0 : val;
}

function parseBaseVolume(volumeStr) {
    const volLower = volumeStr.toLowerCase().trim();
    let cleanVol = volLower;
    if (volLower.includes("(")) {
        cleanVol = volLower.split("(")[0].trim();
    }
    const unitMatch = cleanVol.match(/(cups?|tablespoons?|teaspoons?|tbsp|tsp)/);
    if (!unitMatch) {
        return null;
    }
    const unit = unitMatch[0];
    const numStr = cleanVol.split(unit)[0].trim();
    const parsedNum = parseMixed(numStr);
    return { amount: parsedNum.val, unit };
}

function toTbsp(amount, unit) {
    const u = unit.toLowerCase();
    if (u.includes("cup")) {
        return amount * 16;
    } else if (u.includes("tablespoon") || u === "tbsp") {
        return amount;
    } else if (u.includes("teaspoon") || u === "tsp") {
        return amount / 3;
    }
    return 0;
}

function getWholeItemUnit(volumeStr) {
    const volLower = volumeStr.toLowerCase();
    if (volLower.includes("cup") || volLower.includes("tablespoon") || volLower.includes("teaspoon") || volLower.includes("tbsp") || volLower.includes("tsp")) {
        return null;
    }
    const match = volumeStr.match(/^\d+\s*(.*)$/);
    if (match && match[1]) {
        return match[1].trim();
    }
    return volumeStr.trim();
}

function getDisplayName(item) {
    if (typeof KA_INGREDIENTS === 'undefined') return item.name;
    const duplicates = KA_INGREDIENTS.filter(x => x.name === item.name);
    if (duplicates.length > 1) {
        let volDisplay = item.volume;
        volDisplay = volDisplay.replace("teaspoons", "tsp").replace("teaspoon", "tsp");
        volDisplay = volDisplay.replace("tablespoons", "tbsp").replace("tablespoon", "tbsp");
        return `${item.name} — ${volDisplay}`;
    }
    return item.name;
}

function formatVolume(tbspVal) {
    const cups = tbspVal / 16;
    const tsp = tbspVal * 3;
    const fractions = [
        { val: 0.25, label: "1/4 cup" },
        { val: 1/3, label: "1/3 cup" },
        { val: 0.5, label: "1/2 cup" },
        { val: 2/3, label: "2/3 cup" },
        { val: 0.75, label: "3/4 cup" },
        { val: 1.0, label: "1 cup" }
    ];
    
    let cupStr = "";
    if (cups >= 0.25) {
        const wholeCups = Math.floor(cups);
        const remainder = cups - wholeCups;
        if (remainder < 0.05) {
            cupStr = wholeCups > 0 ? `${wholeCups} cup${wholeCups > 1 ? 's' : ''}` : "";
        } else {
            let bestFraction = null;
            let minDiff = 0.05;
            for (const f of fractions) {
                const diff = Math.abs(remainder - f.val);
                if (diff < minDiff) {
                    minDiff = diff;
                    bestFraction = f;
                }
            }
            if (bestFraction) {
                if (wholeCups > 0) {
                    cupStr = `${wholeCups} ${bestFraction.label}`;
                } else {
                    cupStr = bestFraction.label;
                }
            } else {
                cupStr = `${cups.toFixed(2)} cups`;
            }
        }
    }
    
    if (tbspVal >= 16) {
        return `${cups.toFixed(2)} cups (${tbspVal.toFixed(2)} tablespoons)`;
    } else if (tbspVal >= 1) {
        if (cupStr) {
            return `${tbspVal.toFixed(2)} tablespoons (${cupStr})`;
        } else {
            return `${tbspVal.toFixed(2)} tablespoons`;
        }
    } else {
        return `${tsp.toFixed(2)} teaspoons`;
    }
}

function formatVolumeBreakdown(amount, unit) {
    let tbsp = 0;
    if (unit === 'cup') tbsp = amount * 16;
    else if (unit === 'tablespoon') tbsp = amount;
    else if (unit === 'teaspoon') tbsp = amount / 3;
    
    const cups = tbsp / 16;
    const teaspoons = tbsp * 3;
    return `${cups.toFixed(3)} cups / ${tbsp.toFixed(2)} tablespoons / ${teaspoons.toFixed(2)} teaspoons`;
}

function resetConverterPanel() {
    const panel = document.getElementById('converter-panel');
    if (panel) panel.classList.add('hidden');
    const searchInput = document.getElementById('converter-search-input');
    if (searchInput) searchInput.value = '';
    const amountInput = document.getElementById('converter-amount-input');
    if (amountInput) amountInput.value = '';
    const resultsContainer = document.getElementById('converter-results-container');
    if (resultsContainer) {
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
    }
    const resultsDiv = document.getElementById('converter-search-results');
    if (resultsDiv) resultsDiv.classList.add('hidden');
    if (state.converter) {
        state.converter.selectedIngredient = null;
    }
}

function initConverter() {
    const toggleBtn = document.getElementById('btn-toggle-converter');
    const closeBtn = document.getElementById('btn-close-converter');
    const panel = document.getElementById('converter-panel');
    const searchInput = document.getElementById('converter-search-input');
    const resultsDiv = document.getElementById('converter-search-results');
    const amountInput = document.getElementById('converter-amount-input');
    const unitSelect = document.getElementById('converter-unit-select');
    const runBtn = document.getElementById('btn-run-conversion');
    const resultsContainer = document.getElementById('converter-results-container');
    
    if (!toggleBtn || !panel || !searchInput || !resultsDiv || !amountInput || !unitSelect || !runBtn || !resultsContainer) return;
    
    // Create Fuse instance
    let fuse = null;
    if (typeof Fuse !== 'undefined' && typeof KA_INGREDIENTS !== 'undefined') {
        fuse = new Fuse(KA_INGREDIENTS, {
            keys: ['name'],
            threshold: 0.4
        });
    }
    
    toggleBtn.addEventListener('click', () => {
        const altPanel = document.getElementById('altitude-panel');
        if (altPanel) altPanel.classList.add('hidden');
        panel.classList.toggle('hidden');
        if (!panel.classList.contains('hidden')) {
            searchInput.focus();
        }
    });
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.classList.add('hidden');
        });
    }
    
    // Search Autocomplete
    searchInput.addEventListener('input', () => {
        const query = searchInput.value.trim();
        resultsDiv.innerHTML = '';
        if (!query || !fuse) {
            resultsDiv.classList.add('hidden');
            return;
        }
        
        const matches = fuse.search(query);
        if (matches.length === 0) {
            resultsDiv.classList.add('hidden');
            return;
        }
        
        matches.slice(0, 10).forEach(m => {
            const item = m.item;
            const div = document.createElement('div');
            div.className = 'converter-autocomplete-item';
            div.textContent = getDisplayName(item);
            div.addEventListener('click', () => {
                state.converter.selectedIngredient = item;
                searchInput.value = item.name;
                resultsDiv.classList.add('hidden');
                
                // Check if whole-item
                const wholeUnit = getWholeItemUnit(item.volume);
                if (wholeUnit) {
                    unitSelect.innerHTML = `<option value="${wholeUnit}">${wholeUnit}</option>`;
                    unitSelect.disabled = true;
                } else {
                    unitSelect.innerHTML = `
                        <option value="cup">cup</option>
                        <option value="tablespoon">tablespoon</option>
                        <option value="teaspoon">teaspoon</option>
                        <option value="gram">gram</option>
                        <option value="ounce">ounce</option>
                    `;
                    unitSelect.disabled = false;
                }
                amountInput.focus();
            });
            resultsDiv.appendChild(div);
        });
        
        resultsDiv.classList.remove('hidden');
    });
    
    // Close search dropdown on click outside
    document.addEventListener('click', (e) => {
        if (!e.target.closest('#converter-search-input') && !e.target.closest('#converter-search-results')) {
            resultsDiv.classList.add('hidden');
        }
    });
    
    // Calculate button
    runBtn.addEventListener('click', () => {
        const ingredient = state.converter.selectedIngredient;
        const amountStr = amountInput.value.trim();
        
        resultsContainer.innerHTML = '';
        resultsContainer.classList.add('hidden');
        
        if (!ingredient) {
            resultsContainer.innerHTML = '<div style="color:var(--color-danger); font-size:var(--text-sm);">Please select an ingredient.</div>';
            resultsContainer.classList.remove('hidden');
            return;
        }
        
        if (!amountStr || parseFloat(amountStr) <= 0) {
            resultsContainer.innerHTML = '<div style="color:var(--color-danger); font-size:var(--text-sm);">Please enter an amount.</div>';
            resultsContainer.classList.remove('hidden');
            return;
        }
        
        const inputAmount = parseFloat(amountStr);
        const inputUnit = unitSelect.value;
        
        const wholeUnit = getWholeItemUnit(ingredient.volume);
        
        const gramsInfo = parseMixed(ingredient.grams);
        const ouncesInfo = parseMixed(ingredient.ounces);
        const isRange = gramsInfo.isRange || ouncesInfo.isRange;
        
        let outputHtml = '';
        
        if (wholeUnit) {
            const baseCountMatch = ingredient.volume.match(/^\d+/);
            const baseCount = baseCountMatch ? parseInt(baseCountMatch[0], 10) : 1;
            const scale = inputAmount / baseCount;
            
            let gramsText = '';
            let ouncesText = '';
            
            if (gramsInfo.isRange) {
                const minG = gramsInfo.start * scale;
                const maxG = gramsInfo.end * scale;
                gramsText = `${minG.toFixed(1)}–${maxG.toFixed(1)}g`;
            } else {
                gramsText = `${(gramsInfo.val * scale).toFixed(1)}g`;
            }
            
            if (ouncesInfo.isRange) {
                const minOz = ouncesInfo.start * scale;
                const maxOz = ouncesInfo.end * scale;
                ouncesText = `${minOz.toFixed(2)}–${maxOz.toFixed(2)}oz`;
            } else {
                ouncesText = `${(ouncesInfo.val * scale).toFixed(2)}oz`;
            }
            
            outputHtml = `
                <div style="font-weight:700; font-size:var(--text-base); color:var(--color-primary); margin-bottom:8px;">${inputAmount} ${wholeUnit} =</div>
                <div style="font-size:var(--text-sm); color:var(--color-text); margin-bottom:4px;"><strong>Weight:</strong> ${gramsText} (${ouncesText})</div>
            `;
        } else {
            const baseVol = parseBaseVolume(ingredient.volume);
            if (!baseVol) {
                resultsContainer.innerHTML = '<div style="color:var(--color-danger); font-size:var(--text-sm);">Error: Could not parse base volume of ingredient.</div>';
                resultsContainer.classList.remove('hidden');
                return;
            }
            
            const baseTbsp = toTbsp(baseVol.amount, baseVol.unit);
            const isWeightInput = (inputUnit === 'gram' || inputUnit === 'ounce');
            
            if (isWeightInput) {
                let scale = 0;
                if (inputUnit === 'gram') {
                    scale = inputAmount / gramsInfo.val;
                } else {
                    scale = inputAmount / ouncesInfo.val;
                }
                
                const outputTbsp = baseTbsp * scale;
                const volString = formatVolume(outputTbsp);
                
                let gramsVal = gramsInfo.val * scale;
                let ouncesVal = ouncesInfo.val * scale;
                
                outputHtml = `
                    <div style="font-weight:700; font-size:var(--text-base); color:var(--color-primary); margin-bottom:8px;">${inputAmount} ${inputUnit}${inputAmount > 1 ? 's' : ''} =</div>
                    <div style="font-size:var(--text-sm); color:var(--color-text); margin-bottom:4px;"><strong>Volume:</strong> ${volString}</div>
                    <div style="font-size:var(--text-xs); color:var(--color-text-muted);">Equivalent to ${gramsVal.toFixed(1)}g (${ouncesVal.toFixed(2)}oz)</div>
                `;
            } else {
                const inputTbsp = toTbsp(inputAmount, inputUnit);
                const scale = inputTbsp / baseTbsp;
                
                let gramsText = '';
                let ouncesText = '';
                
                if (gramsInfo.isRange) {
                    const minG = gramsInfo.start * scale;
                    const maxG = gramsInfo.end * scale;
                    gramsText = `${minG.toFixed(1)}–${maxG.toFixed(1)}g`;
                } else {
                    gramsText = `${(gramsInfo.val * scale).toFixed(1)}g`;
                }
                
                if (ouncesInfo.isRange) {
                    const minOz = ouncesInfo.start * scale;
                    const maxOz = ouncesInfo.end * scale;
                    ouncesText = `${minOz.toFixed(2)}–${maxOz.toFixed(2)}oz`;
                } else {
                    ouncesText = `${(ouncesInfo.val * scale).toFixed(2)}oz`;
                }
                
                const breakdown = formatVolumeBreakdown(inputAmount, inputUnit);
                
                outputHtml = `
                    <div style="font-weight:700; font-size:var(--text-base); color:var(--color-primary); margin-bottom:8px;">${inputAmount} ${inputUnit}${inputAmount > 1 ? 's' : ''} =</div>
                    <div style="font-size:var(--text-sm); color:var(--color-text); margin-bottom:4px;"><strong>Weight:</strong> ${gramsText} (${ouncesText})</div>
                    <div style="font-size:var(--text-xs); color:var(--color-text-muted); margin-bottom:4px;"><strong>Breakdown:</strong> ${breakdown}</div>
                `;
            }
        }
        
        if (isRange) {
            outputHtml += `
                <div style="margin-top:8px; padding-top:8px; border-top:1px dashed var(--color-border); font-size:10px; color:var(--color-text-muted); line-height:1.3;">
                    Note: Volume-to-weight conversions for fresh produce or non-standardized ingredients are approximate due to variable density (e.g., moisture content, size variation, packing tightness).
                </div>
            `;
        }
        
        resultsContainer.innerHTML = outputHtml;
        resultsContainer.classList.remove('hidden');
    });
}

// ============================================================
// SECTION 13: High-Altitude Baking Adjuster
// ============================================================
// DATA_SOURCE: King Arthur Baking — High-Altitude Baking
// URL: https://www.kingarthurbaking.com/learn/resources/high-altitude-baking
// DATA_VERSION: June 2026
// Additional references cited by KA:
//   - Colorado State University Extension
//   - New Mexico State University Extension

const GENERAL_ADJUSTMENTS = [
  {
    what: "Oven Temperature",
    how: {
      all: "Increase 15°F to 25°F",
      note: "Use the lower increase (15°F) for chocolate or delicate cakes."
    },
    why: "Higher temperature sets structure before baked goods over-expand and dry out."
  },
  {
    what: "Baking Time",
    how: { all: "Decrease by 5 to 8 minutes per 30 minutes of baking time." },
    why: "Higher temperatures mean products are done sooner."
  },
  {
    what: "Sugar",
    how: { all: "Decrease by 1 tablespoon per cup of sugar called for." },
    why: "Increased evaporation concentrates sugar, weakening structure. Less sugar supports better structure."
  },
  {
    what: "Liquid",
    how: {
      "3000-5000": "Increase by 1 to 2 tablespoons.",
      "5000-6500": "Increase by 1 to 2 tablespoons, plus 1½ tsp per additional 1,000 ft above 3,000 ft.",
      "6500-8000": "Increase by 1 to 2 tablespoons, plus 1½ tsp per additional 1,000 ft above 3,000 ft.",
      note: "Extra eggs can count toward this liquid increase depending on the recipe."
    },
    why: "Extra liquid prevents products from drying out at higher evaporation rates."
  },
  {
    what: "Flour",
    how: {
      "3000-5000": "At 3,500 ft: add 1 extra tablespoon per recipe.",
      "5000-6500": "Add 1 extra tablespoon per recipe plus 1 more for each additional 1,500 ft.",
      "6500-8000": "Add 1 extra tablespoon per recipe plus 1 more for each additional 1,500 ft (up to ~2 extra tablespoons).",
      note: "A flour with higher protein content may also yield better results in some recipes."
    },
    why: "Additional flour strengthens the structure of baked goods."
  },
  {
    what: "Leaveners (Baking Powder / Baking Soda)",
    how: { all: "Decrease — see leavener chart below." },
    why: "Baked goods rise more quickly at altitude; less leavener is needed."
  }
];

const LEAVENER_CHART = [
  { original: "1 tsp",       "3000-5000": "7/8 tsp",     "5000-6500": "1/2 tsp",     "6500-8000": "1/4 tsp"  },
  { original: "1½ tsp",      "3000-5000": "1¼ tsp",      "5000-6500": "3/4 tsp",     "6500-8000": "1/2 tsp"  },
  { original: "2 tsp",       "3000-5000": "1½ tsp",      "5000-6500": "1 tsp",       "6500-8000": "3/4 tsp"  },
  { original: "2½ tsp",      "3000-5000": "1¾ tsp",      "5000-6500": "1¼ tsp",      "6500-8000": "1 tsp"    },
  { original: "3 tsp",       "3000-5000": "2 tsp",       "5000-6500": "1¼ tsp",      "6500-8000": "1 tsp"    },
  { original: "3½ tsp",      "3000-5000": "2½ tsp",      "5000-6500": "1½ tsp",      "6500-8000": "1 tsp"    },
  { original: "4 tsp",       "3000-5000": "2½ tsp",      "5000-6500": "1½ tsp",      "6500-8000": "1 tsp"    },
];

const COOKIE_ADJUSTMENTS = [
  { what: "Oven Temperature",   how: "Increase 15°F to 25°F.", why: "Sets cookie structure before they spread too much." },
  { what: "Baking Time",        how: "Decrease by 1 to 2 minutes per 10 minutes of baking time.", why: "Higher temp means cookies are done sooner." },
  { what: "Sugar",              how: "Decrease by 1 tablespoon per cup.", why: "Prevents over-weakening of structure from concentrated sugar." },
  { what: "Liquid",             how: { "3000-5000": "Increase by 1–2 tbsp.", "5000-6500": "Increase by 1–2 tbsp + 1½ tsp per additional 1,000 ft.", "6500-8000": "Increase by 1–2 tbsp + 1½ tsp per additional 1,000 ft." }, why: "Prevents drying out." },
  { what: "Flour",              how: { "3000-5000": "Add 1 tbsp at 3,500 ft.", "5000-6500": "Add 1 tbsp plus 1 more per 1,500 ft.", "6500-8000": "Add 1 tbsp plus 1 more per 1,500 ft." }, why: "Strengthens structure, reduces spread." },
  { what: "Leaveners",          how: "Decrease — see leavener chart.", why: "Cookies rise faster at altitude." },
  { what: "Chilling Time",      how: "Chill dough 30 minutes to 2 hours before baking.", why: "Solidifies fat, helps prevent excessive spreading." },
  { what: "Spreading",          how: "Note: cookies may spread more and turn out thinner. Higher temp + shorter time helps.", why: "Reduced air pressure increases spread rate." },
];

const BREAD_ADJUSTMENTS = [
  { what: "Yeast",              how: "Decrease yeast by 25%.", why: "Reduced air pressure makes dough rise much faster; less yeast slows proofing time." },
  { what: "Water Temperature",  how: "Use slightly colder water than usual.", why: "Lower Desired Dough Temperature (DDT) slows fermentation and overall rise time." },
  { what: "Liquid",             how: "Increase liquid as needed to prevent dry dough.", why: "Conditions at altitude are much drier." },
  { what: "Extra Rise",         how: "Punch dough down twice before forming — give it one extra rise.", why: "Helps develop flavor lost during faster fermentation." },
  { what: "First Rise",         how: "Consider placing dough in the refrigerator for its first rise.", why: "Slows yeast action; gives dough more time to develop flavor." },
  { what: "Flavor Enhancement", how: "Replace up to 25% of the liquid with sourdough starter. If no starter is available, make a quick sponge (yeast + liquid + 1–2 cups flour), refrigerate for a few hours before proceeding.", why: "Quicker fermentation at altitude can result in bland bread; this compensates." },
  { what: "Flour Type",         how: "Consider using high-protein bread flour.", why: "Provides additional strength and structure to bread and pizza dough." },
  { what: "Bowl Size",          how: "Make sure the bowl has plenty of room for the dough to rise.", why: "Faster rise at altitude requires extra headroom." },
];

const PIE_ADJUSTMENTS = [
  { what: "Pie Crust — Liquid",     how: "Add extra water as needed to bring dough together.", why: "Drier conditions at altitude mean pie dough may need more water to roll smoothly. Add a little at a time to avoid tough or soggy crust." },
  { what: "Fruit Pie — Bake Time",  how: "Bake fruit pies longer than sea-level recipes indicate.", why: "Lower boiling point at altitude means fillings take longer to fully thicken and set." },
  { what: "Fruit Pie — Thickener",  how: "Slightly increase pie filling thickener (flour, cornstarch, or Instant ClearJel).", why: "Helps filling set despite lower boiling point." },
  { what: "Pie Crust (general)",    how: "No significant structural adjustments needed — crust is low in moisture.", why: "Low moisture content makes crust relatively altitude-resilient." },
];

const CAKE_ADJUSTMENTS = [
  { what: "Sugar",            how: "Decrease per general guidelines.", why: "Prevents structure collapse from concentrated sugar during the faster rise." },
  { what: "Liquid",           how: "Increase per general guidelines. Prefer extra eggs to add liquid; if only a partial egg is needed, use the white.", why: "Altitude causes faster evaporation; cakes can turn out too dry without extra liquid." },
  { what: "Pan Prep",         how: "Thoroughly coat pans with non-stick spray and line with parchment paper.", why: "Baked goods stick to pans significantly more at higher elevations." },
  { what: "Egg White Cakes (Chiffon, Angel Food)", how: "Whip egg whites to soft peaks only — not stiff peaks.", why: "Air trapped in the whites continues to expand during baking; stiff peaks can cause over-expansion and collapse." },
  { what: "Leaveners",        how: "Decrease per leavener chart.", why: "Cakes rise too fast at altitude, which can cause collapse." },
];

const QUICK_BREAD_ADJUSTMENTS = [
  { what: "General",  how: "Apply the general high-altitude baking guidelines above.", why: "Quick breads are resilient at altitude and don't require many special adjustments beyond the standard ones." },
];

const FRIED_DOUGH_ADJUSTMENTS = [
  { what: "Frying Temperature", how: "Lower frying temperature by 3°F per 1,000 feet of altitude.", why: "Oil behaves differently at altitude; this prevents over-browning before the interior is cooked through." },
  { what: "Cooking Time",       how: "Increase cooking time accordingly.", why: "Lower frying temperature means slower cook-through." },
];

function resetAltitudePanel() {
    const panel = document.getElementById('altitude-panel');
    if (panel) panel.classList.add('hidden');
    
    // Deselect active bands
    const bandButtons = document.querySelectorAll('.btn-alt-band');
    bandButtons.forEach(btn => btn.classList.remove('active'));
    
    const content = document.getElementById('altitude-content');
    if (content) {
        content.innerHTML = `
            <div id="altitude-placeholder" style="padding:24px 12px; text-align:center; color:var(--color-text-muted); font-size:var(--text-sm);">
                Select your altitude range above to see adjustments.
            </div>
        `;
    }
}

function initAltitudeAdjuster() {
    const toggleBtn = document.getElementById('btn-toggle-altitude');
    const closeBtn = document.getElementById('btn-close-altitude');
    const panel = document.getElementById('altitude-panel');
    const converterPanel = document.getElementById('converter-panel');
    const contentDiv = document.getElementById('altitude-content');
    
    if (!toggleBtn || !panel || !contentDiv) return;
    
    toggleBtn.addEventListener('click', () => {
        if (converterPanel) converterPanel.classList.add('hidden');
        panel.classList.toggle('hidden');
    });
    
    if (closeBtn) {
        closeBtn.addEventListener('click', () => {
            panel.classList.add('hidden');
        });
    }
    
    // Bind Selector Buttons
    const bandButtons = document.querySelectorAll('.btn-alt-band');
    bandButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            const isActive = btn.classList.contains('active');
            bandButtons.forEach(b => b.classList.remove('active'));
            
            if (isActive) {
                // Toggle off
                contentDiv.innerHTML = `
                    <div id="altitude-placeholder" style="padding:24px 12px; text-align:center; color:var(--color-text-muted); font-size:var(--text-sm);">
                        Select your altitude range above to see adjustments.
                    </div>
                `;
            } else {
                // Toggle on
                btn.classList.add('active');
                const band = btn.dataset.band;
                renderAltitudeContent(band);
            }
        });
    });
}

function renderAltitudeContent(band) {
    const contentDiv = document.getElementById('altitude-content');
    if (!contentDiv) return;
    
    // 1. General Adjustments
    let generalHtml = `
        <h4 style="margin:8px 0 8px 0; font-size:var(--text-sm); color:var(--color-text); text-align:left;">General Baking Adjustments</h4>
        <table class="altitude-table">
            <thead>
                <tr>
                    <th style="width:30%;">Adjustment</th>
                    <th style="width:40%;">Recommended Change</th>
                    <th style="width:30%;">Why</th>
                </tr>
            </thead>
            <tbody>
    `;
    
    GENERAL_ADJUSTMENTS.forEach(item => {
        const changeText = getGeneralHowText(item.how, band);
        generalHtml += `
            <tr>
                <td><strong>${item.what}</strong></td>
                <td>${changeText}</td>
                <td>${item.why}</td>
            </tr>
        `;
    });
    
    generalHtml += `
            </tbody>
        </table>
    `;
    
    // 2. Leavener Reduction Chart
    const leavenerHtml = renderLeavenerChart(band);
    
    // 3. Specific Adjustments Accordions
    const specificHeader = `
        <h4 style="margin:24px 0 12px 0; font-size:var(--text-sm); color:var(--color-text); text-align:left; border-top:1px solid var(--color-border); padding-top:16px;">Specific Adjustments by Baked Good</h4>
    `;
    
    const cookiesAccordion = createAccordion("cookies", "🍪 Cookies", renderSpecificAdjustments(COOKIE_ADJUSTMENTS, band));
    const breadAccordion = createAccordion("bread", "🍞 Yeast Bread, Sourdough & Pizza", renderSpecificAdjustments(BREAD_ADJUSTMENTS, band));
    const pieAccordion = createAccordion("pie", "🥧 Pie", renderSpecificAdjustments(PIE_ADJUSTMENTS, band));
    const cakeAccordion = createAccordion("cake", "🎂 Cake", renderSpecificAdjustments(CAKE_ADJUSTMENTS, band));
    const quickBreadAccordion = createAccordion("quickbread", "🍌 Quick Breads", renderSpecificAdjustments(QUICK_BREAD_ADJUSTMENTS, band));
    const friedDoughAccordion = createAccordion("frieddough", "🍩 Doughnuts & Fried Doughs", renderSpecificAdjustments(FRIED_DOUGH_ADJUSTMENTS, band));
    
    contentDiv.innerHTML = generalHtml + leavenerHtml + specificHeader + cookiesAccordion + breadAccordion + pieAccordion + cakeAccordion + quickBreadAccordion + friedDoughAccordion;
    
    // Bind accordion headers
    contentDiv.querySelectorAll('.altitude-accordion-header').forEach(header => {
        header.addEventListener('click', () => {
            const accordion = header.closest('.altitude-accordion');
            accordion.classList.toggle('open');
        });
    });
}

function getGeneralHowText(how, band) {
    let text = "";
    if (how.all) {
        text = how.all;
    } else {
        text = how[band] || "";
    }
    if (how.note) {
        text += `<br><span style="font-size:10px; color:var(--color-text-muted); display:block; margin-top:4px;">* ${how.note}</span>`;
    }
    return text;
}

function renderLeavenerChart(band) {
    let html = `
        <h4 style="margin:16px 0 8px 0; font-size:var(--text-sm); color:var(--color-text); text-align:left;">Leavener Reduction Chart</h4>
        <table class="altitude-table">
            <thead>
                <tr>
                    <th>Original</th>
                    <th class="${band === '3000-5000' ? 'active-col' : ''}">3k–5k ft</th>
                    <th class="${band === '5000-6500' ? 'active-col' : ''}">5k–6.5k ft</th>
                    <th class="${band === '6500-8000' ? 'active-col' : ''}">6.5k–8k ft</th>
                </tr>
            </thead>
            <tbody>
    `;
    LEAVENER_CHART.forEach(row => {
        html += `
            <tr>
                <td><strong>${row.original}</strong></td>
                <td class="${band === '3000-5000' ? 'active-col' : ''}">${row["3000-5000"]}</td>
                <td class="${band === '5000-6500' ? 'active-col' : ''}">${row["5000-6500"]}</td>
                <td class="${band === '6500-8000' ? 'active-col' : ''}">${row["6500-8000"]}</td>
            </tr>
        `;
    });
    html += `
            </tbody>
        </table>
        <div class="altitude-callout">
            💡 <em>Tip: When a recipe calls for both baking powder and baking soda along with an acidic ingredient (such as buttermilk or sour cream), try switching to all baking powder and regular milk.</em>
        </div>
    `;
    return html;
}

function getSpecificHowText(how, band) {
    if (typeof how === 'string') {
        return how;
    }
    return how[band] || "";
}

function renderSpecificAdjustments(list, band) {
    let html = "";
    list.forEach(item => {
        const howText = getSpecificHowText(item.how, band);
        html += `
            <div class="altitude-row">
                <div style="font-weight:700; color:var(--color-primary); margin-bottom:2px;">${item.what}</div>
                <div style="color:var(--color-text); margin-bottom:2px;"><strong>Adjustment:</strong> ${howText}</div>
                <div style="color:var(--color-text-muted); font-size:11px;"><strong>Why:</strong> ${item.why}</div>
            </div>
        `;
    });
    return html;
}

function createAccordion(id, title, content) {
    return `
        <div class="altitude-accordion" id="accordion-${id}">
            <div class="altitude-accordion-header">${title}</div>
            <div class="altitude-accordion-content">${content}</div>
        </div>
    `;
}

let autoBackupTimeout = null;

function scheduleAutoBackup() {
    if (autoBackupTimeout) {
        clearTimeout(autoBackupTimeout);
    }
    autoBackupTimeout = setTimeout(runAutoBackup, 2000);
}

async function runAutoBackup() {
    if (!state.directoryHandle) return;
    try {
        const permission = await state.directoryHandle.queryPermission({ mode: 'readwrite' });
        if (permission !== 'granted') return;

        const backupData = {
            tags: state.metadata.tags || {},
            ratings: state.metadata.ratings || {},
            bookmarks: state.metadata.bookmarks || {},
            annotations: state.metadata.annotations || {}
        };

        const fileHandle = await state.directoryHandle.getFileHandle('kitchenvault_backup.json', { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(backupData, null, 2));
        await writable.close();
        console.log("Auto-backup saved to kitchenvault_backup.json successfully!");
    } catch (e) {
        console.error("Failed to save automatic backup:", e);
    }
}

// ============================================================
// SECTION: Show in Folder Helper Integration
// ============================================================

async function detectPlatform() {
    const ua = navigator.userAgent.toLowerCase();
    const REPO_BASE = "https://raw.githubusercontent.com/marcel-gaida/five_sugar/1deb823cf1f532bb514ed8c0a7a79a852b52a509/KitchenVault/bin/";
    
    if (ua.includes('win')) {
        return { os: 'windows', filename: 'kitchenvault_host_windows.exe', downloadUrl: REPO_BASE + 'kitchenvault_host-windows-386.exe' };
    }
    if (ua.includes('linux')) {
        return { os: 'linux', filename: 'kitchenvault_host_linux', downloadUrl: REPO_BASE + 'kitchenvault_host-linux-amd64' };
    }
    if (ua.includes('mac')) {
        let arch = 'amd64'; // fallback
        if (navigator.userAgentData && navigator.userAgentData.getHighEntropyValues) {
            try {
                const values = await navigator.userAgentData.getHighEntropyValues(["architecture"]);
                if (values.architecture === "arm") {
                    arch = "arm64";
                }
            } catch (e) {}
        }
        return { os: 'mac', filename: 'kitchenvault_host_mac', downloadUrl: REPO_BASE + 'kitchenvault_host-darwin-' + arch };
    }
    return null;
}

function showStatus(msg, type) {
    let statusEl = document.getElementById('show-in-folder-status');
    if (!statusEl) {
        statusEl = document.createElement('div');
        statusEl.id = 'show-in-folder-status';
        statusEl.style.fontSize = 'var(--text-xs)';
        statusEl.style.marginTop = '4px';
        const container = document.getElementById('label-setting-show-in-folder')?.parentElement;
        if (container) container.appendChild(statusEl);
    }
    statusEl.textContent = msg;
    statusEl.style.color = type === 'error' ? 'var(--color-danger)' : 'var(--color-text-muted)';
}

function showHelperConsentModal(onConfirm) {
    const container = document.createElement('div');
    container.id = 'kv-consent-modal-container';
    const shadow = container.attachShadow({mode: 'open'});

    const style = document.createElement('style');
    style.textContent = `
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 999999; display: flex; align-items: center; justify-content: center; }
        .modal { background: #fff; border-radius: 8px; width: 450px; max-width: 90vw; padding: 20px; font-family: system-ui, sans-serif; color: #333; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .modal-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 12px; }
        .modal-body { font-size: 0.95rem; line-height: 1.5; margin-bottom: 20px; }
        .modal-body ul { margin-top: 8px; margin-bottom: 12px; padding-left: 20px; }
        .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
        button { padding: 8px 16px; border-radius: 4px; font-size: 0.95rem; cursor: pointer; border: none; }
        .btn-cancel { background: #f1f1f1; color: #333; }
        .btn-primary { background: #2c5e43; color: white; }
    `;
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-title">"Show in Folder" needs a small helper</div>
        <div class="modal-body">
            <p>To show recipe files in your computer's folder, Kitchen Vault needs to install a small helper program (~7MB) on your computer.</p>
            <p>Here is exactly what it does:</p>
            <ul>
                <li>Downloads one file from Kitchen Vault's GitHub page</li>
                <li>Saves it inside your recipe vault folder (in a hidden .kv subfolder)</li>
                <li>Registers itself with Chrome so the two can talk</li>
                <li>Opens your file manager when you click "Show in Folder"</li>
            </ul>
            <p>It does NOT:</p>
            <ul>
                <li>Access the internet after the initial download</li>
                <li>Read any files other than the ones you ask it to open</li>
                <li>Require admin/administrator rights</li>
                <li>Run in the background or at startup</li>
            </ul>
            <p>You can remove it at any time by turning this setting off.</p>
        </div>
        <div class="modal-actions">
            <button class="btn-cancel">Cancel</button>
            <button class="btn-primary">Install Helper</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    shadow.appendChild(overlay);
    document.body.appendChild(container);

    const dismiss = () => container.remove();

    shadow.querySelector('.btn-cancel').addEventListener('click', dismiss);
    shadow.querySelector('.btn-primary').addEventListener('click', () => {
        dismiss();
        onConfirm();
    });
}

function showRegistrationModal(platform) {
    const container = document.createElement('div');
    container.id = 'kv-registration-modal-container';
    const shadow = container.attachShadow({mode: 'open'});

    const style = document.createElement('style');
    style.textContent = `
        .modal-overlay { position: fixed; inset: 0; background: rgba(0,0,0,0.5); z-index: 999999; display: flex; align-items: center; justify-content: center; }
        .modal { background: #fff; border-radius: 8px; width: 450px; max-width: 90vw; padding: 20px; font-family: system-ui, sans-serif; color: #333; box-shadow: 0 4px 12px rgba(0,0,0,0.2); }
        .modal-title { font-size: 1.2rem; font-weight: 600; margin-bottom: 12px; }
        .modal-body { font-size: 0.95rem; line-height: 1.5; margin-bottom: 20px; }
        .modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
        button { padding: 8px 16px; border-radius: 4px; font-size: 0.95rem; cursor: pointer; border: none; }
        .btn-cancel { background: #f1f1f1; color: #333; }
        .btn-primary { background: #2c5e43; color: white; }
    `;
    shadow.appendChild(style);

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    
    const modal = document.createElement('div');
    modal.className = 'modal';
    modal.innerHTML = `
        <div class="modal-title">One last step</div>
        <div class="modal-body">
            <p>The helper was downloaded successfully. To finish setup, you need to run it once so it can register with Chrome.</p>
            <p>Click the button below — your browser will download a tiny setup file. Open it to complete the installation. You only need to do this once.</p>
        </div>
        <div class="modal-actions">
            <button class="btn-cancel">Close</button>
            <button class="btn-primary">Run Setup</button>
        </div>
    `;
    
    overlay.appendChild(modal);
    shadow.appendChild(overlay);
    document.body.appendChild(container);

    const dismiss = () => container.remove();

    shadow.querySelector('.btn-cancel').addEventListener('click', dismiss);
    shadow.querySelector('.btn-primary').addEventListener('click', () => {
        dismiss();
        triggerRegistrationDownload(platform, state.settings.resolvedAbsolutePath);
    });
}

function triggerRegistrationDownload(platform, absolutePath) {
    let scriptContent = "";
    let filename = "";

    if (platform.os === 'windows') {
        let exePath = "%~dp0kitchenvault_host_windows.exe";
        if (absolutePath) {
            exePath = absolutePath + "\\.kv\\kitchenvault_host_windows.exe";
        }
        scriptContent = `@echo off\r\n"${exePath}" --install\r\necho Done! You can close this window.\r\npause\r\n`;
        filename = "install_kitchenvault_helper.bat";
    } else {
        let exePath = "$DIR/kitchenvault_host_mac";
        if (absolutePath) {
            exePath = absolutePath + "/.kv/kitchenvault_host_mac";
        }
        scriptContent = `#!/bin/bash\nDIR="$(cd "$(dirname "$0")" && pwd)"\n"${exePath}" --install\necho "Done!"\n`;
        if (platform.os === 'linux') scriptContent = scriptContent.replace(/_mac/g, '_linux');
        filename = "install_kitchenvault_helper.sh";
    }

    const blob = new Blob([scriptContent], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function promptUserToRegister(platform, kvFolder) {
    showRegistrationModal(platform);
}

async function installShowInFolderHelper() {
    const platform = await detectPlatform();
    if (!platform) {
        showStatus('Your operating system was not recognized.', 'error');
        return false;
    }

    try {
        if (!state.directoryHandle) {
            showStatus('Please select a folder first.', 'error');
            return false;
        }

        const kvFolder = await state.directoryHandle.getDirectoryHandle('.kv', { create: true });
        
        showStatus('Downloading helper from GitHub...', 'info');
        
        let fileExists = false;
        try {
            await kvFolder.getFileHandle(platform.filename);
            fileExists = true;
        } catch (e) {}

        if (!fileExists) {
            try {
                const response = await fetch(platform.downloadUrl);
                if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
                
                const blob = await response.blob();
                const fileHandle = await kvFolder.getFileHandle(platform.filename, { create: true });
                const writable = await fileHandle.createWritable();
                await writable.write(blob);
                await writable.close();
                console.log(`Downloaded ${platform.filename} successfully.`);
            } catch (err) {
                console.error("Download failed:", err);
                showStatus('Download failed: ' + err.message, 'error');
                return false;
            }
        }

        showStatus('Helper downloaded successfully!', 'success');
        await promptUserToRegister(platform, kvFolder);
        return true;

    } catch (err) {
        showStatus('Helper install failed: ' + err.message, 'error');
        return false;
    }
}

async function checkHelperStatus() {
    const toggle = document.getElementById('setting-show-in-folder');
    const labelText = document.getElementById('text-setting-show-in-folder');
    const btnShowExplorer = document.getElementById('btn-show-explorer');

    if (!state.directoryHandle || !toggle) return;
    
    let binaryExists = false;
    const platform = await detectPlatform();
    if (platform) {
        try {
            const kvFolder = await state.directoryHandle.getDirectoryHandle('.kv');
            await kvFolder.getFileHandle(platform.filename);
            binaryExists = true;
        } catch(e) {}
    }

    if (binaryExists) {
        toggle.disabled = false;
        labelText.textContent = "Show in Folder (Helper available)";
        
        chrome.runtime.sendNativeMessage('kitchenvault_host', { action: 'ping' }, (response) => {
            if (chrome.runtime.lastError || !response || response.status !== 'ok') {
                showStatus("Helper found but not registered. Please toggle to setup.", 'error');
                state.settings.showInFolderEnabled = false;
                saveSettings();
                toggle.checked = false;
                if (btnShowExplorer) btnShowExplorer.style.display = 'none';
            } else {
                showStatus("", '');
                if (state.settings.showInFolderEnabled) {
                    toggle.checked = true;
                    if (btnShowExplorer) btnShowExplorer.style.display = 'inline-block';
                } else {
                    toggle.checked = false;
                    if (btnShowExplorer) btnShowExplorer.style.display = 'none';
                }
            }
        });
    } else {
        toggle.checked = false;
        toggle.disabled = false;
        labelText.textContent = "Requires helper — click to set up";
        if (btnShowExplorer) btnShowExplorer.style.display = 'none';
        state.settings.showInFolderEnabled = false;
        saveSettings();
    }
}

document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.getElementById('setting-show-in-folder');
    if (toggle) {
        toggle.addEventListener('change', async (e) => {
            if (e.target.checked) {
                e.target.checked = false; 
                showHelperConsentModal(async () => {
                    const success = await installShowInFolderHelper();
                    if (success) {
                        state.settings.showInFolderEnabled = true;
                        saveSettings();
                        checkHelperStatus();
                    }
                });
            } else {
                state.settings.showInFolderEnabled = false;
                saveSettings();
                checkHelperStatus();
            }
        });
    }
    
    const btnShowExplorer = document.getElementById('btn-show-explorer');
    if (btnShowExplorer) {
        const newBtn = btnShowExplorer.cloneNode(true);
        btnShowExplorer.parentNode.replaceChild(newBtn, btnShowExplorer);
        
        newBtn.addEventListener('click', async () => {
            if (!state.viewer.activeFile) return;
            if (!state.settings.showInFolderEnabled) return;
            
            const relativeFilePath = state.viewer.activeFile.path;
            const fullPath = state.settings.resolvedAbsolutePath 
                ? state.settings.resolvedAbsolutePath + (state.settings.resolvedAbsolutePath.includes('\\') ? '\\' : '/') + relativeFilePath
                : relativeFilePath;
            
            chrome.runtime.sendNativeMessage('kitchenvault_host', { 
                action: 'open_in_folder', 
                path: fullPath
            }, (response) => {
                if (chrome.runtime.lastError) {
                    console.error("Native error:", chrome.runtime.lastError);
                }
            });
        });
    }
});

const originalScanDirectoryForHelper = scanDirectory;
scanDirectory = async function() {
    await originalScanDirectoryForHelper();
    await checkHelperStatus();
};
