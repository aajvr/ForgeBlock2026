"""Client groups (folders), e.g. "Lawyers", "OSS", "CCJE".

Each group is handled by exactly one examiner, and an examiner handles at
most one group, so groups never overlap: an examiner sees only the clients
of their own group (see app/access.py). Admins create groups, assign the
examiner and move clients between groups.
"""
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from ..access import is_admin
from ..database import get_db
from ..models import Client, ClientGroup, User
from ..security import require_admin, require_staff
from ..services import log_activity
from .common import examiner_ref, group_examiner

router = APIRouter(prefix="/api/groups", tags=["groups"])


class GroupIn(BaseModel):
    name: str = Field(min_length=2, max_length=80)
    description: str | None = Field(None, max_length=200)
    examiner_id: int | None = None


class GroupUpdate(BaseModel):
    name: str | None = Field(None, min_length=2, max_length=80)
    description: str | None = Field(None, max_length=200)
    examiner_id: int | None = None
    unassign_examiner: bool = False


def group_out(g: ClientGroup, db: Session) -> dict:
    n = db.scalar(select(func.count()).select_from(Client)
                  .where(Client.group_id == g.id, Client.status == "active")) or 0
    return {"id": g.id, "name": g.name, "description": g.description, "client_count": n,
            "examiner": examiner_ref(group_examiner(db, g.id)), "created_at": g.created_at}


def _name_free(db: Session, name: str, exclude_id: int | None = None) -> str:
    name = name.strip()
    other = db.scalar(select(ClientGroup).where(func.lower(ClientGroup.name) == name.lower()))
    if other is not None and other.id != exclude_id:
        raise HTTPException(409, f'A group named "{name}" already exists.')
    return name


def _assign(db: Session, g: ClientGroup, examiner_id: int) -> User:
    """Makes examiner_id the one examiner of group g."""
    u = db.get(User, examiner_id)
    if u is None or u.role != "examiner" or u.status != "active":
        raise HTTPException(422, "Choose an active examiner account.")
    if u.group_id and u.group_id != g.id:
        other = db.get(ClientGroup, u.group_id)
        raise HTTPException(409, f"{u.full_name} already handles the group "
                                 f"\"{other.name if other else u.group_id}\". An examiner handles one group only; "
                                 "remove them from that group first.")
    current = group_examiner(db, g.id)
    if current is not None and current.id != u.id:
        current.group_id = None  # one examiner per group: the new one replaces the old one
    u.group_id = g.id
    return u


@router.get("")
def list_groups(db: Session = Depends(get_db), user: User = Depends(require_staff)):
    if is_admin(user):
        groups = db.scalars(select(ClientGroup).order_by(ClientGroup.name)).all()
        ungrouped = db.scalar(select(func.count()).select_from(Client)
                              .where(Client.group_id.is_(None), Client.status == "active")) or 0
        free = db.scalars(select(User).where(User.role == "examiner", User.status == "active",
                                             User.group_id.is_(None)).order_by(User.full_name)).all()
        return {"groups": [group_out(g, db) for g in groups], "ungrouped_count": ungrouped,
                "unassigned_examiners": [examiner_ref(u) for u in free]}
    g = db.get(ClientGroup, user.group_id) if user.group_id else None
    return {"groups": [group_out(g, db)] if g else [], "ungrouped_count": None, "unassigned_examiners": []}


@router.post("")
def create_group(body: GroupIn, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    g = ClientGroup(name=_name_free(db, body.name), description=(body.description or "").strip() or None)
    db.add(g)
    db.flush()
    if body.examiner_id:
        _assign(db, g, body.examiner_id)
    db.commit()
    db.refresh(g)
    log_activity(db, admin, "settings", f"Created client group {g.name}")
    return group_out(g, db)


@router.patch("/{group_id}")
def update_group(group_id: int, body: GroupUpdate, db: Session = Depends(get_db),
                 admin: User = Depends(require_admin)):
    g = db.get(ClientGroup, group_id)
    if g is None:
        raise HTTPException(404, "Group not found.")
    changes = []
    if body.name is not None:
        g.name = _name_free(db, body.name, g.id)
        changes.append("renamed")
    if body.description is not None:
        g.description = body.description.strip() or None
    if body.unassign_examiner:
        current = group_examiner(db, g.id)
        if current is not None:
            current.group_id = None
            changes.append(f"removed examiner {current.account_code}")
    elif body.examiner_id:
        u = _assign(db, g, body.examiner_id)
        changes.append(f"examiner {u.account_code}")
    db.commit()
    log_activity(db, admin, "settings", f"Updated client group {g.name}: {', '.join(changes) or 'no change'}")
    return group_out(g, db)


@router.delete("/{group_id}")
def delete_group(group_id: int, db: Session = Depends(get_db), admin: User = Depends(require_admin)):
    g = db.get(ClientGroup, group_id)
    if g is None:
        raise HTTPException(404, "Group not found.")
    n = db.scalar(select(func.count()).select_from(Client).where(Client.group_id == g.id, Client.status == "active"))
    if n:
        raise HTTPException(409, "Move or delete the clients in this group first.")
    for u in db.scalars(select(User).where(User.group_id == g.id)):
        u.group_id = None
    for c in db.scalars(select(Client).where(Client.group_id == g.id)):
        c.group_id = None  # deleted clients
    name = g.name
    db.delete(g)
    db.commit()
    log_activity(db, admin, "settings", f"Deleted client group {name}")
    return {"ok": True}
