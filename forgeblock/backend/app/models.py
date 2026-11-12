"""Database tables.

Based on Figure 3.2.1 (USER, SIGNATURE_PROFILE, VERIFICATION_LOG, REPORT,
BLOCKCHAIN_LEDGER) and extended for the real-world workflow:

- CLIENT: a person whose signatures are kept on file (the "signature card").
  Signature profiles belong to clients, not to the examiner who enrolled them.
- CASE / CASE_EVENT: a questioned document, its screenings, the examiner's
  final finding and the case timeline.
- FINDING: an examiner's final finding. Findings are sealed in the ledger next
  to the screening results they refer to.
- ACTIVITY_LOG (audit log), NOTIFICATION and SETTING support the admin pages.
"""
from datetime import datetime, timezone

from sqlalchemy import (
    JSON,
    false,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(tzinfo=None)


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    full_name: Mapped[str] = mapped_column(String(120))
    email: Mapped[str] = mapped_column(String(160), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(200))
    role: Mapped[str] = mapped_column(String(20), default="examiner")  # admin | examiner | client
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | disabled
    # Short account code shown in the UI, e.g. EX-001, EVAL-01, ADM-01.
    account_code: Mapped[str | None] = mapped_column(String(20), unique=True, nullable=True)
    # Accounts are created by an admin with a temporary password.
    must_change_password: Mapped[bool] = mapped_column(Boolean, default=True)
    failed_logins: Mapped[int] = mapped_column(Integer, default=0)
    locked_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_seen: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # Test accounts (EVAL-xx) are for evaluation respondents. They work with
    # signature samples prepared by the researchers, never their own.
    is_test_account: Mapped[bool] = mapped_column(Boolean, default=False, server_default=false())
    # When the user accepted the research-use terms (Section 3.8). Nothing
    # else is available until they do.
    research_use_accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # How the user last signed in: password | azure | google.
    auth_provider: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # When the user finished (or skipped) the first-time guided tour.
    tour_completed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # For examiners: the one client group they handle (one examiner per group).
    group_id: Mapped[int | None] = mapped_column(
        ForeignKey("client_groups.id", use_alter=True, name="fk_users_group_id"), nullable=True, index=True
    )
    # For client accounts: the client record whose checks they can see.
    client_id: Mapped[int | None] = mapped_column(
        ForeignKey("clients.id", use_alter=True, name="fk_users_client_id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    last_login: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class ClientGroup(Base):
    """A folder of clients handled by exactly one examiner, e.g. "Lawyers",
    "OSS" or "CCJE". Examiners see only the clients of their own group, so
    groups never overlap."""
    __tablename__ = "client_groups"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(80), unique=True)
    description: Mapped[str | None] = mapped_column(String(200), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Client(Base):
    __tablename__ = "clients"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    full_name: Mapped[str] = mapped_column(String(120))
    # Practice clients hold made-up practice signatures used for testing.
    is_practice: Mapped[bool] = mapped_column(Boolean, default=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | deleted
    deletion_requested: Mapped[bool] = mapped_column(Boolean, default=False)
    created_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    group_id: Mapped[int | None] = mapped_column(ForeignKey("client_groups.id"), nullable=True, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    retention_until: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    profiles: Mapped[list["SignatureProfile"]] = relationship(back_populates="client")


class ClientAccess(Base):
    """Gives an examiner access to a client someone else registered, e.g. a
    test client prepared by the researchers and assigned to the EVAL accounts.
    Examiners see only clients they registered or were given access to."""

    __tablename__ = "client_access"
    __table_args__ = (UniqueConstraint("client_id", "user_id", name="uq_client_access"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    granted_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class SignatureProfile(Base):
    __tablename__ = "signature_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    modality: Mapped[str] = mapped_column(String(10))  # static | dynamic
    sample_path: Mapped[str] = mapped_column(String(300))
    embedding: Mapped[list] = mapped_column(JSON)
    model_version: Mapped[str] = mapped_column(String(60))
    # Handwriting measurements used by the feature analysis.
    features: Mapped[dict] = mapped_column(JSON, default=dict)
    quality: Mapped[float] = mapped_column(Float, default=100.0)
    # Dynamic only: "limited" when the signature has no pen pressure and/or
    # tilt (v8.11; features["_pen"] says which); "development" = older
    # no-tilt pen references.
    capture_device: Mapped[str | None] = mapped_column(String(20), nullable=True)
    enrolled_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    enrolled_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | removed

    client: Mapped[Client] = relationship(back_populates="profiles")


class Case(Base):
    __tablename__ = "cases"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_code: Mapped[str] = mapped_column(String(20), unique=True, index=True)
    title: Mapped[str] = mapped_column(String(160))  # the questioned document, e.g. "Loan form #1023"
    document_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    client_id: Mapped[int] = mapped_column(ForeignKey("clients.id"), index=True)
    examiner_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    # open | closed  (awaiting_second_opinion only in records made before v7)
    status: Mapped[str] = mapped_column(String(30), default="open")
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)
    closed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class CaseEvent(Base):
    __tablename__ = "case_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    kind: Mapped[str] = mapped_column(String(30))  # opened | screening | note | finding | second_opinion | closed | reopened
    text: Mapped[str] = mapped_column(Text)
    verification_log_id: Mapped[int | None] = mapped_column(ForeignKey("verification_logs.id"), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class VerificationLog(Base):
    """One screening (verify against a client) or comparison."""

    __tablename__ = "verification_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    receipt_code: Mapped[str | None] = mapped_column(String(20), unique=True, index=True, nullable=True)
    modality: Mapped[str] = mapped_column(String(10))
    mode: Mapped[str] = mapped_column(String(10))  # compare | verify
    performed_by: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    client_id: Mapped[int | None] = mapped_column(ForeignKey("clients.id"), nullable=True, index=True)
    case_id: Mapped[int | None] = mapped_column(ForeignKey("cases.id"), nullable=True, index=True)
    reference_profile_ids: Mapped[list] = mapped_column(JSON, default=list)
    # Storage path of the questioned sample. For Compare, only a SHA-256 of
    # the upload is kept ("sha256:<hex>") and the images are not stored.
    test_sample_path: Mapped[str] = mapped_column(String(300))
    # SHA-256 of the questioned sample (uploaded file bytes, or the stroke
    # data). Used to recognise a signature that was already examined. Not
    # part of the sealed record.
    sample_hash: Mapped[str | None] = mapped_column(String(64), nullable=True, index=True)
    document_ref: Mapped[str | None] = mapped_column(String(120), nullable=True)
    similarity_score: Mapped[float] = mapped_column(Float)
    confidence_score: Mapped[float] = mapped_column(Float)
    metrics: Mapped[dict] = mapped_column(JSON)
    thresholds: Mapped[dict] = mapped_column(JSON)
    threshold_source: Mapped[str] = mapped_column(String(20))  # default | adaptive
    # Internal binary decision, kept for accuracy / FAR / FRR / EER.
    classification: Mapped[str] = mapped_column(String(10))  # genuine | forged
    # What the user sees: consistent | inconclusive | inconsistent
    screening_result: Mapped[str] = mapped_column(String(20))
    # Known answer for prepared test samples (genuine | forged), for evaluation.
    expected_label: Mapped[str | None] = mapped_column(String(10), nullable=True)
    best_match_profile_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Dynamic only: "limited" when the comparison left out pen pressure
    # and/or tilt (v8.11; analysis["pen_data"] says why); "development" =
    # older no-tilt pen records. Not part of the sealed record.
    capture_device: Mapped[str | None] = mapped_column(String(20), nullable=True)
    # Explanations (not part of the sealed record).
    analysis: Mapped[dict] = mapped_column(JSON, default=dict)
    # Kept for records made before v7 (the review queue was merged into Cases).
    review_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # pending | reviewed
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Finding(Base):
    """The examiner's final finding on a case: genuine or forged (only
    examiners decide). Records made before v7 may also hold inconclusive and
    a second opinion."""

    __tablename__ = "findings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    case_id: Mapped[int] = mapped_column(ForeignKey("cases.id"), index=True)
    examiner_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    finding: Mapped[str] = mapped_column(String(20))  # genuine | forged | inconclusive
    reason: Mapped[str] = mapped_column(Text)
    # Screening records the finding refers to.
    verification_log_ids: Mapped[list] = mapped_column(JSON, default=list)
    # Second opinion: only in records made before v7.
    second_opinion_status: Mapped[str | None] = mapped_column(String(20), nullable=True)  # pending | agreed | disagreed
    second_examiner_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    second_opinion_note: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class BlockchainLedger(Base):
    """One block per sealed record. A record is either a screening
    (verification_log_id) or an examiner's finding (finding_id)."""

    __tablename__ = "blockchain_ledger"
    __table_args__ = (UniqueConstraint("previous_hash", name="uq_ledger_previous_hash"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    block_index: Mapped[int] = mapped_column(Integer, unique=True, index=True)
    record_type: Mapped[str] = mapped_column(String(20), default="verification")  # genesis | verification | finding
    verification_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("verification_logs.id"), unique=True, nullable=True
    )
    finding_id: Mapped[int | None] = mapped_column(ForeignKey("findings.id"), unique=True, nullable=True)
    record_hash: Mapped[str] = mapped_column(String(64))
    previous_hash: Mapped[str] = mapped_column(String(64))
    block_hash: Mapped[str] = mapped_column(String(64), unique=True)
    timestamp: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Report(Base):
    __tablename__ = "reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    generated_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    report_type: Mapped[str] = mapped_column(String(30))  # all | static | dynamic
    period_start: Mapped[datetime] = mapped_column(DateTime)
    period_end: Mapped[datetime] = mapped_column(DateTime)
    total_verifications: Mapped[int] = mapped_column(Integer)
    consistent_count: Mapped[int] = mapped_column(Integer, default=0)
    inconclusive_count: Mapped[int] = mapped_column(Integer, default=0)
    inconsistent_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class ActivityLog(Base):
    """Activity feed and audit log."""

    __tablename__ = "activity_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), index=True, nullable=True)
    # login | login_failed | lockout | password | account | client | enrollment | case | screening
    # | compare | finding | ledger | tamper_demo | settings | model | retention | report | deletion
    activity_type: Mapped[str] = mapped_column(String(30))
    description: Mapped[str] = mapped_column(Text)
    modality: Mapped[str | None] = mapped_column(String(10), nullable=True)
    verification_log_id: Mapped[int | None] = mapped_column(
        ForeignKey("verification_logs.id"), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow, index=True)


class Notification(Base):
    """One notification for one user. `text` is the title (kept from the first
    release); `read` mirrors read_at for older code."""
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    text: Mapped[str] = mapped_column(Text)
    body: Mapped[str | None] = mapped_column(Text, nullable=True)
    link: Mapped[str | None] = mapped_column(String(200), nullable=True)
    entity_type: Mapped[str | None] = mapped_column(String(30), nullable=True)
    entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    read_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=utcnow)


class Setting(Base):
    __tablename__ = "settings"

    key: Mapped[str] = mapped_column(String(60), primary_key=True)
    value: Mapped[dict] = mapped_column(JSON)
