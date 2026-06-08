# Changelog

## [1.1.0] - 2026-06-07
### Added
- **Indeed Jobs Scanner**: Added a fully-featured page scanner for Indeed.com, allowing batch rating lookups for job postings.
- **Drag & Drop Panels**: Scanner panels can now be dragged and repositioned freely around the screen.
- **Panel Window Controls**: Added Minimize and Close controls to the scanner panels.
- **Persistent Cache**: Introduced session-based caching to remember scanned ratings when toggling panels or updating the DOM.

### Changed
- Refactored UI styling into an isolated `styles/card.css` to prevent host CSS bleed on complex sites like LinkedIn.
- Modernised UI icons by replacing standard emojis with crisp, scalable inline SVGs.
- Redesigned the Chrome Extension popup menu with a split row interface for quick access to LinkedIn and Indeed scanners.
- Improved the Google Maps lookup algorithm to append contextual city data to queries, significantly improving location matching accuracy.

### Fixed
- Fixed an issue where the popup window would close before executing the script injection due to asynchronous execution races.
- Resolved a layout bug where the detail panel on LinkedIn would trigger duplicate scrapes and inconsistent results.
- Fixed z-index layering issues on Indeed to ensure interactive badges remain clickable over native job cards.
