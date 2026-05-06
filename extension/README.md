# RedLens Cookie Grabber (Chrome Extension)

One-click copy of your full `xiaohongshu.com` cookie — including `web_session` (which `httpOnly` blocks JavaScript and bookmarklets from reading).

## Install (one time)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. Pin the extension (puzzle icon → pin RedLens Cookie Grabber)

## Use

1. Log into `xiaohongshu.com` in Chrome (any tab)
2. Click the RedLens extension icon
3. Click **Copy cookie to clipboard**
4. Paste into RedLens → "Paste cookie manually instead"

## Permissions

- `cookies` + `host_permissions` for `*.xiaohongshu.com` — read your XHS cookies (read-only, never sent anywhere)
- `clipboardWrite` — write the cookie string to your clipboard so you can paste it

The extension does **not** make any network requests. All it does is read the cookies the browser already has and copy them locally.
