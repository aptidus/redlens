# NicheLens Cookie Connect (Chrome Extension)

Connect your `xiaohongshu.com` or `douyin.com` session to NicheLens in one click. After installing once, a floating button appears on every supported site — click it, NicheLens opens already authenticated.

## Install (one time)

1. Download / clone this repo (or grab `nichelens-extension.zip` from nichelens.ai)
2. Open Chrome → `chrome://extensions`
3. Toggle **Developer mode** on (top right)
4. Click **Load unpacked**
5. Select this `extension/` folder

## Use

1. Go to `xiaohongshu.com` or `douyin.com` in Chrome (logged in)
2. Look at the bottom-right of the page — a floating **Connect** button appears
3. Click it
4. NicheLens opens in a new tab, already connected. Run an analysis.

The cookie travels in the URL fragment (`#xhs_cookie=…` or `#douyin_cookie=…`), which never reaches a server access log.

## Three ways to trigger the connect flow

- **Floating button on the platform site** (recommended) — appears automatically when you visit XHS or Douyin
- **Extension toolbar icon** → Connect button in popup
- **Copy to clipboard** — popup also has a fallback "copy" button if you want to paste the cookie manually

## Pointing at a different deployment

If you self-host NicheLens, click the extension icon → **Settings** → enter your URL.

## Permissions

| Permission | Why |
|---|---|
| `cookies` + host `*.xiaohongshu.com`, `*.douyin.com` | Read your XHS / Douyin session cookies (including `httpOnly` ones the page itself can't see) |
| `scripting` + `tabs` | Run authenticated XHS / Douyin API fetches *inside your already-logged-in tab*, so server-IP blocks (XHS code `-104` etc.) don't apply. Without this, scraping happens server-side and frequently fails. |
| `storage` | Remember your NicheLens URL between sessions |
| host `nichelens.ai` | Inject the postMessage bridge so the page can ask the extension to make those authenticated fetches |

## What the extension actually does on the network

- **Reads cookies** from xiaohongshu.com / douyin.com (cookie API only — no traffic generated)
- **Opens a NicheLens tab** with your cookie in the URL fragment when you click Connect
- **Inside an XHS / Douyin tab you have open**, when NicheLens asks: `fetch()` calls to `edith.xiaohongshu.com` / `www.douyin.com` API endpoints. These run from your own browser, signed by the page's own JS, and bypass the server-IP blocks that hit cookie-forward backends. Results are returned to the NicheLens page via postMessage.

The extension does **not** transmit your cookies, browsing history, or any data to a third-party server. The only outbound HTTP it triggers is to the platform you're already on (XHS / Douyin) and the NicheLens URL you've configured.

## Architecture

- `manifest.json` — MV3 manifest, declares permissions and content script targets
- `background.js` — service worker; only place `chrome.cookies` / `chrome.scripting` are called
- `content.js` + `content.css` — injected on `xiaohongshu.com` / `douyin.com`; renders the floating Connect button
- `bridge.js` — injected on `nichelens.ai`; relays `window.postMessage` ↔ service worker so the page can request browser-side fetches
- `popup.html` + `popup.js` — toolbar icon UI (alternative entry point)
- `options.html` + `options.js` — set custom NicheLens URL
