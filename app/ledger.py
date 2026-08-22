"""
Persistent payout ledger — SQLite.

Replaces the in-memory `_LEDGER` list that main.py used before. Same shape
(LedgerEntry in, per-EV INR totals out), but survives a restart. This is
still a single-file SQLite DB, which is fine for a pilot; swap the DB_PATH
for a real Postgres connection string when GridSwarm moves off a single
zone instance (see README roadmap step 5, "Network").
"""
from __future__ import annotations
import sqlite3
import os
import time
from typing import List
from .models import LedgerEntry, ActionType

DB_PATH = os.environ.get("GRIDSWARM_DB_PATH", "gridswarm_ledger.db")


def _connect() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def init_db() -> None:
    with _connect() as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS ledger (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ev_id TEXT NOT NULL,
                zone_id TEXT NOT NULL,
                action TEXT NOT NULL,
                payout_inr REAL NOT NULL,
                created_at REAL NOT NULL
            )
            """
        )
        conn.execute("CREATE INDEX IF NOT EXISTS idx_ledger_ev_id ON ledger(ev_id)")


def record(entry: LedgerEntry) -> None:
    with _connect() as conn:
        conn.execute(
            "INSERT INTO ledger (ev_id, zone_id, action, payout_inr, created_at) "
            "VALUES (?, ?, ?, ?, ?)",
            (entry.ev_id, entry.zone_id, entry.action.value, entry.payout_inr, time.time()),
        )


def all_entries() -> List[LedgerEntry]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ev_id, zone_id, action, payout_inr FROM ledger ORDER BY id"
        ).fetchall()
    return [
        LedgerEntry(ev_id=r["ev_id"], zone_id=r["zone_id"],
                    action=ActionType(r["action"]), payout_inr=r["payout_inr"])
        for r in rows
    ]


def totals() -> dict[str, float]:
    with _connect() as conn:
        rows = conn.execute(
            "SELECT ev_id, ROUND(SUM(payout_inr), 2) AS total FROM ledger GROUP BY ev_id"
        ).fetchall()
    return {r["ev_id"]: r["total"] for r in rows}


def reset() -> None:
    """Wipes the ledger. Testing/demo convenience only — not exposed by default."""
    with _connect() as conn:
        conn.execute("DELETE FROM ledger")


init_db()
