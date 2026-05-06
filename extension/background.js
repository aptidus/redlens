// Service worker: only place that can use chrome.cookies API.
// Content scripts and popup ask us via runtime.sendMessage.

const DEFAULT_REDLENS_URL = "https://redlens-production.up.railway.app";

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "getXhsCookies") {
    (async () => {
      try {
        const cookies = await chrome.cookies.getAll({ domain: ".xiaohongshu.com" });
        const required = ["web_session", "a1"];
        const missing = required.filter(name => !cookies.some(c => c.name === name));
        const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
        sendResponse({ ok: missing.length === 0, missing, cookieStr, count: cookies.length });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true; // keep channel open for async sendResponse
  }
  if (msg && msg.type === "getRedlensUrl") {
    chrome.storage.local.get("redlensUrl").then(stored => {
      sendResponse({ url: (stored.redlensUrl || DEFAULT_REDLENS_URL).replace(/\/+$/, "") });
    });
    return true;
  }
});
