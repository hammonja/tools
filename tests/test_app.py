import io
import json

import pytest

from app import create_app
from ai_analyser import ToolAnalysis


@pytest.fixture()
def app(tmp_path):
    return create_app({
        "TESTING": True,
        "SECRET_KEY": "test",
        "DATA_FILE": tmp_path / "tools.json",
        "UPLOAD_FOLDER": tmp_path / "uploads",
    })


@pytest.fixture()
def client(app):
    return app.test_client()


def test_empty_catalogue(client):
    response = client.get("/")
    assert response.status_code == 200
    assert b"Your catalogue is ready" in response.data


def test_pwa_files_are_available(client):
    manifest = client.get("/static/manifest.webmanifest")
    assert manifest.status_code == 200
    assert manifest.json["display"] == "standalone"
    assert manifest.json["start_url"] == "/"

    worker = client.get("/service-worker.js")
    assert worker.status_code == 200
    assert worker.headers["Service-Worker-Allowed"] == "/"
    assert worker.headers["Cache-Control"] == "no-cache"

    assert client.get("/offline").status_code == 200


def test_add_edit_search_and_delete_manual_tool(client, app):
    response = client.post("/tools/new", data={
        "name": "SDS Plus rotary hammer", "manufacturer": "Titan", "model": "TTB653SDS",
        "category": "Power tools", "subcategory": "SDS rotary hammers", "quantity": "1",
        "condition": "Fair", "specifications": "1500W\nSDS Plus", "notes": "With case",
    })
    assert response.status_code == 302
    tools = app.extensions["tool_store"].list()
    assert tools[0]["manufacturer"] == "Titan"
    assert tools[0]["specifications"] == ["1500W", "SDS Plus"]

    tool_id = tools[0]["id"]
    assert b"SDS Plus rotary hammer" in client.get("/?q=titan").data
    response = client.post(f"/tools/{tool_id}/edit", data={"name": "Titan rotary hammer", "category": "Power tools"})
    assert response.status_code == 302
    assert app.extensions["tool_store"].get(tool_id)["name"] == "Titan rotary hammer"

    response = client.post(f"/tools/{tool_id}/delete")
    assert response.status_code == 302
    assert app.extensions["tool_store"].list() == []


def test_rejects_wrong_upload_type(client):
    response = client.post("/tools/analyse", data={"photo": (io.BytesIO(b"text"), "note.txt")}, content_type="multipart/form-data")
    assert response.status_code == 302


def test_json_is_valid_after_add(client, app):
    client.post("/tools/new", data={"name": "Claw hammer", "category": "Hand tools"})
    with open(app.config["DATA_FILE"], encoding="utf-8") as handle:
        assert json.load(handle)["tools"][0]["name"] == "Claw hammer"


def test_photo_analysis_review_and_save(client, app, monkeypatch):
    analysis = ToolAnalysis(
        name="SDS Plus rotary hammer",
        category="Power tools",
        subcategory="SDS rotary hammers",
        manufacturer="Titan",
        model="TTB653SDS",
        quantity=1,
        condition="Fair",
        specifications=["1500W", "SDS Plus"],
        serial_number="",
        notes="Supplied in a case",
        confidence=0.96,
    )
    monkeypatch.setattr("app.analyse_image", lambda _path, _mime: analysis)
    response = client.post(
        "/tools/analyse",
        data={"photo": (io.BytesIO(b"not-decoded-in-this-test"), "titan.jpg")},
        content_type="multipart/form-data",
    )
    assert response.status_code == 200
    assert b"Check what I found" in response.data
    assert b"TTB653SDS" in response.data

    filename = next(iter(app.config["UPLOAD_FOLDER"].glob("*.jpg"))).name
    response = client.post("/tools/save-analysis", data={
        "image_filename": filename,
        "name": analysis.name,
        "category": analysis.category,
        "subcategory": analysis.subcategory,
        "manufacturer": analysis.manufacturer,
        "model": analysis.model,
        "quantity": "1",
        "condition": analysis.condition,
        "specifications": "1500W\nSDS Plus",
        "confidence": "0.96",
    })
    assert response.status_code == 302
    saved = app.extensions["tool_store"].list()[0]
    assert saved["image_filename"] == filename
    assert saved["model"] == "TTB653SDS"


def test_catalogue_sync_is_complete_versioned_and_uncached(client, app):
    client.post("/tools/new", data={"name": "Hammer", "category": "Hand tools"})
    client.post("/tools/new", data={"name": "Drill", "category": "Power tools"})
    store = app.extensions["tool_store"]
    first = store.list()[0]
    photo = app.config["UPLOAD_FOLDER"] / "hammer.jpg"
    photo.write_bytes(b"photo-v1")
    store.update(first["id"], {"image_filename": photo.name})
    response = client.get("/api/tools?q=drill&category=Power+tools")
    assert response.headers["Cache-Control"] == "no-store"
    assert len(response.json["tools"]) == 2
    assert response.json["schema_version"] == 1
    url = response.json["tools"][0]["image_url"]
    assert url.startswith("/uploads/hammer.jpg?v=")
    assert client.get(url).data == b"photo-v1"
    photo.write_bytes(b"replacement-photo-v2")
    assert client.get("/api/tools").json["tools"][0]["image_url"] != url
    store.update(first["id"], {"name": "Updated hammer"})
    assert client.get("/api/tools").json["tools"][0]["name"] == "Updated hammer"
    client.post(f"/tools/{first['id']}/delete")
    assert [tool["name"] for tool in client.get("/api/tools").json["tools"]] == ["Drill"]
    client.post(f"/tools/{store.list()[0]['id']}/delete")
    assert client.get("/api/tools").json["tools"] == []


def test_missing_photo_and_corrupt_catalogue(client, app):
    store = app.extensions["tool_store"]
    store.add({"id": "one", "name": "Hammer", "image_filename": "missing.jpg"})
    assert client.get("/api/tools").json["tools"][0]["image_url"] == ""
    store.path.write_text("invalid json", encoding="utf-8")
    # Never turn unreadable server data into an authoritative empty catalogue.
    with pytest.raises(RuntimeError):
        client.get("/api/tools")


def test_offline_shell_contains_no_records_or_flash_messages(client):
    client.post("/tools/new", data={"name": "Private tool", "category": "Hand tools"})
    response = client.get("/catalogue-shell")
    assert b"Private tool" not in response.data
    assert b"Tool added to your catalogue" not in response.data
    assert b"catalogue-results" in response.data
    assert b"catalogue.js" in response.data
    assert b"Tool added to your catalogue" in client.get("/").data


def test_photo_analysis_failure_preserves_uploaded_photo(client, monkeypatch):
    def fail(*_args):
        raise RuntimeError("Analysis unavailable. Try again later.")
    monkeypatch.setattr("app.analyse_image", fail)
    response = client.post("/tools/analyse", data={"photo": (io.BytesIO(b"photo"), "tool.jpg")})
    assert response.status_code == 503
    assert b"Analysis unavailable" in response.data
    assert b'/tools/save-analysis' in response.data
    assert b'image_filename' in response.data


def test_startup_model_override(monkeypatch):
    import os
    import app as module
    calls = []
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5-mini")
    monkeypatch.setattr(module.app, "run", lambda **kwargs: calls.append(kwargs))
    module.main(["--openai-model", "gpt-6-luna"])
    assert os.environ["OPENAI_MODEL"] == "gpt-6-luna"
    assert calls == [{"host": "0.0.0.0", "port": 3030, "debug": True}]


def test_local_model_file_without_reading_credentials(tmp_path, monkeypatch):
    import os
    import app as module
    monkeypatch.setenv("OPENAI_MODEL", "gpt-5-mini")
    monkeypatch.setattr(module, "BASE_DIR", tmp_path)
    monkeypatch.setattr(module.app, "run", lambda **kwargs: None)
    (tmp_path / "openai-model.txt").write_text("gpt-6-luna\n", encoding="utf-8")
    module.main([])
    assert os.environ["OPENAI_MODEL"] == "gpt-6-luna"
    module.main(["--openai-model", "explicit-model"])
    assert os.environ["OPENAI_MODEL"] == "explicit-model"
