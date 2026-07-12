# Digitine — Bulk Instagram Blocker

Digitine is an automated Instagram bulk-blocker Chrome Extension designed to help users efficiently manage their digital environment. Featuring a premium dark glassmorphism dashboard, resilient text-based DOM selectors, human-like safety throttling, and a crash-safe background service engine, Digitine automates bulk-blocking or unblocking actions to protect your profile from spammers, bots, and online harassment.

## Table of Contents
* [Features](#features)
* [Prerequisites](#prerequisites)
* [Installation](#installation)
* [Usage](#usage)
* [Support](#-support)
* [License](#-license)
* [Ethical Use & Disclaimer](#-ethical-use--disclaimer)

---

## Features

### What Was Built
* **Popup & Custom Styles**: A dark glassmorphism dashboard built with modern CSS tokens, Google Fonts (Outfit), customized scrollbars, a horizontal progress bar, real-time counter statistics, and a diagnostic activity terminal.
* **Popup Orchestration**: Seamless state-synchronization that instantly restores the current progress, activity logs, button states, and queue items whenever the popup is closed and reopened.
* **Secure Configuration**: Built strictly on Manifest V3 with minimal `storage`, `tabs`, `scripting`, and `alarms` permissions, strictly scoped to the `instagram.com` domain.
* **Background Controller**: A resilient queue manager featuring 45-second safety timeouts, manual tab interrupt detection, persistent `chrome.storage.local` serialization after each step, and `chrome.alarms` scheduler for crash-safe inter-page delays.

### Symmetrical 5-Step Automation State Machine
1. **Unblock Detector**: Scans the profile page for an existing "Unblock" button and automatically skips the target if the account is already blocked.
2. **Options Finder**: Resolves the options menu (`...`) by locating the SVG with `aria-label="Options"`.
3. **Block Menu Option**: Locates the "Block" list item inside the options portal overlay.
4. **Block Confirmation**: Clicks the primary, destructive "Block" button inside the popup confirmation modal.
5. **Success Verification**: Verifies the API network request finished successfully by checking if the profile page action button transitioned to the "Unblock" state.

---

## Prerequisites

> [!IMPORTANT]
> ⚠️ **Authenticated Session Required**
> * **Active Authentication**: The user **must** be logged into their Instagram account in the same Google Chrome browser profile where Digitine is installed.
> * **No Login Management**: Digitine operates strictly on the live authenticated Instagram session in your browser and does not handle logging in.
> * **Failure State**: If you are not logged in, the automation will fail silently or land on the Instagram login page instead of the target profile.

---

## Installation

Follow these simple steps to load **Digitine** into your Google Chrome browser:

1. Open Google Chrome and navigate to `chrome://extensions/` in the address bar.
2. Enable **Developer Mode** in the top-right corner of the Extensions page.
3. Click the **"Load unpacked"** button in the top-left corner.
4. Navigate to your local project directory, select the `digitine` folder, and click **Select Folder**.
5. Click the puzzle piece icon in the Chrome toolbar and click the **pin icon** next to **Digitine** to keep it accessible.

---

## Usage

1. Click the **Digitine** icon in your toolbar to open the glassmorphism dashboard.
2. **Select Mode**: Choose between **Block** and **Unblock** modes. The start button will update dynamically.
3. **Enter Targets**: Paste a list of Instagram profile URLs or usernames (one per line) in the textarea.
   * *Full URLs*: `https://www.instagram.com/username/`
   * *Raw handles*: `username` or `@username`
   * *Digitine automatically sanitizes and standardizes all inputs into fully qualified profile links.*
4. **Set Safety Delay**: Adjust the delay input (3–5 seconds is highly recommended to mimic human behavior).
5. **Click Start**: 
   - The UI will automatically expand the workspace into a standalone centered browser tab so you can monitor progress.
   - It opens each profile in a new tab, auto-performs the selected block/unblock workflow, closes the tab, waits the scheduled safety delay via `chrome.alarms`, and proceeds.
6. **Pause**: Click **Pause** to stop the queue safely after the current profile finishes. You can resume right where you left off.
7. **Stop & Reset**: Click **Stop & Reset** to end the automation session and clear the loaded queue.
8. **Reset Tool**: Click **Reset Tool** to clear the activity logs, progress bar, target name, and counters back to their clean idle states between runs.

---

## ☕ Support

If Digitine saved you time, consider buying me a coffee!

[![Buy Me A Coffee](https://img.shields.io/badge/Buy%20Me%20A%20Coffee-gaidamarcel-FFDD00?style=flat&logo=buy-me-a-coffee&logoColor=black)](https://buymeacoffee.com/gaidamarcel)

---

## 📄 License

This project is licensed under the MIT License. Please refer to the [LICENSE](LICENSE) file in the repository root for the full text. 

Copyright (c) 2026 Marcel Gaida

---

## ⚖️ Ethical Use & Disclaimer

Please read this section carefully before utilizing the tool:

1. **Purpose**: Digitine was built to help users protect themselves from spam accounts and online harassment by enabling bulk-blocking. It is designed strictly as a defensive tool, not an offensive one.
2. **ToS Notice**: This extension automates browser interactions on Instagram, which may conflict with Instagram's Terms of Use (specifically Section 2 regarding automated scraping and account interaction). Users should be fully aware of this policy.
3. **Account Risk**: The use of automation tools on Instagram carries the risk of temporary action blocks, rate-limiting, or permanent account restriction. Always use the safety delay feature and avoid running exceptionally large block lists in a single session.
4. **No Warranty**: The author provides this tool as-is with no guarantees. The author is not responsible for any account bans, restrictions, data loss, or server blocks resulting from the use of this tool.
5. **Personal Use Only**: This tool is intended strictly for personal safety use. It is not designed, supported, or endorsed for commercial scraping, harassment campaigns, or any malicious targeted actions.
6. **Not for Chrome Web Store**: This extension is not submitted to the Chrome Web Store and must be loaded manually via Developer Mode. 
