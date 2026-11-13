"""v8.22: list endpoints load related rows in a fixed number of queries (the
database can be remote, so per-row queries made pages slow). The batched
helpers must return exactly what the one-at-a-time helpers return."""
from sqlalchemy import event, select

from app.database import SessionLocal, engine
from app.models import Case, Client, VerificationLog
from app.routers.cases import case_out, cases_out
from app.routers.common import client_out, clients_out, log_out, logs_out, names


class _Count:
    def __init__(self):
        self.n = 0

    def __call__(self, *a, **k):
        self.n += 1


def _queries(fn):
    c = _Count()
    event.listen(engine, "before_cursor_execute", c)
    try:
        out = fn()
    finally:
        event.remove(engine, "before_cursor_execute", c)
    return out, c.n


def test_batched_lists_match_single(client, admin):
    # Make sure there is something to list (other test modules add more).
    for i in range(3):
        assert client.post("/api/clients", headers=admin, json={"full_name": f"Batch {i}"}).status_code == 200
    db = SessionLocal()
    try:
        clients = list(db.scalars(select(Client)))
        logs = list(db.scalars(select(VerificationLog)))
        cases = list(db.scalars(select(Case)))
        nm = names(db)
        assert clients_out(clients, db) == [client_out(c, db) for c in clients]
        assert logs_out(logs, db, nm) == [log_out(l, db, nm) for l in logs]
        assert cases_out(cases, db, nm) == [case_out(c, db, nm) for c in cases]
    finally:
        db.close()


def test_client_list_query_count_is_flat(client, admin):
    def run():
        db = SessionLocal()
        try:
            return clients_out(list(db.scalars(select(Client))), db)
        finally:
            db.close()

    out, n = _queries(run)
    assert len(out) >= 3
    assert n <= 6, n  # clients, profiles, accounts, groups, examiners (not ~5 per client)
