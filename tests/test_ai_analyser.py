from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from ai_analyser import ToolAnalysis, analyse_image


@pytest.mark.parametrize("configured, expected", [(None, "gpt-6-luna"), ("  ", "gpt-6-luna"), ("custom-model", "custom-model")])
def test_vision_model_and_output_contract(tmp_path, monkeypatch, configured, expected):
    monkeypatch.setenv("OPENAI_API_KEY", "test-only")
    if configured is None:
        monkeypatch.delenv("OPENAI_MODEL", raising=False)
    else:
        monkeypatch.setenv("OPENAI_MODEL", configured)
    parsed = ToolAnalysis(name="Hammer", category="Hand tools", subcategory="Hammers",
                          manufacturer="Unknown", model="Unknown", condition="Good",
                          specifications=[], serial_number="", notes="", confidence=.8)
    parse = Mock(return_value=SimpleNamespace(output_parsed=parsed))
    monkeypatch.setattr("ai_analyser.OpenAI", lambda **_kwargs: SimpleNamespace(responses=SimpleNamespace(parse=parse)))
    photo = tmp_path / "photo.jpg"
    photo.write_bytes(b"photo")
    assert analyse_image(photo, "image/jpeg") == parsed
    args = parse.call_args.kwargs
    assert args["model"] == expected
    assert args["text_format"] is ToolAnalysis
    assert args["input"][1]["content"][1]["image_url"].startswith("data:image/jpeg;base64,")
