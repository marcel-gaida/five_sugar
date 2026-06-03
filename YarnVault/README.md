# Yarn Vault Chrome Extension

A local crochet pattern organizer with a warm, cozy interface. Built entirely with vanilla JavaScript, CSS, and HTML for Chrome Manifest V3.

## Features
- **Local File System Access**: Browse your local folders directly from the extension (requires choosing a folder on first load).
- **PDF & Image Viewer**: Built-in viewer with PDF.js rendering and image zooming.
- **Tagging & Rating**: Organize your patterns with custom tags and 1-5 star ratings.
- **Bookmarking**: Save your spot (page number for PDFs, scroll position for images) so you can pick up exactly where you left off.
- **Search & Filter**: Find patterns instantly by name, path, or tag.
- **Dark Mode**: Switch between a warm cream aesthetic and a cozy dark mode.

## Installation Instructions

### Step 1: Prepare the Files
1. Download this entire `YarnVault` folder.
2. The extension uses PDF.js. Ensure `pdf.min.js` and `pdf.worker.min.js` are in the root directory alongside `manifest.json`. (They should already be downloaded, but if not, you can grab them from the cdnjs links in the implementation plan).

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
