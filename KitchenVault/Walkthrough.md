# Kitchen Vault: Technical Walkthrough & Architecture

Kitchen Vault is a comprehensive, privacy-first local recipe organizer built as a Chrome Manifest V3 Extension. Unlike traditional web applications, Kitchen Vault operates entirely offline, reading files directly from your computer's hard drive and storing metadata locally. 

This document explains the architecture, the logic flow, and the dependencies used to make the extension work.

---

## 1. System Architecture

The application is split into two primary domains: the **Browser Extension** (which handles all UI, file reading, and data management) and the optional **Native Host** (which breaks out of the browser sandbox to interact with the OS file explorer).

### The Browser Extension
- **`manifest.json`**: The heart of the extension. It defines permissions (like `storage`, `unlimitedStorage`, `nativeMessaging`, `contextMenus`) and registers `background.js` as the service worker.
- **`background.js`**: Runs invisibly in the background. It manages the context menus (the "Web Clipper" right-click features) and handles opening the main application in a new, full-sized browser tab when you click the extension icon.
- **`popup.html` / `style.css`**: The core frontend interface. It contains the grid layout, sidebars, modals, and the slide-in viewer. It uses a robust CSS variable system to support multiple dynamic themes (Cream Teal, Graphite Amber, Solarized Dark).
- **`popup.js`**: The massive "brain" of the frontend. It handles all state management, file system traversal, thumbnail generation, filtering, and UI interactions.

### The Native Messaging Host
Because web browsers run in a secure sandbox, they cannot execute arbitrary commands on your computer (like "open Windows Explorer").
- **`kitchenvault_host.go`**: A lightweight Go application that acts as a secure bridge.
- **How it works**: The extension downloads the compiled `.exe` (or Mac/Linux binary) into a hidden `.kv` folder inside your recipe directory. Once registered with Chrome's native messaging API, `popup.js` can send JSON messages to it. The Go binary receives the path and executes the standard OS command (e.g., `explorer.exe /select, <path>`) to highlight the file in your native file manager.

---

## 2. Core Logic & Data Flow

### The File System Access API
Kitchen Vault relies heavily on the modern **File System Access API** (`window.showDirectoryPicker()`). 
1. On first load, the user selects their root recipe folder. 
2. The browser grants a `FileSystemDirectoryHandle`.
3. `popup.js` recursively scans this handle, finding all `.pdf`, `.png`, `.jpg`, and `.jpeg` files, building a virtual tree of `state.folders` and `state.cards` (recipes).
4. Because Chrome revokes this access when the browser restarts, the extension saves the handle ID. On next boot, the user simply clicks "Reconnect" to quickly re-verify access without having to navigate the folder picker again.

### Metadata & Storage
All user-generated data (Tags, Ratings, Bookmarks, and Settings) is stored entirely offline.
- **`chrome.storage.local`**: Used as the primary fast-access database for metadata. When you tag a recipe, it updates here instantly.
- **Auto-Backup (`.kv/kitchenvault_backup.json`)**: To prevent data loss if the extension is ever uninstalled, `popup.js` automatically writes a backup of your `chrome.storage.local` data directly into your physical recipe folder.

### Thumbnail Generation & Caching (IndexedDB)
Rendering PDFs into images is CPU intensive. To keep the grid scrolling smoothly:
1. When a new file is found, Kitchen Vault uses an off-screen HTML `<canvas>` to render the first page of the PDF or scale down an image.
2. The resulting image data is saved into **IndexedDB** (`KitchenVaultDB`).
3. On subsequent loads, the extension fetches the thumbnail instantly from IndexedDB instead of re-parsing the PDF.

### The Recipe Viewer
When you click a recipe, it opens in a custom slide-in viewer.
- To prevent CSS/JS conflicts, the viewer uses a sandboxed `<iframe>`.
- It dynamically injects the image or the PDF canvas into the iframe, allowing you to zoom, pan, and add text annotations on top of the file.
- **Bookmarking**: It listens to the scroll position or PDF page number and saves it to metadata, automatically restoring your exact position next time you open that recipe.

---

## 3. Third-Party Dependencies

To keep the extension fast, secure, and entirely offline, Kitchen Vault bundles exactly two external dependencies directly into the repository:

### 1. PDF.js (`pdf.min.js`, `pdf.worker.min.js`)
- **Purpose**: Rendering PDF files into images.
- **How it's used**: Mozilla's open-source PDF rendering engine is what allows the extension to show thumbnails for PDFs and display them natively in the viewer without relying on the browser's default PDF UI. The worker file is loaded locally to handle the heavy parsing on a background thread.

### 2. Search & Filtering
- **Purpose**: Fast, real-time keyword matching.
- **How it's used**: When you type in the search bar, `popup.js` performs substring matching (using `.includes()`) against recipe filenames, folder paths, and custom tags. The `fuse.js` library is included in the project files but is not currently actively used for scoring.

---

## 4. Smart Cooking Tools

Built into `popup.js` are several utility classes designed specifically for cooking:
- **Cooking Timer**: A JavaScript interval loop that manages a countdown timer. It plays a local audio chime when a timer hits zero.
- **Unit Converter**: A dictionary mapping of common culinary conversions (cups to grams, tbsp to ml) that parses user input using Regex.
- **Altitude Adjuster**: A mathematical scaler that adjusts baking temperatures, flour, and liquid ratios based on the user's selected elevation.

## Summary
Kitchen Vault is a masterclass in pushing modern web APIs to their limits. By combining the File System Access API, IndexedDB, Native Messaging, and PDF.js, it delivers a desktop-class application experience entirely from within the browser sandbox — all while keeping 100% of your data safely on your own hard drive.
