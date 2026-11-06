"""Who can see what (Chapter 3, Section 3.8: users can view only their own
enrolled signatures and activity records).

- Admins (the research team) see everything.
- Examiners see the clients of their group (v8: one examiner per group, so
  groups never overlap), plus clients they registered that are in no group,
  plus clients an admin shared with them read-only (the study's prepared
  test clients). For their group's clients they see every screening and
  case, so a newly assigned examiner can take over; elsewhere only their own.
- Clients see only their own signature record.

Every router checks these in the backend; the UI only mirrors them.
"""
from fastapi import HTTPException
from sqlalchemy import and_, or_, select
from sqlalchemy.orm import Session, object_session

from .config import RESEARCH_TEAM_EMAILS
from .models import Case, Client, ClientAccess, User, VerificationLog


def is_admin(user: User) -> bool:
    return user.role == "admin"


def _group_clients(user: User):
    return select(Client.id).where(Client.group_id == user.group_id)


def visible_client_ids(db: Session, user: User):
    """A SELECT of the client ids the user can see, or None for all."""
    if is_admin(user):
        return None
    if user.role == "client":
        return select(Client.id).where(Client.id == (user.client_id or -1))
    granted = select(ClientAccess.client_id).where(ClientAccess.user_id == user.id)
    conds = [and_(Client.group_id.is_(None), Client.created_by == user.id), Client.id.in_(granted)]
    if user.group_id:
        conds.append(Client.group_id == user.group_id)
    return select(Client.id).where(or_(*conds))


def in_my_group(user: User, client: Client | None) -> bool:
    return bool(client is not None and user.group_id and client.group_id == user.group_id)


def can_view_client(db: Session, user: User, client: Client) -> bool:
    if is_admin(user):
        return True
    if user.role == "client":
        return user.client_id == client.id
    if in_my_group(user, client):
        return True
    if client.group_id is None and client.created_by == user.id:
        return True
    return db.scalar(select(ClientAccess.id).where(ClientAccess.client_id == client.id,
                                                   ClientAccess.user_id == user.id)) is not None


def can_edit_client(user: User, client: Client) -> bool:
    """Adding or removing references, renaming. Shared test clients are
    read-only for examiners so one respondent cannot change another's
    references."""
    if is_admin(user):
        return True
    if user.role != "examiner":
        return False
    return in_my_group(user, client) or (client.group_id is None and client.created_by == user.id)


def visible_client_or_404(db: Session, client_id: int, user: User) -> Client:
    c = db.get(Client, client_id)
    if c is None or c.status != "active" or not can_view_client(db, user, c):
        raise HTTPException(404, "Client not found.")
    return c


def editable_client_or_404(db: Session, client_id: int, user: User) -> Client:
    c = visible_client_or_404(db, client_id, user)
    if not can_edit_client(user, c):
        raise HTTPException(403, "This client was prepared by the research team. Its references cannot be changed.")
    return c


def own_logs(stmt, user: User):
    """Restricts a VerificationLog query to what the user may see."""
    if is_admin(user):
        return stmt
    if user.role == "client":
        return stmt.where(VerificationLog.client_id == (user.client_id or -1))
    visible = visible_client_ids(None, user)
    mine = and_(VerificationLog.performed_by == user.id,
                or_(VerificationLog.client_id.is_(None), VerificationLog.client_id.in_(visible)))
    if user.group_id:
        return stmt.where(or_(mine, VerificationLog.client_id.in_(_group_clients(user))))
    return stmt.where(mine)


def _client_of(obj, client_id) -> Client | None:
    db = object_session(obj)
    return db.get(Client, client_id) if (db is not None and client_id) else None


def can_view_log(user: User, log: VerificationLog) -> bool:
    if is_admin(user):
        return True
    if user.role == "client":
        return user.client_id is not None and log.client_id == user.client_id
    client = _client_of(log, log.client_id)
    if in_my_group(user, client):
        return True
    if log.performed_by != user.id:
        return False
    return client is None or can_view_client(object_session(log), user, client)


def own_cases(stmt, user: User):
    if is_admin(user):
        return stmt
    visible = visible_client_ids(None, user)
    mine = and_(Case.examiner_id == user.id, Case.client_id.in_(visible))
    if user.group_id:
        return stmt.where(or_(mine, Case.client_id.in_(_group_clients(user))))
    return stmt.where(mine)


def can_view_case(user: User, case: Case) -> bool:
    if is_admin(user):
        return True
    if user.role != "examiner":
        return False
    client = _client_of(case, case.client_id)
    if in_my_group(user, client):
        return True
    return case.examiner_id == user.id and client is not None and can_view_client(object_session(case), user, client)


def may_be_admin(email: str, account_code: str | None = None) -> bool:
    """Admin access is limited to the research team (RESEARCH_TEAM_EMAILS).
    Test accounts can never be admins."""
    if account_code and account_code.upper().startswith("EVAL"):
        return False
    return email.strip().lower() in RESEARCH_TEAM_EMAILS
