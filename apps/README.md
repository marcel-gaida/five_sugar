# Apps

This folder contains the current app-style projects in `five_sugar`, mostly Chrome extensions and local-first tools for practical workflows. The projects in this directory include company research, web archiving, local recipe and pattern organization, and browser automation utilities.

## Projects

| Project | Purpose | Highlights |
|---------|---------|------------|
| `company-rating-lookup-1.1.6` | Look up company ratings from Glassdoor and Google Maps while browsing. | Context-menu lookup, LinkedIn job scanning, Indeed job scanning, and session caching. |
| `digitine` | Bulk-block or unblock Instagram profiles from a Chrome extension dashboard. | Queue-based automation, popup state restore, safety delays, and pause/resume controls. |
| `kitchenvault` | Organize local cooking recipes in a Chrome extension with a premium local-first interface. | File-system access, web clipping, shopping lists, annotations, timers, metadata backup, and optional native helper support. |
| `waybacklinkcheckerext` | Check whether pages or links are archived on the Wayback Machine. | Context menu checks, save-to-archive actions, toolbar popup, badge status, and Wayback Availability API integration. |
| `yarnvault` | Organize local crochet patterns with bookmarking and lightweight library tools. | PDF/image viewing, tags, ratings, bookmarks, row counter, search, and theme switching. |

## Folder notes

Each app folder is intended to be self-contained and may include its own `README.md`, `LICENSE`, screenshots, icons, packaged release files, and extension source files. Several apps are designed to be loaded locally in Chrome through Developer Mode rather than installed from the Chrome Web Store.

## Common setup

Most extensions in this folder follow a similar setup flow:

1. Open Chrome and go to `chrome://extensions`.
2. Enable **Developer mode**.
3. Click **Load unpacked**.
4. Select the specific app folder.

This installation pattern is described in the app-level documentation for Company Rating Lookup, Digitine, Kitchen Vault, Wayback Machine Link-Checker, and Yarn Vault.

## Project focus

These apps lean toward local-first workflows and targeted utility rather than a single unified product line. Kitchen Vault and Yarn Vault store user data locally, while Wayback Machine Link-Checker and Company Rating Lookup focus on quick browser-assisted lookup tasks; Digitine centers on automation within an authenticated browser session.

