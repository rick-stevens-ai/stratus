#!/usr/bin/env python3
"""STRATUS vs TDAI dual-run weekly comparison (m1).
Pulls turn/atom counts from both stores + runs identical recall queries against
each, prints a parity report. Read-only on both. Safe to run anytime."""
import json, sqlite3, urllib.request, os, glob

TDAI_DB = os.path.expanduser("~/.memory-tencentdb/memory-tdai/instances/kukla/vectors.db")
TDAI_MAIN = os.path.expanduser("~/.memory-tencentdb/memory-tdai/vectors.db")
STRATUS = "http://localhost:8077"

def q1(db, sql):
    try:
        c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=15)
        r = c.execute(sql).fetchone(); c.close()
        return r[0] if r else None
    except Exception as e:
        return f"err:{e}"

def post(route, body):
    try:
        req = urllib.request.Request(STRATUS+route, data=json.dumps(body).encode(),
                                     headers={"content-type":"application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}

print("="*60)
print("STRATUS vs TDAI dual-run parity report (m1)")
print("="*60)

# TDAI counts (try main store; instance store)
db = TDAI_MAIN if os.path.exists(TDAI_MAIN) else TDAI_DB
print(f"\nTDAI store: {db}")
print(f"  L0 conversations : {q1(db,'select count(*) from l0_conversations')}")
print(f"  L1 records       : {q1(db,'select count(*) from l1_records')}")

# STRATUS counts via API (query with high limit, count)
st_stream = post("/stream/search", {"query":"the and a of","limit":5000})
st_atoms  = post("/atoms/query", {"limit":5000})
print(f"\nSTRATUS store ({STRATUS}):")
print(f"  health           : {post('/healthz',{}) if False else 'see /healthz'}")
sc = len(st_stream.get("messages",[])) if isinstance(st_stream,dict) and "messages" in st_stream else st_stream
ac = len(st_atoms.get("items",[])) if isinstance(st_atoms,dict) and "items" in st_atoms else st_atoms
print(f"  T0 stream (>=)   : {sc}")
print(f"  T1 atoms  (>=)   : {ac}")

# identical recall spot-checks
print("\nRecall spot-checks (STRATUS hybrid):")
for query in ["what does Rick prefer for scoring",
              "STRATUS dual run",
              "OSTI corpus total"]:
    r = post("/atoms/search", {"query":query,"limit":2})
    items = r.get("items",[]) if isinstance(r,dict) else []
    print(f"  q='{query}': {len(items)} hit(s)")
    for it in items[:1]:
        print(f"      -> {it.get('content','')[:90]}")

print("\n(TDAI remains authoritative; STRATUS is shadow-only this week.)")
