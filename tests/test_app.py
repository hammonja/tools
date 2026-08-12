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
