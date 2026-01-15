from __future__ import annotations

from pathlib import Path

from app.config import settings


def workspace_root() -> Path:
    return Path(settings.netlab_workspace)


def lab_workspace(lab_id: str) -> Path:
    return workspace_root() / lab_id


def topology_path(lab_id: str) -> Path:
    return lab_workspace(lab_id) / "topology.yml"


def ensure_topology_file(lab_id: str) -> Path:
    path = topology_path(lab_id)
    if not path.exists():
        path.write_text(
            "defaults:\\n  device: iosv\\nnodes: {}\\nlinks: []\\n",
            encoding="utf-8",
        )
    return path
