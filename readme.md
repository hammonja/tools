# Toolbox catalogue

A phone-friendly Flask website for cataloguing workshop tools. Take or upload a photo, use OpenAI vision to draft the manufacturer, model, category and specifications, review the result, and save it to a local JSON file.

## Set up

```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
Copy-Item .env.example .env
```

Add an OpenAI API key to `.env`. This uses the API separately from a ChatGPT subscription; create and manage keys at <https://platform.openai.com/api-keys>. The app works for manual entries without a key.

Photo identification defaults to `gpt-6-luna` using the Responses API with structured tool fields. If an existing deployment sets `OPENAI_MODEL` in `.env` or its service environment, change it to `gpt-6-luna` there as well; explicit overrides are respected. See the [GPT-6 Luna model documentation](https://developers.openai.com/api/docs/models/gpt-6-luna).

After clicking **Analyse photograph**, the page shows upload progress followed by “Photo uploaded — identifying the tool…”. Duplicate submissions are blocked while it is working. Connection errors and timeouts keep the selected photo available for retry; an AI failure still offers the uploaded photo for manual entry.

A service can select the model without editing its credentials file: `python app.py --openai-model gpt-6-luna`. In PiDash, use `app.py --openai-model gpt-6-luna` as the program, update the service definition, and restart it. This explicit startup option takes priority over `OPENAI_MODEL`; startup logs show the selected model without credentials.

Run it:

```powershell
python app.py
```

Open <http://localhost:3030>. To use it from a phone on the same trusted Wi-Fi, allow Python through the Windows firewall if prompted, find the computer's local IPv4 address with `ipconfig`, then open `http://YOUR-PC-IP:3030` on the phone. The photo input uses `capture="environment"`, which offers the rear camera on supporting mobile browsers.

## Install on a phone

The site includes a web app manifest, phone icons, and a service worker. Once it is served over trusted HTTPS:

- On Android, open it in Chrome and use the **Install app** button (or the browser's install menu).
- On iPhone, open it in Safari, tap **Share**, then **Add to Home Screen**.

`http://localhost` is treated as secure when browsing on the computer itself, but `http://YOUR-PC-IP:3030` is not a secure browser context on a phone. The site and camera upload still work over trusted local Wi-Fi, but the service worker and full PWA installation require a trusted HTTPS certificate or HTTPS tunnel. This is a browser security requirement; no public hosting or database migration is required.

The generated app icons are committed to `static/icons`. If the source design changes, regenerate them on Windows with:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\tools\generate_pwa_icons.ps1
```

Tool records are in `data/tools.json`; uploaded photos are in `uploads/`. Back up both together. This JSON approach is suitable for a small personal catalogue; moving to SQLite is the natural next step for multi-user or larger use.

## Local catalogue and synchronisation

On HTTPS (or localhost), opening the catalogue saves every tool record and its photo on that device. It displays the saved catalogue immediately on later visits, then checks the server when opened, restored, returned to the foreground, or reconnected. **Sync now** retries manually. Search, category filters, specifications, serial numbers and notes work offline.

The server remains authoritative. A successful sync replaces changed records, downloads new or changed photos, and removes deleted records and unused photos from the device. Unchanged photos are reused; photo URLs include a file modification/size version. `/api/tools` always returns the full catalogue regardless of the visible filter. A snapshot is committed only after all its photos are stored. Invalid responses, failed downloads and storage errors preserve the last complete saved copy and show a status message. A confirmed empty catalogue clears the saved tools and photos.

Adding, editing, deleting and AI analysis still need the server; there is no offline write queue. Browsers can evict local storage, so this is an offline convenience, not a backup. The first complete download needs a connection and enough device storage. Each browser/device keeps its own copy. Cache cleanup is limited to Toolbox caches.

After deploying an update, open the app online to receive the new worker, then close and reopen it if necessary. Reinstallation is not needed. The app's installation button appears only in supported mobile browsers and hides inside the installed app.

## Tests

```powershell
pip install -r requirements-dev.txt
pytest
```

The Python tests use isolated temporary catalogues and mock AI requests. Service worker tests use Node 18+:

```powershell
node --test tests/service-worker.test.cjs tests/pwa.test.cjs
```
