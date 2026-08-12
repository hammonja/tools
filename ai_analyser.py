"""OpenAI vision integration for extracting catalogue fields from a photo."""

from __future__ import annotations

import base64
import os
from pathlib import Path

from openai import OpenAI
from pydantic import BaseModel, Field


class ToolAnalysis(BaseModel):
    name: str = Field(description="Concise specific product name")
    category: str = Field(description="Broad group, such as Power tools or Hand tools")
    subcategory: str = Field(description="Specific group, such as SDS rotary hammers or Drill bits")
    manufacturer: str = Field(description="Brand or maker; Unknown if not visible")
    model: str = Field(description="Model number; Unknown if not visible")
    quantity: int = Field(default=1, ge=1)
    condition: str = Field(description="New, Good, Fair, Poor, or Unknown")
    specifications: list[str] = Field(description="Visible facts such as wattage, size, drive, or voltage")
    serial_number: str = Field(description="Serial number if clearly visible, otherwise blank")
    notes: str = Field(description="Short useful description of what is visible")
    confidence: float = Field(ge=0, le=1, description="Confidence in the overall identification")


PROMPT = """
You catalogue workshop tools from photographs. Identify the primary tool or coherent tool set.
Read visible labels carefully. Never invent a manufacturer, model, serial number, or specification.
Use 'Unknown' for an unseen manufacturer/model/condition and an empty string for an unseen serial.
Category should be stable and broad (for example Power tools, Hand tools, Accessories, Measuring,
Garden tools, Safety equipment). Subcategory should be useful for filtering (for example SDS rotary
hammers, Drill bits, SDS drill bits, Spanners, Screwdrivers). Treat packaging/manual text as evidence.
If several unrelated tools are visible, describe the most prominent one and mention the others in notes.
""".strip()


def analyse_image(path: str | Path, mime_type: str) -> ToolAnalysis:
    api_key = os.getenv("OPENAI_API_KEY", "").strip()
    if not api_key:
        raise RuntimeError("AI analysis is not configured. Add OPENAI_API_KEY to your .env file.")

    image_bytes = Path(path).read_bytes()
    data_url = f"data:{mime_type};base64,{base64.b64encode(image_bytes).decode('ascii')}"
    client = OpenAI(api_key=api_key)
    response = client.responses.parse(
        model=os.getenv("OPENAI_MODEL", "gpt-5-mini"),
        input=[
            {"role": "system", "content": PROMPT},
            {
                "role": "user",
                "content": [
                    {"type": "input_text", "text": "Create a catalogue record for this tool photo."},
                    {"type": "input_image", "image_url": data_url, "detail": "high"},
                ],
            },
        ],
        text_format=ToolAnalysis,
    )
    if response.output_parsed is None:
        raise RuntimeError("The image could not be analysed. Please try another photo.")
    return response.output_parsed

