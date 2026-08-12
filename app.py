from __future__ import annotations

import os
import uuid
from datetime import datetime, timezone
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, abort, flash, redirect, render_template, request, send_from_directory, url_for
from werkzeug.utils import secure_filename

from ai_analyser import analyse_image
from storage import ToolStore


BASE_DIR = Path(__file__).resolve().parent
ALLOWED_IMAGE_TYPES = {"image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp"}


def create_app(test_config: dict | None = None) -> Flask:
    load_dotenv(BASE_DIR / ".env")
    app = Flask(__name__)
    app.config.from_mapping(
        SECRET_KEY=os.getenv("FLASK_SECRET_KEY", "development-only-change-me"),
        MAX_CONTENT_LENGTH=16 * 1024 * 1024,
        DATA_FILE=BASE_DIR / "data" / "tools.json",
        UPLOAD_FOLDER=BASE_DIR / "uploads",
    )
    if test_config:
        app.config.update(test_config)
    Path(app.config["UPLOAD_FOLDER"]).mkdir(parents=True, exist_ok=True)
    store = ToolStore(app.config["DATA_FILE"])
    app.extensions["tool_store"] = store

    @app.get("/")
    def index():
        tools = store.list()
        query = request.args.get("q", "").strip().lower()
        category = request.args.get("category", "").strip()
        categories = sorted({tool.get("category", "Uncategorised") for tool in tools})
        if query:
            fields = ("name", "manufacturer", "model", "category", "subcategory", "notes")
            tools = [tool for tool in tools if any(query in str(tool.get(field, "")).lower() for field in fields)]
        if category:
            tools = [tool for tool in tools if tool.get("category") == category]
        tools.sort(key=lambda item: item.get("created_at", ""), reverse=True)
        return render_template("index.html", tools=tools, categories=categories, query=request.args.get("q", ""), selected_category=category)

    @app.route("/tools/new", methods=["GET", "POST"])
    def new_tool():
        if request.method == "GET":
            return render_template("tool_form.html", tool={}, mode="new")
        tool = _tool_from_form(request.form)
        tool.update(id=uuid.uuid4().hex, created_at=_now(), updated_at=_now(), image_filename="")
        store.add(tool)
        flash("Tool added to your catalogue.", "success")
        return redirect(url_for("index"))

    @app.post("/tools/analyse")
    def analyse_tool():
        photo = request.files.get("photo")
        if photo is None or not photo.filename:
            flash("Choose or take a photo first.", "error")
            return redirect(url_for("new_tool"))
        mime_type = photo.mimetype.lower()
        if mime_type not in ALLOWED_IMAGE_TYPES:
            flash("Please use a JPEG, PNG, or WebP photo.", "error")
            return redirect(url_for("new_tool"))
        filename = f"{uuid.uuid4().hex}{ALLOWED_IMAGE_TYPES[mime_type]}"
        image_path = Path(app.config["UPLOAD_FOLDER"]) / secure_filename(filename)
        photo.save(image_path)
        try:
            analysis = analyse_image(image_path, mime_type)
        except Exception as exc:
            app.logger.warning("Image analysis failed: %s", exc)
            flash(str(exc), "error")
            return render_template("tool_form.html", tool={"image_filename": filename}, mode="review"), 503
        tool = analysis.model_dump()
        tool["specifications"] = "\n".join(tool["specifications"])
        tool["image_filename"] = filename
        return render_template("tool_form.html", tool=tool, mode="review")

    @app.post("/tools/save-analysis")
    def save_analysis():
        filename = Path(request.form.get("image_filename", "")).name
        if not filename or not (Path(app.config["UPLOAD_FOLDER"]) / filename).is_file():
            abort(400, "Uploaded image is missing")
        tool = _tool_from_form(request.form)
        tool.update(id=uuid.uuid4().hex, created_at=_now(), updated_at=_now(), image_filename=filename)
        store.add(tool)
        flash("Photo analysed and tool saved. You can edit anything the AI got wrong.", "success")
        return redirect(url_for("index"))

    @app.route("/tools/<tool_id>/edit", methods=["GET", "POST"])
    def edit_tool(tool_id: str):
        tool = store.get(tool_id)
        if tool is None:
            abort(404)
        if request.method == "GET":
            return render_template("tool_form.html", tool=tool, mode="edit")
        changes = _tool_from_form(request.form)
        changes["updated_at"] = _now()
        store.update(tool_id, changes)
        flash("Tool updated.", "success")
        return redirect(url_for("index"))

    @app.post("/tools/<tool_id>/delete")
    def delete_tool(tool_id: str):
        deleted = store.delete(tool_id)
        if deleted is None:
            abort(404)
        filename = Path(deleted.get("image_filename", "")).name
        if filename:
            try:
                (Path(app.config["UPLOAD_FOLDER"]) / filename).unlink(missing_ok=True)
            except OSError:
                app.logger.warning("Could not delete image %s", filename)
        flash("Tool removed.", "success")
        return redirect(url_for("index"))

    @app.get("/uploads/<path:filename>")
    def uploaded_file(filename: str):
        return send_from_directory(app.config["UPLOAD_FOLDER"], filename)

    @app.errorhandler(413)
    def too_large(_error):
        flash("That photo is too large. The maximum upload is 16 MB.", "error")
        return redirect(url_for("new_tool"))

    return app


def _tool_from_form(form) -> dict:
    name = form.get("name", "").strip()
    if not name:
        abort(400, "Tool name is required")
    try:
        quantity = max(1, int(form.get("quantity", 1)))
    except (TypeError, ValueError):
        quantity = 1
    try:
        confidence = float(form.get("confidence", 1))
    except (TypeError, ValueError):
        confidence = 1.0
    return {
        "name": name,
        "category": form.get("category", "Uncategorised").strip() or "Uncategorised",
        "subcategory": form.get("subcategory", "").strip(),
        "manufacturer": form.get("manufacturer", "Unknown").strip() or "Unknown",
        "model": form.get("model", "Unknown").strip() or "Unknown",
        "quantity": quantity,
        "condition": form.get("condition", "Unknown").strip() or "Unknown",
        "specifications": [line.strip() for line in form.get("specifications", "").splitlines() if line.strip()],
        "serial_number": form.get("serial_number", "").strip(),
        "notes": form.get("notes", "").strip(),
        "confidence": min(1.0, max(0.0, confidence)),
    }


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


app = create_app()


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5000, debug=True)

