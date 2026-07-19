# Yarn Vault Chrome Extension

A local crochet pattern organizer with a warm, cozy interface. Built entirely with vanilla JavaScript, CSS, and HTML for Chrome Manifest V3.

## Features
- **Local File System Access**: Browse your local folders directly from the extension (requires choosing a folder on first load).
- **PDF & Image Viewer**: Built-in viewer with PDF.js rendering and image zooming.
- **Tagging & Rating**: Organize your patterns with custom tags and 1-5 star ratings.
- **Bookmarking**: Save your spot (page number for PDFs, scroll position for images) so you can pick up exactly where you left off.
- **Row Counter**: Keep track of your row or round progress directly within the pattern viewer.
- **Search & Filter**: Find patterns instantly by name, path, or tag.
- **Themes**: Switch between Light Mode (Cream Teal), Dark Mode (Graphite Amber), and Solarized Dark themes to suit your preference.

## Installation Instructions

### Step 1: Prepare the Files
1. Download the [yarnvault_release v1.0.2.zip](https://github.com/marcel-gaida/five_sugar/blob/d87d933645e11f49ab3361ab36cc75b066259543/apps/yarnvault/yarnvault_release%201.0.2.zip) from the latest release and extract it to a folder on your computer. Alternatively, you can download this entire `YarnVault` folder.
2. The extension uses PDF.js. If you downloaded the source code, ensure `pdf.min.js` and `pdf.worker.min.js` are in the root directory alongside `manifest.json`.

### Step 2: Load into Chrome
1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in your address bar.
3. Turn on **Developer mode** (toggle switch in the top right corner).
4. Click the **Load unpacked** button in the top left.
5. Select the `YarnVault` folder you downloaded.
6. The extension should now appear in your list. Pin it to your toolbar for easy access!

## Usage
1. **Click the Yarn Vault icon** in your toolbar to open the application in a new browser tab.
2. **Select your Pattern Folder**: On your first launch, click "Select Your Pattern Folder" and choose the root folder on your computer where you store your PDF and Image patterns. 
3. **Approve permissions**: Chrome will ask if you want to let the site view files in the folder. Click "View files". (Note: The File System Access API requires you to "Reconnect" the folder whenever Chrome fully restarts the extension).
4. **Browse & View**: Click on any file to open the slide-in viewer. 
5. **Tag & Rate**: Use the header in the viewer to set ratings and add tags.
6. **Settings**: Click the gear icon in the top right to customize the grid density, show file extensions, or export/import your metadata.

## Data Privacy
Everything is stored locally on your device in `chrome.storage.local`. No data is ever sent to any external server. You can export your tags, ratings, and bookmarks as a JSON file from the Settings panel.

## Technical Structure
The extension is built natively using web technologies, without heavy frameworks or build steps.
- **`manifest.json`**: The Chrome Extension Manifest (V3). It defines extension metadata, permissions (`storage`, `sidePanel`), and registers the background worker and icons.
- **`background.js`**: The service worker. It listens for the user clicking the extension icon in the toolbar and opens `popup.html` in a new browser tab.
- **`popup.html`**: The main HTML structure for the application, defining the layout for the grid, the settings panel, and the slide-in file viewer.
- **`popup.js`**: The core application logic. It manages state, uses the File System Access API to read local files, processes searches/filters, interacts with `chrome.storage.local` for metadata, and manages the custom PDF/Image viewer interface.
- **`style.css`**: Vanilla CSS providing all styling, including responsive grid layout, light/dark themes using CSS variables, and viewer animations.
- **`pdf.min.js` & `pdf.worker.min.js`**: PDF.js libraries used to natively render PDF pages to a canvas within the application.
- **`generate_icons.py` & `icons/`**: A utility Python script that generates the required extension icon sizes based on a source design, placing them in the `icons` directory.
