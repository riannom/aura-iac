from __future__ import annotations

import subprocess
from pathlib import Path


def run_netlab_command(args: list[str], workspace: Path | None = None) -> tuple[int, str, str]:
    result = subprocess.run(
        args,
        cwd=str(workspace) if workspace else None,
        capture_output=True,
        text=True,
        check=False,
    )
    return result.returncode, result.stdout, result.stderr
