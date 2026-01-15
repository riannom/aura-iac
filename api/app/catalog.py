from __future__ import annotations

import re
from typing import Any

import yaml

from app.netlab import run_netlab_command


def _parse_devices_table(output: str) -> list[dict[str, Any]]:
    lines = [line.rstrip() for line in output.splitlines() if line.strip()]
    if not lines:
        return []
    devices = []
    header_seen = False
    for line in lines:
        if line.lower().startswith("device"):
            header_seen = True
            continue
        if not header_seen or line.startswith("-"):
            continue
        parts = re.split(r"\s{2,}", line.strip())
        if len(parts) < 2:
            continue
        device = parts[0]
        support = parts[-1] if len(parts) >= 3 else ""
        devices.append({"id": device, "label": device, "support": support})
    return devices


def list_devices() -> dict[str, Any]:
    code, stdout, stderr = run_netlab_command(["netlab", "show", "devices"])
    if code != 0:
        return {"raw": stdout, "error": stderr}
    devices = _parse_devices_table(stdout)
    return {"raw": stdout, "devices": devices}


def list_images() -> dict[str, Any]:
    code, stdout, stderr = run_netlab_command(["netlab", "show", "images", "--format", "yaml"])
    if code != 0:
        return {"raw": stdout, "error": stderr}
    data = yaml.safe_load(stdout) or {}
    return {"raw": stdout, "images": data}
