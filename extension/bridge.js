// Injected on nichelens.ai pages. Acts as a postMessage <-> chrome.runtime
// relay so the page can ask the extension to make authenticated XHS/Douyin
// API calls from inside the user's logged-in tab — bypassing server-IP blocks.

(function () {
  if (window.__nichelensBridge) return;
  window.__nichelensBridge = true;

  const VERSION = chrome.runtime.getManifest().version;

  // Tell the page the extension is present. Page code can listen for this
  // event (or send NICHELENS_PING and receive NICHELENS_PONG below).
  window.postMessage({ type: "NICHELENS_READY", version: VERSION }, window.location.origin);

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== "object") return;

    if (msg.type === "NICHELENS_PING") {
      window.postMessage({ type: "NICHELENS_PONG", version: VERSION, requestId: msg.requestId }, window.location.origin);
      return;
    }

    if (msg.type === "NICHELENS_FETCH" && msg.requestId) {
      const { requestId, platform, path, method, params, body } = msg;
      chrome.runtime.sendMessage(
        { type: "extensionFetch", platform, path, method, params, body },
        (resp) => {
          window.postMessage(
            { type: "NICHELENS_FETCH_RESULT", requestId, result: resp },
            window.location.origin
          );
        }
      );
    }
  });
})();
