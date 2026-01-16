from __future__ import annotations

from pathlib import Path
import json
import re

from app.config import settings


def image_store_root() -> Path:
    if settings.qcow2_store:
        return Path(settings.qcow2_store)
    return Path(settings.netlab_workspace) / "images"


def ensure_image_store() -> Path:
    path = image_store_root()
    path.mkdir(parents=True, exist_ok=True)
    return path


def qcow2_path(filename: str) -> Path:
    return ensure_image_store() / filename


def manifest_path() -> Path:
    return ensure_image_store() / "manifest.json"


def load_manifest() -> dict:
    path = manifest_path()
    if not path.exists():
        return {"images": []}
    return json.loads(path.read_text(encoding="utf-8"))


def save_manifest(data: dict) -> None:
    path = manifest_path()
    path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def rules_path() -> Path:
    return ensure_image_store() / "rules.json"


def load_rules() -> list[dict[str, str]]:
    path = rules_path()
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return data.get("rules", [])


def detect_device_from_filename(filename: str) -> tuple[str | None, str | None]:
    name = filename.lower()
    for rule in load_rules():
        pattern = rule.get("pattern")
        device_id = rule.get("device_id")
        if not pattern or not device_id:
            continue
        if re.search(pattern, name):
            return device_id, _extract_version(filename)
    keyword_map = {
        "ceos": "eos",
        "eos": "eos",
        "iosv": "iosv",
        "csr": "csr",
        "nxos": "nxos",
        "viosl2": "iosvl2",
        "iosvl2": "iosvl2",
        "iosxr": "iosxr",
    }
    for keyword, device_id in keyword_map.items():
        if keyword in name:
            return device_id, _extract_version(filename)
    return None, _extract_version(filename)


def _extract_version(filename: str) -> str | None:
    match = re.search(r"(\d+(?:\.\d+){1,3}[A-Za-z0-9]*)", filename)
    return match.group(1) if match else None
