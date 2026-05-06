// Inject a floating "Connect to RedLens" button onto every xiaohongshu.com page.
// Click it → service worker reads cookies → opens RedLens with cookie in URL fragment.

(function () {
  if (window.__redlensInjected) return;
  window.__redlensInjected = true;

  // Don't inject in iframes
  if (window.self !== window.top) return;

  const root = document.createElement("div");
  root.id = "redlens-fab";
  root.innerHTML = `
    <div class="redlens-fab-btn" id="redlens-fab-btn">
      <span class="redlens-lens"></span>
      <span class="redlens-label">Connect to RedLens</span>
    </div>
    <div class="redlens-fab-status" id="redlens-fab-status"></div>
  `;
  document.documentElement.appendChild(root);

  const btn = root.querySelector("#redlens-fab-btn");
  const status = root.querySelector("#redlens-fab-status");

  function showStatus(msg, kind) {
    status.textContent = msg;
    status.className = "redlens-fab-status visible " + (kind || "");
    setTimeout(() => {
      status.className = "redlens-fab-status";
    }, 4000);
  }

  btn.addEventListener("click", async () => {
    btn.classList.add("loading");
    btn.querySelector(".redlens-label").textContent = "Connecting…";

    try {
      const cookieResp = await chrome.runtime.sendMessage({ type: "getXhsCookies" });
      if (!cookieResp || !cookieResp.ok) {
        const missing = (cookieResp && cookieResp.missing && cookieResp.missing.length)
          ? `Missing: ${cookieResp.missing.join(", ")}. Make sure you're logged in.`
          : (cookieResp && cookieResp.error) || "Could not read cookies.";
        showStatus(missing, "err");
        btn.classList.remove("loading");
        btn.querySelector(".redlens-label").textContent = "Connect to RedLens";
        return;
      }

      const urlResp = await chrome.runtime.sendMessage({ type: "getRedlensUrl" });
      const redlensUrl = (urlResp && urlResp.url) || "https://redlens-production.up.railway.app";

      const target = `${redlensUrl}/#xhs_cookie=${encodeURIComponent(cookieResp.cookieStr)}`;
      window.open(target, "_blank");

      showStatus("Opened RedLens — connection complete.", "ok");
      btn.classList.remove("loading");
      btn.querySelector(".redlens-label").textContent = "Connect to RedLens";
    } catch (e) {
      showStatus("Error: " + (e && e.message ? e.message : String(e)), "err");
      btn.classList.remove("loading");
      btn.querySelector(".redlens-label").textContent = "Connect to RedLens";
    }
  });
})();
