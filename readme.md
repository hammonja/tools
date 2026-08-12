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

Tool records are in `data/tools.json`; uploaded photos are in `uploads/`. Back up both together. This JSON approach is suitable for a small personal catalogue; moving to SQLite is the natural next step for multi-user or larger use.

## Tests

```powershell
pip install -r requirements-dev.txt
pytest
```
