# Kitchen Vault Chrome Extension

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?style=flat-square&logo=google-chrome&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)
![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)
![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-brightgreen?style=flat-square)

A local cooking recipe organizer with a premium, gourmet interface. Built entirely with vanilla JavaScript, CSS, and HTML for Chrome Manifest V3.

## Screenshots

<div align="center">
  <img src="screenshots/Cream_Teal_kitchen-vault-20260605-212812.png" width="48%" alt="Cream Teal Theme">
  <img src="screenshots/Graphite_Amber_kitchen-vault-20260605-213157.png" width="48%" alt="Graphite Amber Theme">
  <img src="screenshots/Solarized_kitchen-vault-20260605-213304.png" width="48%" alt="Solarized Dark Theme">
  <img src="screenshots/Recipe_View_kitchen-vault-20260605-213510.png" width="48%" alt="Recipe Viewer">
  <img src="screenshots/Settings_Panel_kitchen-vault-20260605-213407.png" width="48%" alt="Settings Panel">
  <img src="screenshots/right-click feature_KitchenVault.png" width="48%" alt="Native Context Menus">
</div>

## Features
- **Local File System Access**: Browse your local folders directly from the extension (requires choosing a folder on first load).
- **Web Clipper**: Save recipes directly from the web into your local Kitchen Vault folder using the extension's popup context menu.
- **Shopping List**: Build a dedicated shopping list for each recipe, and easily export it to Google Keep or send it directly via email (with the recipe name and page number automatically attached).
- **Annotations & Bookmarking**: Add text annotations to your recipes, save your scroll position, or bookmark PDF pages so you can pick up exactly where you left off.
- **Smart Cooking Tools**: Includes a built-in cooking timer, a unit converter for quick math while cooking, and a high-altitude baking adjuster.
- **Auto-Backup**: Your metadata, tags, and ratings are automatically backed up to a `.kv/kitchenvault_backup.json` file in your vault so you never lose your data.
- **Native Host Integration**: Easily open local files directly in your operating system's native File Explorer using the "Show in Folder" helper!
- **PDF & Image Viewer**: Built-in viewer with PDF.js rendering and unified zooming.
- **Tagging & Rating**: Organize your recipes with custom tags and 1-5 star ratings.
- **Search & Filter**: Find recipes instantly by name, path, or tag.
- **Custom Themes**: Switch effortlessly between three custom-designed themes: **Cream Teal** (Light), **Graphite Amber** (Dark), and **Solarized Dark**.

## The "Show in Folder" Native Helper

Because web browsers run in a secure sandbox, Chrome extensions cannot natively tell your operating system to open a file in Windows Explorer or Mac Finder. To solve this, Kitchen Vault optionally uses a tiny **Native Messaging Host** (written in Go) that acts as a secure bridge between the extension and your computer.

**How it works:**
1. When you enable the feature in Settings, the extension downloads the correct executable for your OS (Mac/Windows/Linux) directly from the official GitHub releases.
2. The executable is safely stored inside the hidden `.kv` folder within your selected Recipe Vault.
3. You run a one-time script to register the helper with Chrome's native messaging API.
4. When you click "Show in Folder", the extension sends a message to the helper, which simply executes the standard file manager open command (like `explorer.exe /select, path`).

**Security & Privacy:**
- The helper does **not** connect to the internet after the initial download.
- It does **not** run in the background; it only executes for a fraction of a second when you click the button.
- It does **not** require administrator privileges.
- You can uninstall it cleanly at any time by toggling the setting off.

## Installation Instructions

### Step 1: Prepare the Files
1. Download this entire `KitchenVault` folder.
2. The extension uses PDF.js. Ensure `pdf.min.js` and `pdf.worker.min.js` are in the root directory alongside `manifest.json`.

### Step 2: Load into Chrome
1. Open Google Chrome.
2. Navigate to `chrome://extensions/` in your address bar.
3. Turn on **Developer mode** (toggle switch in the top right corner).
4. Click the **Load unpacked** button in the top left.
5. Select the `KitchenVault` folder you downloaded.
6. The extension should now appear in your list. Pin it to your toolbar for easy access!

## Usage
1. **Click the Kitchen Vault icon** in your toolbar to open the application in a new browser tab.
2. **Select your Recipe Folder**: On your first launch, click "Select Your Recipe Folder" and choose the root folder on your computer where you store your PDF and Image recipes. 
3. **Approve permissions**: Chrome will ask if you want to let the site view files in the folder. Click "View files". (Note: The File System Access API requires you to "Reconnect" the folder whenever Chrome fully restarts the extension).
4. **Browse & View**: Click on any file to open the slide-in viewer. 
5. **Tag & Rate**: Use the header in the viewer to set ratings and add tags.
6. **Settings**: Click the gear icon in the top right to customize your interface theme, grid density, or configure the "Show in Folder" native helper.

## Data Privacy
Everything is stored locally on your device in `chrome.storage.local`. No data is ever sent to any external server. You can export your tags, ratings, and bookmarks as a JSON file from the Settings panel.
