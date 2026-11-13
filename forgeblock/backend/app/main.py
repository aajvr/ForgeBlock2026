import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import inspect, select, text

from .config import ADMIN_EMAIL, ADMIN_NAME, ADMIN_PASSWORD, CORS_ORIGINS, DEMO_MODE
from .database import Base, SessionLocal, engine
from .ledger import ensure_genesis, run_auto_check
from .ml.engine import get_engine
from .models import User
from .routers import admin, auth, cases, clients, groups, records, verification
from .security import hash_password

DAILY_SECONDS = 24 * 60 * 60


# Columns added after the first release. create_all() does not add columns to
# existing tables, so they are added here (nullable or with a default).
_ADDED_COLUMNS = {
    "users": {
        "is_test_account": "BOOLEAN NOT NULL DEFAULT false",
        "research_use_accepted_at": "TIMESTAMP",
        "auth_provider": "VARCHAR(20)",
        "tour_completed_at": "TIMESTAMP",
        "group_id": "INTEGER",
    },
    "clients": {"group_id": "INTEGER"},
    "signature_profiles": {"capture_device": "VARCHAR(20)"},
    "verification_logs": {"capture_device": "VARCHAR(20)", "sample_hash": "VARCHAR(64)"},
    # v8.18 notifications (see supabase/migrations/2026-11-12_notifications.sql)
    "notifications": {"type": "VARCHAR(30)", "body": "TEXT", "entity_type": "VARCHAR(30)",
                      "entity_id": "INTEGER", "read_at": "TIMESTAMP"},
}


def _add_missing_columns() -> None:
    insp = inspect(engine)
    with engine.begin() as conn:
        for table, cols in _ADDED_COLUMNS.items():
            have = {c["name"] for c in insp.get_columns(table)}
            for name, ddl in cols.items():
                if name not in have:
                    conn.execute(text(f"ALTER TABLE {table} ADD COLUMN {name} {ddl}"))
        # Accounts made by the bulk tool before the flag existed.
        conn.execute(text("UPDATE users SET is_test_account = true WHERE account_code LIKE 'EVAL-%'"))
        # v7: one examiner decides, so cases left waiting for a second
        # opinion are closed with the Forged finding they already have.
        conn.execute(text("UPDATE cases SET status = 'closed', closed_at = CURRENT_TIMESTAMP "
                          "WHERE status = 'awaiting_second_opinion'"))
        conn.execute(text("UPDATE findings SET second_opinion_status = NULL WHERE second_opinion_status = 'pending'"))


def init_db() -> None:
    Base.metadata.create_all(bind=engine)
    _add_missing_columns()
    with SessionLocal() as db:
        if not db.scalar(select(User).where(User.role == "admin")):
            db.add(
                User(
                    full_name=ADMIN_NAME,
                    email=ADMIN_EMAIL.lower(),
                    password_hash=hash_password(ADMIN_PASSWORD),
                    role="admin",
                    account_code="ADM-001",
                    must_change_password=True,
                )
            )
            db.commit()
        ensure_genesis(db)


def daily_jobs(stop: threading.Event) -> None:
    """Validates the ledger and applies data retention once a day."""
    while True:
        try:
            run_auto_check(SessionLocal)
            with SessionLocal() as db:
                admin.run_retention(db)
        except Exception as e:  # noqa: BLE001 - a failed run must not stop the server
            print(f"[forgeblock] daily job failed: {e}")
        if stop.wait(DAILY_SECONDS):
            return


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    get_engine()  # load models at startup rather than on the first request
    from .ml import text_removal
    text_removal.available()  # v8.21: load the printed-text remover now too (first use was slow)
    stop = threading.Event()
    threading.Thread(target=daily_jobs, args=(stop,), daemon=True).start()
    yield
    stop.set()


app = FastAPI(
    title="ForgeBlock API",
    description="Siamese-Based Bimodal Signature Screening System",
    version="7.0.0",
    lifespan=lifespan,
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(clients.router)
app.include_router(cases.router)
app.include_router(verification.router)
app.include_router(records.router)
app.include_router(admin.router)
app.include_router(groups.router)


@app.get("/api/health")
def health():
    m = get_engine().status()
    return {"status": "ok", "demo_mode": DEMO_MODE,
            "models": {k: {"trained": v["trained"], "kind": v["kind"]} for k, v in m.items()}}
