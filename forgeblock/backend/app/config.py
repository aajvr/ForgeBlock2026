"""Application settings, read from environment variables (or a .env file)."""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def _load_dotenv() -> None:
    env_path = BASE_DIR / ".env"
    if not env_path.exists():
        return
    for line in env_path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()

# Database. SQLite works out of the box; for Supabase use the Postgres
# connection string from Project Settings > Database, e.g.
# postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
DATABASE_URL = os.getenv("DATABASE_URL", f"sqlite:///{BASE_DIR / 'forgeblock.db'}")

JWT_SECRET = os.getenv("JWT_SECRET", "dev-only-change-me")
JWT_EXPIRE_MINUTES = int(os.getenv("JWT_EXPIRE_MINUTES", "480"))

# Seeded on first start so there is always one administrator.
ADMIN_EMAIL = os.getenv("ADMIN_EMAIL", "admin@forgeblock.local")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "ChangeMe123!")
ADMIN_NAME = os.getenv("ADMIN_NAME", "System Administrator")

# Chapter 3, Section 3.8: administrator access is limited to the research
# team. Only these emails (plus ADMIN_EMAIL) can hold the admin role.
RESEARCH_TEAM_EMAILS = {
    e.strip().lower() for e in os.getenv("RESEARCH_TEAM_EMAILS", "").split(",") if e.strip()
} | {ADMIN_EMAIL.lower()}

STORAGE_DIR = Path(os.getenv("STORAGE_DIR", BASE_DIR / "storage"))
WEIGHTS_DIR = Path(os.getenv("WEIGHTS_DIR", BASE_DIR / "weights"))

# Enables the ledger tamper-simulation endpoint used to demonstrate
# integrity checking during the defense. Keep off in real deployments.
DEMO_MODE = os.getenv("DEMO_MODE", "true").lower() == "true"

CORS_ORIGINS = [o.strip() for o in os.getenv("CORS_ORIGINS", "*").split(",") if o.strip()]

# Development only: accept pens that report pressure but no tilt (e.g. Wacom
# One CTL-472) with the dynamic model, which was trained with pen angles.
# The missing angle features are set to their training average, so results
# are less accurate. Records are marked "development device", compared only
# with references from the same kind of device, and left out of the model
# performance figures. Keep false for the study's data and evaluation.
DEV_PEN_DEVICES = os.getenv("DEV_PEN_DEVICES", "false").lower() == "true"

# Study mode (Chapter 3, Section 3.8). When true, ForgeBlock shows the
# research labels: the research-use terms at first sign-in, "Research use
# only", practice clients and test-account badges. Turn it on for the data
# gathering and evaluation sessions; leave it off for a real-world look.
STUDY_MODE = os.getenv("STUDY_MODE", "false").lower() == "true"

# Sign in with Microsoft and Google through Clerk (clerk.com). Create an
# application in Clerk, turn on Google and Microsoft under SSO connections,
# and set both keys from Clerk's API keys page. Sign-in stays invite-only:
# the verified email must belong to an account an admin already created.
CLERK_PUBLISHABLE_KEY = os.getenv("CLERK_PUBLISHABLE_KEY", "").strip()
CLERK_SECRET_KEY = os.getenv("CLERK_SECRET_KEY", "").strip()
CLERK_API_URL = os.getenv("CLERK_API_URL", "https://api.clerk.com/v1").rstrip("/")
_PROVIDER_ALIASES = {"azure": "microsoft"}
OAUTH_PROVIDERS = [_PROVIDER_ALIASES.get(p.strip(), p.strip())
                   for p in os.getenv("OAUTH_PROVIDERS", "google,microsoft").split(",") if p.strip()]

# Minimum number of genuine samples before adaptive (personal) thresholds
# are used instead of the global defaults (Chapter 3, Section 3.4).
MIN_ADAPTIVE_SAMPLES = int(os.getenv("MIN_ADAPTIVE_SAMPLES", "5"))
# Reference counts per client and modality: 5 is the minimum (personal
# threshold turns on), 10 is recommended ("strong"), 20 is the maximum.
RECOMMENDED_REFERENCES = int(os.getenv("RECOMMENDED_REFERENCES", "10"))
MAX_REFERENCES = int(os.getenv("MAX_REFERENCES", "20"))

# Sign-in security: lockout after repeated failures, sign-out when idle.
MAX_FAILED_LOGINS = int(os.getenv("MAX_FAILED_LOGINS", "5"))
LOCKOUT_MINUTES = int(os.getenv("LOCKOUT_MINUTES", "15"))
IDLE_TIMEOUT_MINUTES = int(os.getenv("IDLE_TIMEOUT_MINUTES", "15"))

# Days client data is kept before the retention job deletes it (0 = never).
# Screening results with a confidence score below this are Inconclusive and go
# to the examiner. Not shown in the app. Set it from the evaluation
# (training/evaluate_static.py prints a suggested value); 20 is provisional.
INCONCLUSIVE_BELOW = float(os.getenv("INCONCLUSIVE_BELOW", "20"))

DEFAULT_RETENTION_DAYS = int(os.getenv("DEFAULT_RETENTION_DAYS", "365"))

STORAGE_DIR.mkdir(parents=True, exist_ok=True)
WEIGHTS_DIR.mkdir(parents=True, exist_ok=True)
