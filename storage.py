"""Small, thread-safe JSON repository for the tool catalogue."""

from __future__ import annotations

import json
import os
import threading
from copy import deepcopy
from pathlib import Path
from typing import Any


class ToolStore:
    def __init__(self, path: str | Path):
        self.path = Path(path)
        self._lock = threading.RLock()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        if not self.path.exists():
            self._write({"tools": []})

    def _read(self) -> dict[str, list[dict[str, Any]]]:
        try:
            with self.path.open(encoding="utf-8") as handle:
                data = json.load(handle)
        except (json.JSONDecodeError, OSError) as exc:
            raise RuntimeError(f"Could not read tool data: {exc}") from exc
        if not isinstance(data, dict) or not isinstance(data.get("tools"), list):
            raise RuntimeError("Tool data must contain a 'tools' list")
        return data

    def _write(self, data: dict[str, Any]) -> None:
        temp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        with temp_path.open("w", encoding="utf-8") as handle:
            json.dump(data, handle, indent=2, ensure_ascii=False)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp_path, self.path)

    def list(self) -> list[dict[str, Any]]:
        with self._lock:
            return deepcopy(self._read()["tools"])

    def get(self, tool_id: str) -> dict[str, Any] | None:
        return next((tool for tool in self.list() if tool.get("id") == tool_id), None)

    def add(self, tool: dict[str, Any]) -> None:
        with self._lock:
            data = self._read()
            data["tools"].append(deepcopy(tool))
            self._write(data)

    def update(self, tool_id: str, changes: dict[str, Any]) -> dict[str, Any] | None:
        with self._lock:
            data = self._read()
            for tool in data["tools"]:
                if tool.get("id") == tool_id:
                    tool.update(deepcopy(changes))
                    self._write(data)
                    return deepcopy(tool)
        return None

    def delete(self, tool_id: str) -> dict[str, Any] | None:
        with self._lock:
            data = self._read()
            for index, tool in enumerate(data["tools"]):
                if tool.get("id") == tool_id:
                    deleted = data["tools"].pop(index)
                    self._write(data)
                    return deleted
        return None

