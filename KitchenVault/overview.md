# KitchenVault File Overview

Here is a breakdown of every file in the KitchenVault folder, what its purpose is, and whether it belongs in your GitHub repository.

## 🟢 Core Extension Files 
These files make up the actual Chrome Extension and its user interface.

* **`manifest.json`**: The heart of the Chrome extension. Defines permissions, native messaging capabilities, background scripts, and icon pointers.
* **`popup.html`**: The main user interface. Contains the structure for the sidebar, top toolbar, settings panel, shopping list panel, and the main grid/viewer.
* **`popup.js`**: The frontend JavaScript brain. Handles scanning local folders, rendering the UI, managing the local metadata/thumbnails database (IndexedDB), handling search, applying settings/themes, and managing the global shopping list.
* **`style.css`**: The stylesheet. Contains all the custom CSS variables, the Light/Cream Teal/Dark/Graphite/Solarized themes, layout constraints, and micro-animations.
* **`background.js`**: The invisible service worker. It handles communication between the frontend (`popup.js`) and the Native Host (to perform filesystem operations), as well as fetching files from URLs.
* **`conversionData.js`**: The logic and data dictionaries for converting measurements, temperatures, and altitudes.
* **`icons/` (Folder)**: Contains the 16, 32, 48, and 128px minimalist cloche icons used by Chrome.
* **`README.md`**, **`LICENSE`**, **`CHANGELOG.md`**, **`.gitignore`**: Standard documentation and repository management files.

## 🟢 Third-Party Libraries 
These are dependencies required for the extension to run completely offline without relying on external CDNs.

* **`fuse.js`**: A powerful, lightweight fuzzy-search library used to power the search bar.
* **`pdf.min.js` & `pdf.worker.min.js`**: Mozilla's PDF.js library, which enables the extension to render PDF cookbooks and recipes directly in the browser.

## 🟢 Native Host Source Code 
These files define the Native Messaging Host, which allows the Chrome extension to break out of the browser sandbox and read/write to your local `.kv` folders.

* **`kitchenvault_host.go`**: The actual Golang source code for the native host. It handles reading directories, opening files, and writing backup JSONs securely.
* **`install_host.py`**: The installation script. It dynamically updates `kitchenvault_host.json` with the correct local path and writes the required registry keys so Chrome knows the host exists.
* **`kitchenvault_host.json`**: The Native Messaging Host manifest template. Chrome reads this to verify extension IDs and find the executable path.

---

## 🟡 Utility Scripts 
These are helper scripts. If you push them, it's best to put them in a `scripts/` folder so they don't clutter the root directory.

* **`generate_icons.py`**: A Python script used to automatically draw and render the cloche icons at various sizes.
* **`host.py`**: Looks like an older Python prototype of the native host. Since the Go version (`kitchenvault_host.exe`) is being used, this is likely obsolete.
* **`run_host.bat`**: A local batch script likely used for testing the host independently.

