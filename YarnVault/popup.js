/**
 * Yarn Vault — popup.js
 * Main application logic for the Yarn Vault Chrome Extension.
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
        firstLoadCompleted: false
    },
    searchQuery: '',
    filters: { type: 'all', rating: '0' },
    sortBy: 'name-asc',
    viewer: {
        activeFile: null,
        pdfDoc: null,
        pageNum: 1,
        zoom: 1
    }
};

const DEFAULT_TAG_COLORS = ["#c0622d","#d4915e","#6b9e6b","#7a9abf","#b07a8a","#c4a020","#7b6ea0","#5f8c78"];
const PREDEFINED_TAGS = [
    { label: "Sea Creatures", color: "#c0622d", isDefault: true },
    { label: "Food", color: "#d4915e", isDefault: true },
    { label: "Animals", color: "#6b9e6b", isDefault: true },
    { label: "Holiday", color: "#7a9abf", isDefault: true },
    { label: "Amigurumi", color: "#b07a8a", isDefault: true },
    { label: "Clothing", color: "#c4a020", isDefault: true },
    { label: "Accessories", color: "#7b6ea0", isDefault: true },
    { label: "Movie/TV", color: "#5f8c78", isDefault: true },
    { label: "Fantasy", color: "#c0622d", isDefault: true },
    { label: "Beginner", color: "#d4915e", isDefault: true },
    { label: "Advanced", color: "#6b9e6b", isDefault: true },
    { label: "Favorite", color: "#7a9abf", isDefault: true }
];
const ALLOWED_EXTS = ['.pdf', '.jpg', '.jpeg', '.png', '.webp', '.gif'];

// Setup PDF.js worker
if (typeof pdfjsLib !== 'undefined') {
    pdfjsLib.GlobalWorkerOptions.workerSrc = './pdf.worker.min.js';
}

/** Load Storage function. */
async function loadStorage() {
    return new Promise((resolve) => {
        chrome.storage.local.get(null, (data) => {
            if (data.metadata) state.metadata = data.metadata;
            if (data.settings) {
                state.settings = { ...state.settings, ...data.settings };
            }
            if (data.tagLibrary) {
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
      const req = indexedDB.open('YarnVaultDB', 2);
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
        const handle = await window.showDirectoryPicker({ mode: 'read' });
        state.directoryHandle = handle;
        chrome.storage.local.set({ prevFolderName: handle.name });
        await saveHandle(handle);
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
                        type: ext === '.pdf' ? 'pdf' : 'image',
                        parentPath: currentPath
                    });
                }
            } else if (entry.kind === 'directory') {
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
        
        state.currentPath = state.directoryHandle.name; // start at root
        scanComplete = true;
        
        showAppShell();
        renderApp();
        // Show indexing prompt if first time
        if (!state.settings.firstLoadCompleted) {
            const promptEl = document.getElementById('indexing-prompt');
            const countEl = document.getElementById('prompt-file-count');
            if (promptEl) promptEl.classList.remove('hidden');
            if (countEl) countEl.textContent = 'Found ' + state.files.length + ' patterns.';
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
    
    state.folders.forEach(folder => {
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
        const q = state.searchQuery.toLowerCase();
        files = files.filter(f => {
            const matchName = f.name.toLowerCase().includes(q);
            const matchPath = f.parentPath.toLowerCase().includes(q);
            const tags = state.metadata.tags[f.path] || [];
            const matchTags = tags.some(t => t.toLowerCase().includes(q));
            return matchName || matchPath || matchTags;
        });
    } else {
        // Current folder only
        files = files.filter(f => f.parentPath === state.currentPath);
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
    
    // Update Bookmarks
    const bookmarks = state.metadata.bookmarks[path] || [];
    const metaEl = card.querySelector('.card-meta');
    if (metaEl) {
        const oldBadge = metaEl.querySelector('.badge');
        if (oldBadge) oldBadge.remove();
        if (bookmarks.length) {
            metaEl.insertAdjacentHTML('beforeend', `<div class="badge">${bookmarks.length}</div>`);
        }
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

        const hlName = highlightText(displayName, state.searchQuery);
        
        const placeholderSvg = `data:image/svg+xml;charset=UTF-8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='100%25' height='100%25' viewBox='0 0 100 100'%3E%3Crect width='100' height='100' fill='%23f5ece0'/%3E%3Ctext x='50' y='55' font-size='30' text-anchor='middle' fill='%238a6e5c'%3E%F0%9F%93%84%3C/text%3E%3C/svg%3E`;
        
        card.innerHTML = `
            <img class="card-thumb" data-path="${f.path}" src="${placeholderSvg}">
            <div class="card-footer">
                <div class="card-name" title="${displayName}">${hlName}</div>
                <div class="card-meta">
                    <div class="star-rating card-rating">${starsHtml}</div>
                    ${bookmarks.length ? `<div class="badge">${bookmarks.length}</div>` : ''}
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
    const regex = new RegExp(`(${query.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')})`, 'gi');
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
        state.viewer.zoom = 1;
    } else {
        state.viewer.zoom = Math.max(0.25, Math.min(4, state.viewer.zoom + delta));
    }
    const img = document.getElementById('image-view');
    if (img) img.style.transform = `scale(${state.viewer.zoom})`;
    const resetBtn = document.getElementById('btn-zoom-reset');
    if (resetBtn) resetBtn.textContent = Math.round(state.viewer.zoom * 100) + '%';
}



// ============================================================
// SECTION 6: File Viewer (openViewer, renderPdfPage, closeViewer)
// ============================================================
/** Open Viewer function. */
async function openViewer(fileObj) {
    state.viewer.activeFile = fileObj;
    state.viewer.zoom = 1;
    
    renderViewerHeader();
    renderViewerTags();
    renderBookmarks();
    
    document.getElementById('pdf-controls').classList.add('hidden');
    document.getElementById('image-controls').classList.add('hidden');
    document.getElementById('pdf-canvas').classList.add('hidden');
    document.getElementById('image-view').classList.add('hidden');
    
    const overlay = document.getElementById('panel-overlay');
    if (overlay) { overlay.classList.remove('hidden'); overlay.classList.add('visible'); }
    document.getElementById('viewer-panel').classList.add('open');
    
    try {
        const file = await fileObj.handle.getFile();
        if (fileObj.type === 'pdf') {
            document.getElementById('pdf-controls').classList.remove('hidden');
            const arrayBuffer = await file.arrayBuffer();
            const loadingTask = pdfjsLib.getDocument({data: new Uint8Array(arrayBuffer)});
            state.viewer.pdfDoc = await loadingTask.promise;
            document.getElementById('page-count').textContent = state.viewer.pdfDoc.numPages;
            state.viewer.pageNum = 1;
            document.getElementById('page-num-input').max = state.viewer.pdfDoc.numPages;
            document.getElementById('page-num-input').value = 1;
            await renderPdfPage();
        } else {
            document.getElementById('image-controls').classList.remove('hidden');
            const img = document.getElementById('image-view');
            img.src = URL.createObjectURL(file);
            img.style.transform = 'scale(1)';
            img.classList.remove('hidden');
        }
    } catch (e) {
        console.error("Error rendering file in viewer", e);
    }
}

/** Render Viewer Header function. */
function renderViewerHeader() {
    const f = state.viewer.activeFile;
    if(!f) return;
    document.getElementById('viewer-title').textContent = f.name;
    
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
    state.viewer.activeFile = null;
    if(state.viewer.pdfDoc) {
        state.viewer.pdfDoc.destroy();
        state.viewer.pdfDoc = null;
    }
}



/** Render Pdf Page function. */
async function renderPdfPage() {
    if (!state.viewer.pdfDoc) return;
    const page = await state.viewer.pdfDoc.getPage(state.viewer.pageNum);
    const canvas = document.getElementById('pdf-canvas');
    const ctx = canvas.getContext('2d');
    
    const panelWidth = document.getElementById('viewer-canvas-container').clientWidth - 32;
    const unscaledViewport = page.getViewport({ scale: 1.0 });
    const scale = panelWidth / unscaledViewport.width;
    const viewport = page.getViewport({ scale: scale });
    
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    canvas.classList.remove('hidden');
    
    const renderContext = {
        canvasContext: ctx,
        viewport: viewport
    };
    await page.render(renderContext).promise;
    
    const pageInput = document.getElementById('page-num-input');
    if (pageInput) pageInput.value = state.viewer.pageNum;
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
        item.innerHTML = `
            <span class="bookmark-label" title="${b.label}">${b.label}</span>
            <span class="bookmark-page">${b.posDesc}</span>
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
/** Toggle Theme function. */
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    html.setAttribute('data-theme', next);
    state.settings.theme = next;
    saveSettings();
    
    const iconSun = document.querySelector('.icon-sun');
    const iconMoon = document.querySelector('.icon-moon');
    if (iconSun && iconMoon) {
        if (next === 'dark') {
            iconSun.classList.remove('hidden');
            iconMoon.classList.add('hidden');
        } else {
            iconSun.classList.add('hidden');
            iconMoon.classList.remove('hidden');
        }
    }
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
    
    const html = document.documentElement;
    html.setAttribute('data-theme', state.settings.theme || 'light');
    
    const cardSize = state.settings.cardSize || 160;
    html.style.setProperty('--card-size', `${cardSize}px`);
    const slider = document.getElementById('card-size-slider');
    if (slider) slider.value = cardSize;
    
    const iconSun = document.querySelector('.icon-sun');
    const iconMoon = document.querySelector('.icon-moon');
    if (iconSun && iconMoon) {
        if ((state.settings.theme || 'light') === 'dark') {
            iconSun.classList.remove('hidden');
            iconMoon.classList.add('hidden');
        } else {
            iconSun.classList.add('hidden');
            iconMoon.classList.remove('hidden');
        }
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
}

/** Toggle Theme function. */
function toggleTheme() {
    const html = document.documentElement;
    const current = html.getAttribute('data-theme');
    const newTheme = current === 'light' ? 'dark' : 'light';
    html.setAttribute('data-theme', newTheme);
    chrome.storage.local.set({ theme: newTheme });
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
        titleDiv.title = fileObj.name;
        titleDiv.textContent = fileObj.name;
        titleDiv.onclick = () => openViewer(fileObj);
        groupDiv.appendChild(titleDiv);
        
        items.forEach((b, idx) => {
            const itemDiv = document.createElement('div');
            itemDiv.className = 'sidebar-bookmark-item';
            itemDiv.innerHTML = `
                <span class="sidebar-bookmark-icon">🔖</span>
                <span class="sidebar-bookmark-label" title="${b.label}">${b.label}</span>
                <span class="sidebar-bookmark-page">${b.posDesc}</span>
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
    state.tagLibrary.forEach((tag, idx) => {
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

// ============================================================
// SECTION 11: Event Listeners (DOMContentLoaded block)
// ============================================================
document.addEventListener('DOMContentLoaded', async () => {
    const data = await loadStorage();
    
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
            const permission = await savedHandle.requestPermission({ mode: 'read' });
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
    if (elBtnReconnectFolder) elBtnReconnectFolder.addEventListener('click', selectFolder);
    const elBtnChangeFolder = document.getElementById('btn-change-folder');
    if (elBtnChangeFolder) elBtnChangeFolder.addEventListener('click', selectFolder);
    
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
    
    const elThemeToggle = document.getElementById('theme-toggle');
    if (elThemeToggle) elThemeToggle.addEventListener('click', toggleTheme);
    
    const btnGrid = document.getElementById('btn-view-grid');
    const btnList = document.getElementById('btn-view-list');
    if (btnGrid) btnGrid.addEventListener('click', () => setViewMode('grid'));
    if (btnList) btnList.addEventListener('click', () => setViewMode('list'));
    
    const sizeSlider = document.getElementById('card-size-slider');
    if (sizeSlider) sizeSlider.addEventListener('input', (e) => {
        const val = e.target.value;
        document.documentElement.style.setProperty('--card-size', `${val}px`);
        state.settings.cardSize = parseInt(val, 10);
        saveSettings();
    });
    
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
        elPanelOverlay.classList.remove('visible');
        elPanelOverlay.classList.add('hidden');
    });
    
    // Viewer actions
    const elBtnCloseViewer = document.getElementById('btn-close-viewer');
    if (elBtnCloseViewer) elBtnCloseViewer.addEventListener('click', closeViewer);
    
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
    if (elBtnCancelBookmark) elBtnCancelBookmark.addEventListener('click', () => {
        document.getElementById('add-bookmark-form').classList.add('hidden');
    });
    const elBtnSaveBookmark = document.getElementById('btn-save-bookmark');
    if (elBtnSaveBookmark) elBtnSaveBookmark.addEventListener('click', saveBookmark);
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
        a.download = "yarn_vault_backup.json";
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
        if(confirm("Are you sure you want to delete all tags, ratings, and bookmarks? This cannot be undone.")) {
            state.metadata = { tags: {}, ratings: {}, bookmarks: {} };
            saveMetadata();
            renderApp();
        }
    });
});
