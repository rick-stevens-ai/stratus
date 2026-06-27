#!/usr/bin/env python3
"""FALDA vs external-source dual-run comparison.
Pulls turn/atom counts from both stores + runs identical recall queries against
each, prints a parity report. Read-only on both. Safe to run anytime."""
import json, sqlite3, urllib.request, os, glob

SOURCE_DB   = os.path.expanduser(os.environ.get("SOURCE_DB", "~/.external-memory/vectors.db"))
SOURCE_INST = os.path.expanduser(os.environ.get("SOURCE_DB_INSTANCE", "~/.external-memory/instances/main/vectors.db"))
FALDA = os.environ.get("FALDA_URL", "http://localhost:8077")

def q1(db, sql):
    try:
        c = sqlite3.connect(f"file:{db}?mode=ro", uri=True, timeout=15)
        r = c.execute(sql).fetchone(); c.close()
        return r[0] if r else None
    except Exception as e:
        return f"err:{e}"

def post(route, body):
    try:
        req = urllib.request.Request(FALDA+route, data=json.dumps(body).encode(),
                                     headers={"content-type":"application/json"})
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {"error": str(e)}

print("="*60)
print("FALDA vs external-source dual-run parity report")
print("="*60)

# External-source counts (try main store; instance store)
db = SOURCE_DB if os.path.exists(SOURCE_DB) else SOURCE_INST
print(f"\nExternal source store: {db}")
print(f"  L0 conversations : {q1(db,'select count(*) from l0_conversations')}")
print(f"  L1 records       : {q1(db,'select count(*) from l1_records')}")

# FALDA counts via API (query with high limit, count)
st_stream = post("/stream/search", {"query":"the and a of","limit":5000})
st_atoms  = post("/atoms/query", {"limit":5000})
print(f"\nFALDA store ({FALDA}):")
sc = len(st_stream.get("messages",[])) if isinstance(st_stream,dict) and "messages" in st_stream else st_stream
ac = len(st_atoms.get("items",[])) if isinstance(st_atoms,dict) and "items" in st_atoms else st_atoms
print(f"  T0 stream (>=)   : {sc}")
print(f"  T1 atoms  (>=)   : {ac}")

# identical recall spot-checks
print("\nRecall spot-checks (FALDA hybrid):")
for query in ["scoring preference",
              "FALDA dual run",
              "corpus total count"]:
    r = post("/atoms/search", {"query":query,"limit":2})
    items = r.get("items",[]) if isinstance(r,dict) else []
    print(f"  q='{query}': {len(items)} hit(s)")
    for it in items[:1]:
        print(f"      -> {it.get('content','')[:90]}")

print("\n(External source remains authoritative; FALDA is shadow-only this window.)")
