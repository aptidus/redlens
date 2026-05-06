# RedLens Cookie Connect (Chrome Extension)

Connect your `xiaohongshu.com` session to RedLens in one click. After you install once, a floating **"Connect to RedLens"** button appears on every XHS page — click it, RedLens opens already authenticated.

## Install (one time)

1. Download or clone this repo
2. Open Chrome → `chrome://extensions`
3. Toggle **Developer mode** on (top right)
4. Click **Load unpacked**
5. Select this `extension/` folder

That's it. You don't need to pin the extension or do anything else.

## Use

1. Go to `xiaohongshu.com` in Chrome (logged in)
2. Look at the bottom-right of the page — a red **Connect to RedLens** button
3. Click it
4. RedLens opens in a new tab, already connected. Run an analysis.

The cookie travels in the URL fragment (`#xhs_cookie=…`), which never reaches any server log.

## Three ways to trigger it

The extension gives you three entry points to the same action — pick whichever feels natural:

- **Floating button on xiaohongshu.com** (recommended) — appears automatically when you visit the site
- **Extension icon in toolbar** — click → "Connect to RedLens" button in popup
- **Copy to clipboard** — popup also has a fallback "copy" button if you want to paste manually somewhere

## Pointing at a different RedLens deployment

If you self-host RedLens at a different URL, click the extension icon → **Settings** → enter your URL.

## Permissions

| Permission | Why |
|---|---|
| `cookies` + host `*.xiaohongshu.com` | Read your XHS session cookies (including `httpOnly` ones) |
| `storage` | Remember your RedLens URL between sessions |

The extension makes **no network requests** of its own. It opens a tab to RedLens with your cookie in the URL fragment.

## Architecture

- `background.js` — service worker; the only place `chrome.cookies` is called
- `content.js` + `content.css` — injected on `xiaohongshu.com`; renders the floating button
- `popup.html` + `popup.js` — toolbar icon UI (alternative entry point)
- `options.html` + `options.js` — set custom RedLens URL
