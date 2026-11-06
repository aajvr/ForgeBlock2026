"""Hash-linked ledger for record integrity (Section 3.2.3, FR-09).

Stage 1: a record is serialized canonically and hashed with SHA-256
         (record_hash). Two kinds of records are sealed: screening results
         (VerificationLog) and examiners' final findings (Finding), so the
         ledger holds both the system's screening and the human decision.
Stage 2: a block is appended holding record_hash, the previous block's hash
         and a timestamp; block_hash = SHA-256(index | record_hash |
         previous_hash | timestamp). Changing any past block breaks every link
         after it.
Stage 3: validation recomputes each record hash from the current database row
         and every block hash, and checks each link.

Only hashes are kept in the ledger; signature data stays in the main tables.
"""
import hashlib
import json
import threading
from datetime import datetime

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from .models import BlockchainLedger, Finding, VerificationLog, utcnow

GENESIS_PREVIOUS_HASH = "0" * 64
_append_lock = threading.Lock()


def sha256(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def _ts(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%dT%H:%M:%S.%f")


def verification_payload(log: VerificationLog) -> dict:
    """The fields of a screening record that are protected by the ledger."""
    return {
        "type": "verification",
        "log_id": log.id,
        "receipt_code": log.receipt_code,
        "modality": log.modality,
        "mode": log.mode,
        "performed_by": log.performed_by,
        "client_id": log.client_id,
        "case_id": log.case_id,
        "reference_profile_ids": list(log.reference_profile_ids or []),
        "test_sample": log.test_sample_path,
        "document_ref": log.document_ref,
        "classification": log.classification,
        "screening_result": log.screening_result,
        "similarity_score": round(float(log.similarity_score), 6),
        "confidence_score": round(float(log.confidence_score), 4),
        "thresholds": {k: round(float(v), 6) for k, v in sorted((log.thresholds or {}).items())},
        "created_at": _ts(log.created_at),
    }


def finding_payload(f: Finding) -> dict:
    """An examiner's final finding. The second opinion is not part of it, since
    it is added later; it is sealed as a new finding block when it changes the
    outcome."""
    return {
        "type": "finding",
        "finding_id": f.id,
        "case_id": f.case_id,
        "examiner_id": f.examiner_id,
        "finding": f.finding,
        "reason": f.reason,
        "verification_log_ids": list(f.verification_log_ids or []),
        "created_at": _ts(f.created_at),
    }


def _hash_payload(payload: dict) -> str:
    return sha256(json.dumps(payload, sort_keys=True, separators=(",", ":")))


def record_hash(record) -> str:
    if isinstance(record, Finding):
        return _hash_payload(finding_payload(record))
    return _hash_payload(verification_payload(record))


def block_hash(index: int, rec_hash: str, previous_hash: str, timestamp: datetime) -> str:
    return sha256(f"{index}|{rec_hash}|{previous_hash}|{_ts(timestamp)}")


def ensure_genesis(db: Session) -> None:
    if db.scalar(select(func.count()).select_from(BlockchainLedger)):
        return
    ts = utcnow()
    rec = sha256("FORGEBLOCK-GENESIS")
    db.add(
        BlockchainLedger(
            block_index=0,
            record_type="genesis",
            record_hash=rec,
            previous_hash=GENESIS_PREVIOUS_HASH,
            block_hash=block_hash(0, rec, GENESIS_PREVIOUS_HASH, ts),
            timestamp=ts,
        )
    )
    db.commit()


def append_block(db: Session, record: VerificationLog | Finding) -> BlockchainLedger:
    """Append one block for a committed screening or finding."""
    with _append_lock:
        ensure_genesis(db)
        last = db.scalars(select(BlockchainLedger).order_by(BlockchainLedger.block_index.desc()).limit(1)).one()
        ts = utcnow()
        rec = record_hash(record)
        index = last.block_index + 1
        is_finding = isinstance(record, Finding)
        block = BlockchainLedger(
            block_index=index,
            record_type="finding" if is_finding else "verification",
            verification_log_id=None if is_finding else record.id,
            finding_id=record.id if is_finding else None,
            record_hash=rec,
            previous_hash=last.block_hash,
            block_hash=block_hash(index, rec, last.block_hash, ts),
            timestamp=ts,
        )
        db.add(block)
        db.commit()
        return block


def chain_height(db: Session) -> int:
    return int(db.scalar(select(func.max(BlockchainLedger.block_index))) or 0)


def verify_block(block: BlockchainLedger, record, prev: BlockchainLedger | None) -> dict:
    issues = []
    if block.block_index == 0:
        if block.previous_hash != GENESIS_PREVIOUS_HASH:
            issues.append("Genesis block has an unexpected previous hash.")
    else:
        if prev is None or block.previous_hash != prev.block_hash:
            issues.append("Link broken: previous_hash does not match the preceding block.")
        if record is None:
            issues.append("The record for this block is missing.")
        elif record_hash(record) != block.record_hash:
            issues.append("Record altered: recomputed record hash does not match the ledger.")
    if block_hash(block.block_index, block.record_hash, block.previous_hash, block.timestamp) != block.block_hash:
        issues.append("Block altered: recomputed block hash does not match.")
    return {"valid": not issues, "issues": issues}


def block_record(db: Session, block: BlockchainLedger):
    if block.record_type == "finding":
        return db.get(Finding, block.finding_id) if block.finding_id else None
    if block.record_type == "verification":
        return db.get(VerificationLog, block.verification_log_id) if block.verification_log_id else None
    return None


def validate_chain(db: Session) -> dict:
    blocks = db.scalars(select(BlockchainLedger).order_by(BlockchainLedger.block_index)).all()
    logs = {l.id: l for l in db.scalars(select(VerificationLog)).all()}
    findings = {f.id: f for f in db.scalars(select(Finding)).all()}
    results, prev = [], None
    for b in blocks:
        record = findings.get(b.finding_id) if b.record_type == "finding" else logs.get(b.verification_log_id)
        r = verify_block(b, record, prev)
        results.append({
            "block_index": b.block_index,
            "record_type": b.record_type,
            "verification_log_id": b.verification_log_id,
            "finding_id": b.finding_id,
            **r,
        })
        prev = b
    invalid = [r for r in results if not r["valid"]]
    # A block after a broken link is shown as affected in the chain view.
    first_bad = invalid[0]["block_index"] if invalid else None
    return {
        "valid": not invalid,
        "chain_height": blocks[-1].block_index if blocks else 0,
        "blocks_checked": len(blocks),
        "invalid_blocks": invalid,
        "first_invalid_block": first_bad,
        "checked_at": _ts(utcnow()),
    }


# ------------------------------------------------------- daily auto-check ---

_last_check: dict | None = None


def last_auto_check() -> dict | None:
    return _last_check


def run_auto_check(session_factory) -> dict:
    """Validate the chain and remember the result (used by the daily job)."""
    global _last_check
    with session_factory() as db:
        _last_check = validate_chain(db)
    return _last_check
