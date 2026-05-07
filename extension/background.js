// Service worker: only place that can use chrome.cookies API.
// Content scripts and popup ask us via runtime.sendMessage.

const DEFAULT_REDLENS_URL = "https://nichelens.ai";

const PLATFORMS = {
  xhs: {
    domain: "xiaohongshu.com",
    urls: [
      "https://www.xiaohongshu.com/",
      "https://xiaohongshu.com/",
      "https://creator.xiaohongshu.com/",
      "https://edith.xiaohongshu.com/",
    ],
    required: ["web_session", "a1"],
    fragmentKey: "xhs_cookie",
  },
  douyin: {
    domain: "douyin.com",
    urls: [
      "https://www.douyin.com/",
      "https://douyin.com/",
      "https://creator.douyin.com/",
      "https://live.douyin.com/",
    ],
    required: ["sessionid_ss", "ttwid", "msToken"],
    fragmentKey: "douyin_cookie",
  },
};

async function safeGetAll(query) {
  try {
    return await chrome.cookies.getAll(query);
  } catch (e) {
    return [];
  }
}

async function collectCookies(platform) {
  const cfg = PLATFORMS[platform];
  if (!cfg) return [];
  const buckets = await Promise.all([
    safeGetAll({ domain: cfg.domain }),
    ...cfg.urls.map(url => safeGetAll({ url })),
    // Also probe partitioned store, harmless if empty.
    ...cfg.urls.map(url => safeGetAll({ url, partitionKey: {} })),
  ]);
  const seen = new Map();
  for (const bucket of buckets) {
    for (const c of bucket) {
      const key = `${c.name}|${c.domain}|${c.path}|${c.partitionKey ? JSON.stringify(c.partitionKey) : ""}`;
      if (!seen.has(key)) seen.set(key, c);
    }
  }
  return Array.from(seen.values());
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "getPlatformCookies") {
    (async () => {
      try {
        const platform = msg.platform;
        const cfg = PLATFORMS[platform];
        if (!cfg) {
          sendResponse({ ok: false, error: `Unknown platform: ${platform}` });
          return;
        }

        const cookies = await collectCookies(platform);

        // Merge browser-jar cookies (HttpOnly server cookies) with page-jar
        // cookies (JS-injected anti-bot cookies — XHS `a1`, Douyin `msToken`).
        // Page values win on conflict — they're the freshest (msToken rotates).
        const byName = new Map();
        for (const c of cookies) {
          if (!byName.has(c.name)) byName.set(c.name, c.value);
        }
        const pageCookieStr = (msg.pageCookieStr || "").trim();
        if (pageCookieStr) {
          for (const part of pageCookieStr.split(";")) {
            const eq = part.indexOf("=");
            if (eq < 0) continue;
            const name = part.slice(0, eq).trim();
            const value = part.slice(eq + 1).trim();
            if (name) byName.set(name, value); // page wins
          }
        }

        const missing = cfg.required.filter(name => !byName.has(name));
        const cookieStr = Array.from(byName.entries()).map(([n, v]) => `${n}=${v}`).join("; ");
        const diagnostics = missing.length
          ? {
              foundNames: Array.from(byName.keys()).sort(),
              foundDomains: Array.from(new Set(cookies.map(c => c.domain))).sort(),
            }
          : undefined;
        sendResponse({
          ok: missing.length === 0,
          missing,
          cookieStr,
          count: byName.size,
          fragmentKey: cfg.fragmentKey,
          diagnostics,
        });
      } catch (e) {
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (msg && msg.type === "getRedlensUrl") {
    chrome.storage.local.get("redlensUrl").then(stored => {
      sendResponse({ url: (stored.redlensUrl || DEFAULT_REDLENS_URL).replace(/\/+$/, "") });
    });
    return true;
  }

  if (msg && msg.type === "extensionFetch") {
    handleExtensionFetch(msg).then(sendResponse).catch(err => {
      sendResponse({ ok: false, error: String(err && err.message || err) });
    });
    return true;
  }
});

const PLATFORM_ORIGINS = {
  xhs: "https://www.xiaohongshu.com/",
  douyin: "https://www.douyin.com/",
};

const PLATFORM_HOST_MATCH = {
  xhs: "*.xiaohongshu.com",
  douyin: "*.douyin.com",
};

async function findOrCreateTab(platform) {
  const hostMatch = PLATFORM_HOST_MATCH[platform];
  if (!hostMatch) throw new Error(`Unknown platform: ${platform}`);
  const tabs = await chrome.tabs.query({ url: `https://${hostMatch}/*` });
  for (const t of tabs) {
    if (t.id != null && t.status !== "unloaded") return t;
  }
  // No suitable tab — open one in the background so the user notices.
  return await chrome.tabs.create({ url: PLATFORM_ORIGINS[platform], active: false });
}

async function waitForTabComplete(tabId, timeoutMs = 15000) {
  const t = await chrome.tabs.get(tabId);
  if (t.status === "complete") return;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener);
      reject(new Error("Tab load timeout"));
    }, timeoutMs);
    function listener(updatedId, changeInfo) {
      if (updatedId === tabId && changeInfo.status === "complete") {
        clearTimeout(timer);
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }
    }
    chrome.tabs.onUpdated.addListener(listener);
  });
}

// Runs INSIDE the user's xiaohongshu.com / douyin.com tab in the MAIN world,
// so XHS/Douyin's own JS (webmssdk.js etc.) can sign the request automatically.
function pageFetch(url, options) {
  return fetch(url, { ...(options || {}), credentials: "include" })
    .then(async (r) => {
      const ct = r.headers.get("content-type") || "";
      const text = await r.text();
      let body = text;
      if (ct.includes("application/json")) {
        try { body = JSON.parse(text); } catch {}
      }
      return { status: r.status, ok: r.ok, headers: { "content-type": ct }, body };
    })
    .catch((e) => ({ status: 0, ok: false, error: String(e && e.message || e) }));
}

async function handleExtensionFetch(msg) {
  const { platform, path, method = "GET", params, body } = msg;
  if (!PLATFORM_ORIGINS[platform]) {
    return { ok: false, error: `Unknown platform: ${platform}` };
  }
  if (!path || typeof path !== "string") {
    return { ok: false, error: "path required" };
  }

  // Build the URL. Path may be a full URL (https://edith.xiaohongshu.com/api/...)
  // or a path that we resolve against the platform's API host.
  const PLATFORM_API_HOST = {
    xhs: "https://edith.xiaohongshu.com",
    douyin: "https://www.douyin.com",
  };
  let fullUrl;
  if (/^https?:\/\//i.test(path)) {
    fullUrl = path;
  } else {
    fullUrl = PLATFORM_API_HOST[platform] + (path.startsWith("/") ? path : "/" + path);
  }
  if (params && typeof params === "object") {
    const u = new URL(fullUrl);
    for (const [k, v] of Object.entries(params)) {
      if (v != null) u.searchParams.set(k, String(v));
    }
    fullUrl = u.toString();
  }

  const fetchOptions = { method };
  if (body !== undefined && body !== null) {
    fetchOptions.headers = { "Content-Type": "application/json" };
    fetchOptions.body = typeof body === "string" ? body : JSON.stringify(body);
  }

  const tab = await findOrCreateTab(platform);
  await waitForTabComplete(tab.id);

  const [{ result, error: scriptingError }] = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    world: "MAIN",
    func: pageFetch,
    args: [fullUrl, fetchOptions],
  });

  if (scriptingError) return { ok: false, error: String(scriptingError) };
  if (!result) return { ok: false, error: "No result from page fetch" };
  return { ok: true, ...result };
}
