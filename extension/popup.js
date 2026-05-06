const REQUIRED = ["web_session", "a1"];
const DOMAIN = ".xiaohongshu.com";

const statusEl = document.getElementById("status");
const copyBtn = document.getElementById("copy");
const metaEl = document.getElementById("meta");

function setStatus(msg, kind) {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function loadCookies() {
  const cookies = await chrome.cookies.getAll({ domain: DOMAIN });
  if (!cookies.length) {
    setStatus("No xiaohongshu.com cookies found. Log in at xiaohongshu.com first, then reopen this popup.", "err");
    return null;
  }
  const missing = REQUIRED.filter(name => !cookies.some(c => c.name === name));
  if (missing.length) {
    setStatus(`Missing required cookie(s): ${missing.join(", ")}. Make sure you're logged into xiaohongshu.com.`, "err");
    return null;
  }
  const cookieStr = cookies.map(c => `${c.name}=${c.value}`).join("; ");
  const names = cookies.map(c => c.name).sort();
  metaEl.innerHTML = `<strong>${cookies.length} cookies</strong> · includes <code>web_session</code>, <code>a1</code>`;
  setStatus("Ready. Click below to copy.", "ok");
  copyBtn.disabled = false;
  return cookieStr;
}

let cached = null;

(async () => {
  try {
    cached = await loadCookies();
  } catch (e) {
    setStatus("Error reading cookies: " + e.message, "err");
  }
})();

copyBtn.addEventListener("click", async () => {
  if (!cached) return;
  try {
    await navigator.clipboard.writeText(cached);
    setStatus("Copied! Paste into RedLens → 'Paste cookie manually instead'.", "ok");
    copyBtn.textContent = "✓ Copied";
    setTimeout(() => { copyBtn.textContent = "Copy cookie to clipboard"; }, 2500);
  } catch (e) {
    setStatus("Clipboard error: " + e.message, "err");
  }
});
