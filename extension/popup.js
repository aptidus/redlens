const DEFAULT_REDLENS_URL = "https://nichelens.ai";

const statusEl = document.getElementById("status");
const sendBtn = document.getElementById("send");
const copyBtn = document.getElementById("copy");
const targetEl = document.getElementById("target");
const settingsBtn = document.getElementById("settings");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

function detectPlatform(url) {
  try {
    const host = new URL(url).hostname;
    if (host.endsWith("xiaohongshu.com")) return "xhs";
    if (host.endsWith("douyin.com")) return "douyin";
  } catch {}
  return null;
}

let cached = null;
let redlensUrl = DEFAULT_REDLENS_URL;
let cachedFragmentKey = null;

(async () => {
  const urlResp = await chrome.runtime.sendMessage({ type: "getRedlensUrl" });
  redlensUrl = (urlResp && urlResp.url) || DEFAULT_REDLENS_URL;
  targetEl.textContent = redlensUrl;

  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const platform = tab && tab.url ? detectPlatform(tab.url) : null;
  if (!platform) {
    setStatus("Open a xiaohongshu.com or douyin.com tab, then reopen this popup.", "err");
    return;
  }

  // Read document.cookie from the page (anti-bot tokens that aren't in chrome.cookies).
  let pageCookieStr = "";
  try {
    const [{ result }] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => document.cookie || "",
    });
    pageCookieStr = result || "";
  } catch (e) {
    // scripting permission may be missing in popup context; service worker still gets HttpOnly cookies.
  }

  const cookieResp = await chrome.runtime.sendMessage({
    type: "getPlatformCookies",
    platform,
    pageCookieStr,
  });
  if (!cookieResp || !cookieResp.ok) {
    if (cookieResp && cookieResp.missing && cookieResp.missing.length) {
      setStatus(`Missing cookie(s): ${cookieResp.missing.join(", ")}. Make sure you're logged in.`, "err");
    } else {
      setStatus((cookieResp && cookieResp.error) || "Could not read cookies.", "err");
    }
    return;
  }
  cached = cookieResp.cookieStr;
  cachedFragmentKey = cookieResp.fragmentKey;
  const platformLabel = platform === "xhs" ? "小红书" : "抖音";
  setStatus(`Found ${cookieResp.count} ${platformLabel} cookies. Tip: a button is also injected on the page.`, "ok");
  sendBtn.disabled = false;
})();

sendBtn.addEventListener("click", async () => {
  if (!cached || !cachedFragmentKey) return;
  const target = `${redlensUrl}/#${cachedFragmentKey}=${encodeURIComponent(cached)}`;
  await chrome.tabs.create({ url: target });
  setStatus("Opened NicheLens.", "ok");
  setTimeout(() => window.close(), 600);
});

copyBtn.addEventListener("click", async () => {
  if (!cached) return;
  try {
    await navigator.clipboard.writeText(cached);
    setStatus("Copied to clipboard.", "ok");
    copyBtn.textContent = "✓ Copied";
    setTimeout(() => { copyBtn.textContent = "Or copy to clipboard"; }, 2000);
  } catch (e) {
    setStatus("Clipboard error: " + e.message, "err");
  }
});

settingsBtn.addEventListener("click", () => {
  chrome.runtime.openOptionsPage();
});
