const REQUIRED = ["web_session", "a1"];
const DOMAIN = ".xiaohongshu.com";
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

async function getRedlensUrl() {
  const stored = await chrome.storage.local.get("redlensUrl");
  return (stored.redlensUrl || DEFAULT_REDLENS_URL).replace(/\/+$/, "");
}

async function loadCookies() {
  const cookies = await chrome.cookies.getAll({ domain: DOMAIN });
  if (!cookies.length) {
    setStatus("No xiaohongshu.com cookies. Log in there first, then reopen.", "err");
    return null;
  }
  const missing = REQUIRED.filter(name => !cookies.some(c => c.name === name));
  if (missing.length) {
    setStatus(`Missing cookie(s): ${missing.join(", ")}. Make sure you're logged in.`, "err");
    return null;
  }
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
  setStatus(`Found ${cookies.length} cookies including web_session.`, "ok");
  sendBtn.disabled = false;
  return cookieStr;
}

let cached = null;
let redlensUrl = DEFAULT_REDLENS_URL;

(async () => {
  redlensUrl = await getRedlensUrl();
  targetEl.textContent = redlensUrl;
  try {
    cached = await loadCookies();
  } catch (e) {
    setStatus("Error: " + e.message, "err");
  }
})();

sendBtn.addEventListener("click", async () => {
  if (!cached) return;
  // Cookie travels in the URL fragment (#) so it never hits server logs.
  const encoded = encodeURIComponent(cached);
  const target = `${redlensUrl}/#xhs_cookie=${encoded}`;
  await chrome.tabs.create({ url: target });
  setStatus("Opened RedLens. Connection should be active in that tab.", "ok");
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
