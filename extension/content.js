// Inject a floating "Connect to NicheLens" button on every supported page.
// Click → page reads document.cookie (anti-bot tokens) → service worker reads
// chrome.cookies (HttpOnly auth) → merge → open NicheLens already authenticated.

(function () {
  if (window.__redlensInjected) return;
  window.__redlensInjected = true;

  // Don't inject in iframes
  if (window.self !== window.top) return;

  const host = location.hostname;
  let platform = null;
  let label = null;
  if (host.endsWith("xiaohongshu.com")) {
    platform = "xhs";
    label = "Connect 小红书";
  } else if (host.endsWith("douyin.com")) {
    platform = "douyin";
    label = "Connect 抖音";
  } else {
    return;
  }

  const root = document.createElement("div");
  root.id = "redlens-fab";
  root.className = `redlens-fab-${platform}`;
  root.innerHTML = `
    <div class="redlens-fab-btn" id="redlens-fab-btn">
      <span class="redlens-lens"></span>
      <span class="redlens-label">${label}</span>
    </div>
    <div class="redlens-fab-status" id="redlens-fab-status"></div>
  `;
  document.documentElement.appendChild(root);

  const btn = root.querySelector("#redlens-fab-btn");
  const status = root.querySelector("#redlens-fab-status");
  const labelEl = btn.querySelector(".redlens-label");

  function showStatus(msg, kind) {
    status.textContent = msg;
    status.className = "redlens-fab-status visible " + (kind || "");
    setTimeout(() => {
      status.className = "redlens-fab-status";
    }, 4000);
  }

  function resetBtn() {
    btn.classList.remove("loading");
    labelEl.textContent = label;
  }

  btn.addEventListener("click", async () => {
    btn.classList.add("loading");
    labelEl.textContent = "Connecting…";

    try {
      const pageCookieStr = document.cookie || "";
      const cookieResp = await chrome.runtime.sendMessage({
        type: "getPlatformCookies",
        platform,
        pageCookieStr,
      });

      if (!cookieResp || !cookieResp.ok) {
        let msg;
        if (cookieResp && cookieResp.missing && cookieResp.missing.length) {
          msg = `Missing: ${cookieResp.missing.join(", ")}. Make sure you're logged in.`;
          if (cookieResp.diagnostics) {
            console.log("[NicheLens] cookie diagnostics", cookieResp.diagnostics);
          }
        } else {
          msg = (cookieResp && cookieResp.error) || "Could not read cookies.";
        }
        showStatus(msg, "err");
        resetBtn();
        return;
      }

      const urlResp = await chrome.runtime.sendMessage({ type: "getRedlensUrl" });
      const baseUrl = (urlResp && urlResp.url) || "https://nichelens.ai";
      const target = `${baseUrl}/#${cookieResp.fragmentKey}=${encodeURIComponent(cookieResp.cookieStr)}`;
      window.open(target, "_blank");

      showStatus("Opened NicheLens — connection complete.", "ok");
      resetBtn();
    } catch (e) {
      showStatus("Error: " + (e && e.message ? e.message : String(e)), "err");
      resetBtn();
    }
  });
})();
