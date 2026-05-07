const DEFAULT_REDLENS_URL = "https://nichelens.ai";

const urlInput = document.getElementById("url");
const saveBtn = document.getElementById("save");
const savedEl = document.getElementById("saved");

(async () => {
  const stored = await chrome.storage.local.get("redlensUrl");
  urlInput.value = stored.redlensUrl || "";
  urlInput.placeholder = DEFAULT_REDLENS_URL;
})();

saveBtn.addEventListener("click", async () => {
  let url = urlInput.value.trim();
  if (url && !/^https?:\/\//i.test(url)) url = "https://" + url;
  url = url.replace(/\/+$/, "");
  await chrome.storage.local.set({ redlensUrl: url });
  savedEl.textContent = "✓ Saved";
  setTimeout(() => { savedEl.textContent = ""; }, 2000);
});
