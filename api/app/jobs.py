from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

from redis import Redis
from rq import Queue

from app.config import settings
from app.db import SessionLocal
from app.models import Job, Lab
from app.netlab import run_netlab_command
from app.config import settings
from app.providers import ProviderActionError, node_action_command
from app.storage import lab_workspace

redis_conn = Redis.from_url(settings.redis_url)
queue = Queue("netlab", connection=redis_conn)


def _build_command(lab_id: str, action: str) -> list[str]:
    if action.startswith("node:"):
        _, subaction, node = action.split(":", 2)
        try:
            return node_action_command(settings.netlab_provider, lab_id, subaction, node)
        except ProviderActionError as exc:
            raise ValueError(str(exc)) from exc
    return ["netlab", action]


def execute_netlab_action(job_id: str, lab_id: str, action: str) -> None:
    session = SessionLocal()
    try:
        job_record = session.get(Job, job_id)
        lab = session.get(Lab, lab_id)
        if not job_record or not lab:
            return
        job_record.status = "running"
        session.commit()

        workspace = lab_workspace(lab_id)
        log_path = workspace / f"job-{job_id}.log"
        command = _build_command(lab_id, action)
        code, stdout, stderr = run_netlab_command(command, workspace)
        log_path.write_text(stdout + "\n" + stderr, encoding="utf-8")

        job_record.log_path = str(log_path)
        job_record.status = "completed" if code == 0 else "failed"
        job_record.created_at = job_record.created_at or datetime.now(timezone.utc)
        session.commit()
    finally:
        session.close()


def enqueue_job(lab_id: str, action: str, user_id: str | None) -> Job:
    session = SessionLocal()
    try:
        if user_id:
            active_jobs = (
                session.query(Job)
                .filter(Job.user_id == user_id, Job.status.in_(["queued", "running"]))
                .count()
            )
            if active_jobs >= settings.max_concurrent_jobs_per_user:
                raise ValueError("Concurrency limit reached")
        job_record = Job(lab_id=lab_id, user_id=user_id, action=action, status="queued")
        session.add(job_record)
        session.commit()
        session.refresh(job_record)

        queue.enqueue(execute_netlab_action, job_record.id, lab_id, action)
        return job_record
    finally:
        session.close()
