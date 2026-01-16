from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "sqlite:///./netlab_gui.db"
    redis_url: str = "redis://redis:6379/0"
    netlab_workspace: str = "/var/lib/netlab-gui"
    qcow2_store: str | None = None
    log_forward_url: str | None = None
    netlab_provider: str = "clab"

    local_auth_enabled: bool = True
    oidc_issuer_url: str | None = None
    oidc_client_id: str | None = None
    oidc_client_secret: str | None = None
    oidc_redirect_uri: str | None = None
    oidc_scopes: str = "openid profile email"
    oidc_app_redirect_url: str | None = None

    jwt_secret: str = ""
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 480
    session_secret: str = ""

    max_concurrent_jobs_per_user: int = 2

    admin_email: str | None = None
    admin_password: str | None = None


settings = Settings()
