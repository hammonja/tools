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

## Tests

```powershell
pip install -r requirements-dev.txt
pytest
```
