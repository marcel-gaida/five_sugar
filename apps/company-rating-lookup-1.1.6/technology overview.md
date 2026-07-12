# Technology Overview

The Company Rating Lookup extension is built using modern Chrome Extension APIs (Manifest V3) and vanilla web technologies to ensure a lightweight, fast, and secure user experience without relying on bulky frontend frameworks.

## Architecture

### 1. Background Service Worker (`background.js`)
Acts as the central orchestrator of the extension. It manages API requests to external services to bypass CORS restrictions that content scripts face.
- **Google Maps Engine**: Uses either the official Google Places API (if a key is provided) or falls back to a smart, headless scraping fallback mechanism. Sets `isAmbiguous` indicators if results appear broad or generalized.
- **Glassdoor Engine**: Performs targeted programmatic searches against Glassdoor to retrieve rating and review count data. Validates exact/fuzzy name overlap and detects search landing url variants to tag ambiguous lookups.
- **Message Broker**: Listens for `chrome.runtime.sendMessage` requests from content scripts and responds with normalized rating data.

### 2. Context Menu & Popup Injector (`content.js`)
Injected into all web pages. It handles the right-click context menu "Look up company ratings" functionality.
- Responsible for dynamically generating and rendering the floating rating card UI near the user's cursor. Supports rendering ambiguity warnings for uncertain lookup matches.
- Manages the lifecycle and dismissal of the popup card.

### 3. Page Scanners (`linkedin-scanner.js` & `indeed-scanner.js`)
Site-specific content scripts that parse the DOM of job boards.
- **LinkedIn Scanner**: Implements a robust state-based **text-driven sequential parser** rather than fragile class name queries. Extracts raw text streams from search content containers, maps and filters noise, splits cards using structural dividers and contextual state machines, and resolves titles/companies/locations without class reliance.
- **Indeed Scanner**: Uses DOM traversal and stable `data-testid` attributes to identify company names and associated job cards.
- Batches API requests to prevent rate limiting.
- Injects non-intrusive UI badges directly into the host page's DOM, supporting interactive hover tooltips with ambiguity alerts.
- Implements `window.__crlRatingCache` to persist scanned ratings across panel toggles without triggering duplicate network requests.

### 4. Configuration Popup (`popup.html` & `popup.js`)
The user-facing configuration window accessed via the Chrome toolbar.
- Connects to Chrome's `storage.local` API to securely persist API keys.
- Dispatches messages to active tabs to trigger scanner panels.

## Styling
Uses isolated, scoped vanilla CSS (`styles/card.css`) to ensure that the extension's UI doesn't interfere with the host website's styling. Custom animations, flexbox layouts, and modern typography variables are used to provide a premium, native feel.
