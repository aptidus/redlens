const DEFAULT_REDLENS_URL = "https://redlens-production.up.railway.app";

const statusEl = document.getElementById("status");
const sendBtn = document.getElementById("send");
const copyBtn = document.getElementById("copy");
const targetEl = document.getElementById("target");
const settingsBtn = document.getElementById("settings");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

let cached = null;
let redlensUrl = DEFAULT_REDLENS_URL;

(async () => {
  const urlResp = await chrome.runtime.sendMessage({ type: "getRedlensUrl" });
  redlensUrl = (urlResp && urlResp.url) || DEFAULT_REDLENS_URL;
  targetEl.textContent = redlensUrl;

  const cookieResp = await chrome.runtime.sendMessage({ type: "getXhsCookies" });
  if (!cookieResp || !cookieResp.ok) {
    if (cookieResp && cookieResp.missing && cookieResp.missing.length) {
      setStatus(`Missing cookie(s): ${cookieResp.missing.join(", ")}. Make sure you're logged in to xiaohongshu.com.`, "err");
    } else {
      setStatus("No xiaohongshu.com cookies. Log in there first, then reopen.", "err");
    }
    return;
  }
  cached = cookieResp.cookieStr;
  setStatus(`Found ${cookieResp.count} cookies including web_session. Tip: a button is also injected on the XHS page itself.`, "ok");
  sendBtn.disabled = false;
})();

sendBtn.addEventListener("click", async () => {
  if (!cached) return;
  const target = `${redlensUrl}/#xhs_cookie=${encodeURIComponent(cached)}`;
  await chrome.tabs.create({ url: target });
  setStatus("Opened RedLens.", "ok");
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
