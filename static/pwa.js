(() => {
  const notifyWorker = (worker) => window.dispatchEvent(new CustomEvent("toolbox-worker-ready", {detail: worker}));
  if ("serviceWorker" in navigator && window.isSecureContext) {
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (navigator.serviceWorker.controller) notifyWorker(navigator.serviceWorker.controller);
    });
    navigator.serviceWorker.register("/service-worker.js", {updateViaCache: "none"})
      .then(async () => {
        let timer;
        try {
          const ready = await Promise.race([
            navigator.serviceWorker.ready,
            new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Offline setup unavailable")), 15000); })
          ]);
          notifyWorker(ready.active);
        } finally { clearTimeout(timer); }
      }).catch(() => {
        if (navigator.serviceWorker.controller) notifyWorker(navigator.serviceWorker.controller);
        else window.dispatchEvent(new Event("toolbox-worker-unavailable"));
      });
  } else window.dispatchEvent(new Event("toolbox-worker-unavailable"));

  let installPrompt;
  let accepted = false;
  const installButton = document.getElementById("install-app");
  const displayMode = window.matchMedia("(display-mode: standalone)");
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isMobile = isIOS || /Android/.test(navigator.userAgent) || navigator.userAgentData?.mobile === true;
  function installationVisibility() {
    if (installButton) installButton.hidden = !window.isSecureContext || !isMobile || accepted || displayMode.matches || navigator.standalone === true;
  }
  installationVisibility();
  if (displayMode.addEventListener) displayMode.addEventListener("change", installationVisibility);
  else displayMode.addListener?.(installationVisibility);
  window.addEventListener("pageshow", installationVisibility);
  document.addEventListener("visibilitychange", installationVisibility);
  window.addEventListener("beforeinstallprompt", (event) => {
    event.preventDefault();
    installPrompt = event;
    installationVisibility();
  });
  installButton?.addEventListener("click", async () => {
    if (installPrompt) {
      await installPrompt.prompt();
      accepted = (await installPrompt.userChoice).outcome === "accepted";
      installPrompt = undefined;
      installationVisibility();
    } else {
      alert(isIOS ? "In your browser's Share menu, choose Add to Home Screen. If it isn't available, open this site in Safari." :
        "Open your browser menu and choose Install app, Add app to Home screen, or Add to Home screen.");
    }
  });
  window.addEventListener("appinstalled", () => { accepted = true; installPrompt = undefined; installationVisibility(); });

  let previewURL;
  document.addEventListener("change", (event) => {
    if (event.target.id !== "photo") return;
    const file = event.target.files[0];
    if (previewURL) URL.revokeObjectURL(previewURL);
    if (!file) { document.getElementById("preview-wrap").hidden = true; return; }
    previewURL = URL.createObjectURL(file);
    document.getElementById("preview").src = previewURL;
    document.getElementById("file-name").textContent = file.name;
    document.getElementById("preview-wrap").hidden = false;
  });

  document.addEventListener("submit", (event) => {
    const form = event.target;
    if (form.method.toLowerCase() !== "post") return;
    if (navigator.onLine === false) {
      event.preventDefault();
      alert("You're offline. Reconnect before saving, deleting or analysing tools. Your entered details are still here.");
      return;
    }
    if (form.id !== "photo-form") return;
    event.preventDefault();
    if (form.dataset.busy === "true") return;
    const fileInput = form.querySelector('input[type="file"]');
    if (!fileInput.files.length) return;
    if (fileInput.files[0].size > 16 * 1024 * 1024) {
      alert("That photo is too large. Choose a photo smaller than 16 MB.");
      return;
    }
    const button = form.querySelector('button[type="submit"]');
    const progress = document.getElementById("analysis-progress");
    const status = document.getElementById("analysis-status");
    const data = new FormData(form);
    form.dataset.busy = "true";
    form.setAttribute("aria-busy", "true");
    button.disabled = true;
    fileInput.disabled = true;
    button.textContent = "Analysing…";
    progress.hidden = false;
    progress.classList.remove("failed");
    status.textContent = "Uploading photo…";
    const xhr = new XMLHttpRequest();
    xhr.open("POST", form.action);
    xhr.timeout = 180000;
    const slow = setTimeout(() => {
      if (form.dataset.busy === "true") status.textContent = "Still working on your photo. Please keep this page open…";
    }, 30000);
    function failed(message) {
      clearTimeout(slow);
      form.dataset.busy = "false";
      form.removeAttribute("aria-busy");
      button.disabled = false;
      fileInput.disabled = false;
      button.textContent = "Try analysis again";
      progress.classList.add("failed");
      status.textContent = message;
    }
    xhr.upload.onprogress = (upload) => {
      status.textContent = upload.lengthComputable ? `Uploading photo… ${Math.round(upload.loaded / upload.total * 100)}%` : "Uploading photo…";
    };
    xhr.upload.onload = () => { status.textContent = "Photo uploaded — identifying the tool…"; };
    xhr.onerror = () => failed("Connection lost. Your photo is still selected. Reconnect and try again.");
    xhr.ontimeout = () => failed("Analysis took too long. Your photo is still selected; please try again.");
    xhr.onabort = () => failed("Analysis was cancelled. You can try again.");
    xhr.onload = () => {
      const page = new DOMParser().parseFromString(xhr.responseText, "text/html");
      const main = page.querySelector("main.page-shell");
      // Only accept the server's review form, never a login page or error document.
      if (![200, 503].includes(xhr.status) || !main?.querySelector('form[action="/tools/save-analysis"]')) {
        failed(xhr.status === 413 ? "That photo is too large. Choose a smaller photo and try again." :
          "The server could not analyse this photo. Please try again; your photo is still selected.");
        return;
      }
      clearTimeout(slow);
      document.querySelector("main.page-shell").replaceChildren(...main.childNodes);
      document.title = page.title;
      window.scrollTo({top: 0, behavior: "smooth"});
      const heading = document.querySelector("main h1");
      heading?.setAttribute("tabindex", "-1");
      heading?.focus({preventScroll: true});
      if (previewURL) { URL.revokeObjectURL(previewURL); previewURL = undefined; }
    };
    try { xhr.send(data); }
    catch (_) { failed("Could not send the photo. Please check your connection and try again."); }
  });
})();
