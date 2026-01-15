from __future__ import annotations

import asyncio
from datetime import datetime
from pathlib import Path
import shutil

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from sqlalchemy.orm import Session
from starlette.middleware.sessions import SessionMiddleware
from fastapi.middleware.cors import CORSMiddleware

from app import db, models, schemas
from app.db import SessionLocal
from app.config import settings
from app.auth import get_current_user, hash_password
from app.catalog import list_devices as catalog_devices, list_images as catalog_images
from app.jobs import enqueue_job
from app.middleware import CurrentUserMiddleware
from app.netlab import run_netlab_command
from app.providers import supported_node_actions, supports_node_actions
from app.routers import auth
from app.storage import ensure_topology_file, lab_workspace, topology_path
from app.topology import graph_to_yaml, yaml_to_graph

app = FastAPI(title="Netlab GUI API", version="0.1.0")
if settings.session_secret:
    app.add_middleware(SessionMiddleware, secret_key=settings.session_secret, same_site="lax")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:8090", "http://127.0.0.1:8090"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(CurrentUserMiddleware)
app.include_router(auth.router)


@app.on_event("startup")
def on_startup() -> None:
    models.Base.metadata.create_all(bind=db.engine)
    if settings.admin_email and settings.admin_password:
        session = SessionLocal()
        try:
            existing = session.query(models.User).filter(models.User.email == settings.admin_email).first()
            if not existing:
                if len(settings.admin_password.encode("utf-8")) > 72:
                    print("Skipping admin seed: ADMIN_PASSWORD must be 72 bytes or fewer")
                    return
                admin = models.User(
                    email=settings.admin_email,
                    hashed_password=hash_password(settings.admin_password),
                    is_admin=True,
                )
                session.add(admin)
                session.commit()
        finally:
            session.close()


@app.get("/health")
def health(request: Request) -> dict[str, str]:
    user = request.state.user
    return {
        "status": "ok",
        "timestamp": datetime.utcnow().isoformat(),
        "user": user.email if user else "",
    }


@app.get("/devices")
def list_devices() -> dict[str, object]:
    data = catalog_devices()
    if data.get("error"):
        raise HTTPException(status_code=500, detail=data["error"])
    return data


@app.get("/images")
def list_images() -> dict[str, object]:
    data = catalog_images()
    if data.get("error"):
        raise HTTPException(status_code=500, detail=data["error"])
    return data


def get_lab_or_404(lab_id: str, database: Session, user: models.User) -> models.Lab:
    lab = database.get(models.Lab, lab_id)
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")
    if lab.owner_id == user.id or user.is_admin:
        return lab
    allowed = (
        database.query(models.Permission)
        .filter(models.Permission.lab_id == lab_id, models.Permission.user_id == user.id)
        .count()
    )
    if not allowed:
        raise HTTPException(status_code=403, detail="Access denied")
    return lab


@app.get("/labs")
def list_labs(
    skip: int = 0,
    limit: int = 50,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, list[schemas.LabOut]]:
    owned = database.query(models.Lab).filter(models.Lab.owner_id == current_user.id)
    shared = (
        database.query(models.Lab)
        .join(models.Permission, models.Permission.lab_id == models.Lab.id)
        .filter(models.Permission.user_id == current_user.id)
    )
    labs = (
        owned.union(shared)
        .order_by(models.Lab.created_at.desc())
        .offset(skip)
        .limit(limit)
        .all()
    )
    return {"labs": [schemas.LabOut.model_validate(lab) for lab in labs]}


@app.post("/labs")
def create_lab(
    payload: schemas.LabCreate,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.LabOut:
    lab = models.Lab(name=payload.name, owner_id=current_user.id)
    database.add(lab)
    database.flush()
    workspace = lab_workspace(lab.id)
    workspace.mkdir(parents=True, exist_ok=True)
    lab.workspace_path = str(workspace)
    ensure_topology_file(lab.id)
    database.commit()
    database.refresh(lab)
    return schemas.LabOut.model_validate(lab)


@app.get("/labs/{lab_id}")
def get_lab(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.LabOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    return schemas.LabOut.model_validate(lab)


@app.delete("/labs/{lab_id}")
def delete_lab(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, str]:
    lab = get_lab_or_404(lab_id, database, current_user)
    if lab.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")
    workspace = lab_workspace(lab.id)
    if workspace.exists():
        for path in workspace.glob("**/*"):
            if path.is_file():
                path.unlink()
        for path in sorted(workspace.glob("**/*"), reverse=True):
            if path.is_dir():
                path.rmdir()
        workspace.rmdir()
    database.delete(lab)
    database.commit()
    return {"status": "deleted"}


@app.post("/labs/{lab_id}/clone")
def clone_lab(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.LabOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    clone = models.Lab(name=f"{lab.name} (copy)", owner_id=current_user.id)
    database.add(clone)
    database.flush()
    source = lab_workspace(lab.id)
    target = lab_workspace(clone.id)
    target.mkdir(parents=True, exist_ok=True)
    if source.exists():
        for path in source.glob("**/*"):
            if path.is_file():
                relative = path.relative_to(source)
                dest = target / relative
                dest.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, dest)
    clone.workspace_path = str(target)
    database.commit()
    database.refresh(clone)
    return schemas.LabOut.model_validate(clone)


@app.post("/labs/{lab_id}/import-yaml")
def import_yaml(
    lab_id: str,
    payload: schemas.LabYamlIn,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.LabOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    workspace = lab_workspace(lab.id)
    workspace.mkdir(parents=True, exist_ok=True)
    topology_path(lab.id).write_text(payload.content, encoding="utf-8")
    return schemas.LabOut.model_validate(lab)


@app.get("/labs/{lab_id}/export-yaml")
def export_yaml(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.LabYamlOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    topo_path = topology_path(lab.id)
    if not topo_path.exists():
        raise HTTPException(status_code=404, detail="Topology not found")
    return schemas.LabYamlOut(content=topo_path.read_text(encoding="utf-8"))


@app.post("/labs/{lab_id}/import-graph")
def import_graph(
    lab_id: str,
    payload: schemas.TopologyGraph,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.LabOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    workspace = lab_workspace(lab.id)
    workspace.mkdir(parents=True, exist_ok=True)
    yaml_content = graph_to_yaml(payload)
    topology_path(lab.id).write_text(yaml_content, encoding="utf-8")
    return schemas.LabOut.model_validate(lab)


@app.get("/labs/{lab_id}/export-graph")
def export_graph(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.TopologyGraph:
    lab = get_lab_or_404(lab_id, database, current_user)
    topo_path = topology_path(lab.id)
    if not topo_path.exists():
        raise HTTPException(status_code=404, detail="Topology not found")
    return yaml_to_graph(topo_path.read_text(encoding="utf-8"))


@app.post("/labs/{lab_id}/up")
def lab_up(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.JobOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    user_id = current_user.id
    try:
        job = enqueue_job(lab.id, "up", user_id)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return schemas.JobOut.model_validate(job)


@app.post("/labs/{lab_id}/down")
def lab_down(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.JobOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    user_id = current_user.id
    try:
        job = enqueue_job(lab.id, "down", user_id)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return schemas.JobOut.model_validate(job)


@app.post("/labs/{lab_id}/restart")
def lab_restart(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.JobOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    user_id = current_user.id
    try:
        job = enqueue_job(lab.id, "restart", user_id)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return schemas.JobOut.model_validate(job)


@app.post("/labs/{lab_id}/nodes/{node}/{action}")
def node_action(
    lab_id: str,
    node: str,
    action: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.JobOut:
    if not supports_node_actions(settings.netlab_provider):
        raise HTTPException(status_code=503, detail="Node actions are not supported by provider")
    if action not in supported_node_actions(settings.netlab_provider):
        raise HTTPException(status_code=400, detail="Unsupported node action")
    lab = get_lab_or_404(lab_id, database, current_user)
    try:
        job = enqueue_job(lab.id, f"node:{action}:{node}", current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=429, detail=str(exc)) from exc
    return schemas.JobOut.model_validate(job)


@app.get("/labs/{lab_id}/status")
def lab_status(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, str]:
    lab = get_lab_or_404(lab_id, database, current_user)
    code, stdout, stderr = run_netlab_command(["netlab", "status"], lab_workspace(lab.id))
    if code != 0:
        raise HTTPException(status_code=500, detail=stderr or "netlab status failed")
    return {"raw": stdout}


@app.get("/labs/{lab_id}/jobs")
def list_jobs(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, list[schemas.JobOut]]:
    get_lab_or_404(lab_id, database, current_user)
    jobs = (
        database.query(models.Job)
        .filter(models.Job.lab_id == lab_id)
        .order_by(models.Job.created_at.desc())
        .all()
    )
    return {"jobs": [schemas.JobOut.model_validate(job) for job in jobs]}


@app.get("/labs/{lab_id}/permissions")
def list_permissions(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, list[schemas.PermissionOut]]:
    get_lab_or_404(lab_id, database, current_user)
    permissions = database.query(models.Permission).filter(models.Permission.lab_id == lab_id).all()
    output = []
    for perm in permissions:
        user = database.get(models.User, perm.user_id)
        output.append(
            schemas.PermissionOut(
                id=perm.id,
                lab_id=perm.lab_id,
                user_id=perm.user_id,
                role=perm.role,
                created_at=perm.created_at,
                user_email=user.email if user else None,
            )
        )
    return {"permissions": output}


@app.post("/labs/{lab_id}/permissions")
def add_permission(
    lab_id: str,
    payload: schemas.PermissionCreate,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.PermissionOut:
    lab = get_lab_or_404(lab_id, database, current_user)
    if lab.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")
    user = database.query(models.User).filter(models.User.email == payload.user_email).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    permission = models.Permission(lab_id=lab_id, user_id=user.id, role=payload.role)
    database.add(permission)
    database.commit()
    database.refresh(permission)
    return schemas.PermissionOut(
        id=permission.id,
        lab_id=permission.lab_id,
        user_id=permission.user_id,
        role=permission.role,
        created_at=permission.created_at,
        user_email=user.email,
    )


@app.delete("/labs/{lab_id}/permissions/{permission_id}")
def delete_permission(
    lab_id: str,
    permission_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, str]:
    lab = get_lab_or_404(lab_id, database, current_user)
    if lab.owner_id != current_user.id and not current_user.is_admin:
        raise HTTPException(status_code=403, detail="Access denied")
    permission = database.get(models.Permission, permission_id)
    if not permission or permission.lab_id != lab_id:
        raise HTTPException(status_code=404, detail="Permission not found")
    database.delete(permission)
    database.commit()
    return {"status": "deleted"}


@app.get("/labs/{lab_id}/audit")
def audit_log(
    lab_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, list[schemas.JobOut]]:
    get_lab_or_404(lab_id, database, current_user)
    return list_jobs(lab_id, database, current_user)


@app.get("/labs/{lab_id}/jobs/{job_id}")
def get_job(
    lab_id: str,
    job_id: str,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> schemas.JobOut:
    get_lab_or_404(lab_id, database, current_user)
    job = database.get(models.Job, job_id)
    if not job or job.lab_id != lab_id:
        raise HTTPException(status_code=404, detail="Job not found")
    return schemas.JobOut.model_validate(job)


@app.get("/labs/{lab_id}/jobs/{job_id}/log")
def get_job_log(
    lab_id: str,
    job_id: str,
    tail: int | None = None,
    database: Session = Depends(db.get_db),
    current_user: models.User = Depends(get_current_user),
) -> dict[str, str]:
    get_lab_or_404(lab_id, database, current_user)
    job = database.get(models.Job, job_id)
    if not job or job.lab_id != lab_id:
        raise HTTPException(status_code=404, detail="Job not found")
    if not job.log_path:
        raise HTTPException(status_code=404, detail="Log not found")
    log_path = Path(job.log_path)
    if not log_path.exists():
        raise HTTPException(status_code=404, detail="Log not found")
    content = log_path.read_text(encoding="utf-8")
    if tail:
        lines = content.splitlines()
        content = "\n".join(lines[-tail:])
    return {"log": content}


@app.websocket("/labs/{lab_id}/nodes/{node}/console")
async def console_ws(websocket: WebSocket, lab_id: str, node: str) -> None:
    await websocket.accept()
    database = SessionLocal()
    try:
        lab = database.get(models.Lab, lab_id)
        if not lab:
            await websocket.send_text("Lab not found")
            await websocket.close(code=1008)
            return
    finally:
        database.close()

    workspace = lab_workspace(lab_id)
    process = await asyncio.create_subprocess_exec(
        "netlab",
        "connect",
        node,
        cwd=str(workspace),
        stdin=asyncio.subprocess.PIPE,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )

    async def forward(stream):
        while True:
            data = await stream.read(1024)
            if not data:
                break
            await websocket.send_text(data.decode(errors="ignore"))

    stdout_task = asyncio.create_task(forward(process.stdout))
    stderr_task = asyncio.create_task(forward(process.stderr))

    try:
        while True:
            message = await websocket.receive_text()
            if process.stdin:
                process.stdin.write(message.encode())
                await process.stdin.drain()
    except WebSocketDisconnect:
        pass
    finally:
        if process.stdin:
            process.stdin.close()
        await process.wait()
        stdout_task.cancel()
        stderr_task.cancel()
