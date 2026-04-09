# Wayback Machine Link-Checker

A Chrome extension that checks whether any web page or link has been archived on the [Wayback Machine](https://web.archive.org/) — right from your browser.

![Chrome Extension](https://img.shields.io/badge/Chrome-Extension-4285F4?logo=googlechrome&logoColor=white)
![Manifest V3](https://img.shields.io/badge/Manifest-V3-2ECC71)
![License: MIT](https://img.shields.io/badge/License-MIT-blue)

---

## Features

| Feature | Description |
|---|---|
| 🔗 **Right-click link check** | Right-click any link → "Check this link on Wayback Machine" |
| 📄 **Right-click page check** | Right-click the page → "Check this page on Wayback Machine" |
| 💾 **Save to Archive** | Right-click → "Save this page to Wayback Machine" |
| 🔍 **Pre-check availability** | Uses the Wayback Availability API to verify before opening |
| 🟢 **Badge indicator** | Green ✓ / Red ✗ badge showing archive status for the current tab |
| 🖥️ **Popup dashboard** | Click the toolbar icon to see snapshot info, browse the timeline, or save the page |

## Installation

### From source (Developer mode)

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable **Developer mode** (toggle in the top-right)
4. Click **Load unpacked** and select the extension folder
5. The Wayback Machine icon appears in your toolbar

## Usage

### Context menu (right-click)

- **On a link**: Right-click → *Check this link on Wayback Machine*
- **On a page**: Right-click → *Check this page on Wayback Machine*
- **Save a page**: Right-click → *Save this page to Wayback Machine*

### Toolbar popup

Click the extension icon to see:

- Whether the current page is archived
- The date of the latest snapshot
- Buttons to view the snapshot, browse the timeline, or save the page

### Badge

The extension icon shows a small badge:

- **✓** (green) — the current page has at least one Wayback Machine snapshot
- **✗** (red) — no snapshots found

## Permissions

| Permission | Reason |
|---|---|
| `contextMenus` | Right-click menu items |
| `activeTab` | Read the current tab's URL for page-level checks |
| `notifications` | (Reserved for future use) |
| `host_permissions: archive.org` | Wayback Availability API calls |

## Project Structure

```
├── manifest.json      # Extension manifest (MV3)
├── background.js      # Service worker — menus, API checks, badge
├── popup.html         # Toolbar popup markup
├── popup.css          # Popup styles (dark theme)
├── popup.js           # Popup logic — API calls, UI updates
├── icon16.png
├── icon32.png
├── icon48.png
├── icon128.png
├── icon_full.png
├── README.md
└── LICENSE
```

## API

This extension uses the [Wayback Machine Availability API](https://archive.org/help/wayback_api.php):

```
GET https://archive.org/wayback/available?url=<URL>
```

No API key is required.

## Support

If you find this extension useful, consider supporting the developer:

☕ [Buy me a coffee](https://bmc.link/gaidamarcel)

## License

[MIT](LICENSE) — free for personal and commercial use.
