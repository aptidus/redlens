# RedLens Cookie Connect (Chrome Extension)

One-click connect your `xiaohongshu.com` session to RedLens. No copy/paste, no DevTools.

## Install (one time)

1. Open Chrome → `chrome://extensions`
2. Toggle **Developer mode** on (top-right)
3. Click **Load unpacked**
4. Select this `extension/` folder
5. Pin the extension (puzzle icon in toolbar → pin RedLens Cookie Connect)

## Use

1. Log into `xiaohongshu.com` in Chrome (any tab)
2. Click the RedLens extension icon
3. Click **Connect to RedLens**
4. RedLens opens — you're connected. Run an analysis.

That's it. The cookie travels in the URL fragment (`#…`), which never reaches the server log; the page reads it client-side, saves it, then scrubs the URL.

## Pointing at a different RedLens deployment

If you self-host RedLens at a different URL: extension popup → **Settings** → enter your URL.

## Permissions

| Permission | Why |
|---|---|
| `cookies` + host `*.xiaohongshu.com` | Read your XHS session cookies (including `httpOnly`) |
| `storage` | Remember your RedLens URL |

The extension makes **no network requests**. It opens a tab to RedLens with your cookie in the URL fragment.

## Fallback

If something goes wrong with the auto-connect, the popup also has an **Or copy to clipboard** button — same as the previous version.
