(() => {
  const results = document.getElementById("catalogue-results");
  if (!results) return;
  const form = document.getElementById("catalogue-filters");
  const status = document.getElementById("sync-status");
  const syncButton = document.getElementById("sync-now");
  let tools = null;
  let worker;
  let busy = false;
  let savedAt;
  let lastAttempt = 0;
  const escape = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[char]));

  function apply(data) {
    tools = data.tools;
    const current = new URLSearchParams(location.search);
    form.elements.q.value = current.get("q") || "";
    const category = current.get("category") || "";
    const categories = [...new Set(tools.map((tool) => tool.category || "Uncategorised"))].sort();
    if (category && !categories.includes(category)) categories.push(category);
    form.elements.category.innerHTML = '<option value="">All categories</option>' +
      categories.map((item) => `<option value="${escape(item)}">${escape(item)}</option>`).join("");
    form.elements.category.value = category;
    render();
  }

  function render() {
    if (!tools) return;
    const q = form.elements.q.value.trim().toLowerCase();
    const category = form.elements.category.value;
    const fields = ["name", "manufacturer", "model", "category", "subcategory", "notes", "serial_number", "specifications"];
    const shown = tools.filter((tool) => (!category || tool.category === category) &&
      (!q || fields.some((field) => String(tool[field] || "").toLowerCase().includes(q))))
      .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
    document.getElementById("item-count").textContent = shown.reduce((count, tool) => count + Number(tool.quantity || 1), 0);
    results.innerHTML = shown.length ? `<div class="tool-grid">${shown.map((tool) => `
      <article class="tool-card">
        <div class="tool-photo">
          ${tool.image_url ? `<img src="${escape(tool.image_url)}" alt="${escape(tool.name)}" loading="lazy">` : '<span class="photo-placeholder">No photo</span>'}
          <span class="category-pill">${escape(tool.subcategory || tool.category)}</span>
        </div>
        <div class="tool-body">
          <div class="maker">${escape(tool.manufacturer)}</div><h2>${escape(tool.name)}</h2>
          <dl><div><dt>Model</dt><dd>${escape(tool.model)}</dd></div><div><dt>Qty</dt><dd>${escape(tool.quantity)}</dd></div><div><dt>Condition</dt><dd>${escape(tool.condition)}</dd></div></dl>
          ${tool.specifications?.length ? `<p class="specs">${escape(tool.specifications.join(" · "))}</p>` : ""}
          ${tool.notes || tool.serial_number ? `<details class="tool-notes"><summary>More details</summary>${tool.serial_number ? `<p>Serial number: ${escape(tool.serial_number)}</p>` : ""}<p>${escape(tool.notes)}</p></details>` : ""}
          <div class="card-actions"><a class="text-link" href="/tools/${encodeURIComponent(tool.id)}/edit">Edit details</a>
            <form method="post" action="/tools/${encodeURIComponent(tool.id)}/delete" onsubmit="return confirm('Remove this tool?')"><button class="delete-link" type="submit">Delete</button></form>
          </div>
        </div>
      </article>`).join("")}</div>` : `<section class="empty-state"><span class="empty-icon">⌁</span>
      <h2>${q || category ? "No matching tools" : "Your catalogue is ready"}</h2><p>${q || category ? "Try a different search or category." : "Take a photo of your first tool or add its details manually."}</p>
      <a class="button button-primary" href="/tools/new">Photograph a tool</a></section>`;
  }

  form.addEventListener("submit", (event) => {
    if (tools === null) return;
    event.preventDefault();
    const params = new URLSearchParams(new FormData(form));
    history.replaceState(null, "", "/?" + params.toString());
    render();
  });
  form.elements.category.addEventListener("change", () => form.requestSubmit());

  function message(type) {
    return new Promise((resolve, reject) => {
      const channel = new MessageChannel();
      let timer;
      const cleanup = () => {
        clearTimeout(timer);
        channel.port1.close();
        navigator.serviceWorker.removeEventListener("message", heartbeat);
      };
      const heartbeat = () => {
        clearTimeout(timer);
        timer = setTimeout(() => { cleanup(); reject(new Error("Sync timed out")); }, type === "GET_CATALOGUE" ? 8000 : 60000);
      };
      navigator.serviceWorker.addEventListener("message", heartbeat);
      heartbeat();
      channel.port1.onmessage = ({data}) => {
        cleanup();
        if (data.error) reject(new Error(data.error)); else resolve(data);
      };
      worker.postMessage({type}, [channel.port2]);
    });
  }

  function unavailable() {
    const date = savedAt ? ` Last saved ${new Date(savedAt).toLocaleString()}.` : "";
    status.textContent = tools !== null ? `Server unavailable — browsing ${savedAt ? "saved" : "available"} tools.${date}` :
      "No saved catalogue yet. Connect to the server and tap Sync now.";
  }

  async function sync() {
    if (busy) return;
    if (navigator.onLine === false) { unavailable(); return; }
    busy = true;
    lastAttempt = Date.now();
    syncButton.disabled = true;
    status.textContent = "Checking for catalogue updates…";
    try {
      let result;
      if (worker) result = await message("SYNC_CATALOGUE");
      else {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 20000);
        try {
          const response = await fetch("/api/tools", {cache: "no-store", signal: controller.signal});
          if (!response.ok || response.redirected) throw new Error("Server unavailable");
          const data = await response.json();
          if (data.schema_version !== 1 || !Array.isArray(data.tools)) throw new Error("Invalid catalogue");
          result = {data, saved: false};
        } finally { clearTimeout(timer); }
      }
      apply(result.data);
      if (result.saved) {
        savedAt = result.data.synced_at;
        status.textContent = `${tools.length} ${tools.length === 1 ? "tool and its photo" : "tools and their photos"} saved for offline use. Synced ${new Date(savedAt).toLocaleTimeString([], {hour: "2-digit", minute: "2-digit"})}.`;
      } else {
        status.textContent = worker ? "Catalogue updated. Could not save every photo offline — check your connection or free some device storage, then retry." :
          "Catalogue updated. Offline storage is unavailable; use HTTPS and allow browser storage.";
      }
    } catch (_) { unavailable(); }
    finally { busy = false; syncButton.disabled = false; }
  }

  syncButton.hidden = false;
  syncButton.addEventListener("click", sync);
  window.addEventListener("online", sync);
  window.addEventListener("offline", unavailable);
  window.addEventListener("pageshow", (event) => { if (event.persisted) sync(); });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && Date.now() - lastAttempt > 1000) sync();
  });
  window.addEventListener("toolbox-worker-ready", async ({detail}) => {
    worker = detail;
    try {
      const cached = await message("GET_CATALOGUE");
      if (cached.data) { savedAt = cached.data.synced_at; apply(cached.data); }
    } catch (_) { if (worker === detail) worker = null; }
    if (worker && worker !== detail) return;
    await sync();
  });
  window.addEventListener("toolbox-worker-unavailable", sync);
  navigator.serviceWorker?.addEventListener("message", ({data}) => {
    if (data.type === "SYNC_PROGRESS" && busy) status.textContent = `Saving photos for offline use… ${data.complete} of ${data.total}`;
  });
})();
