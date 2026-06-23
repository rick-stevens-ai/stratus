#!/usr/bin/env python3
"""
STRATUS dual-run shadow tap.

Tails an external memory source's L0 conversation JSONL shards and mirrors each
new turn to the STRATUS gateway (/stream/add). The external source remains 100%
authoritative and untouched — this only READS its output files and forwards to
STRATUS so the two systems accumulate the SAME conversation traffic in parallel
for the dual-run validation window.

Design:
  - Per-file byte-offset checkpoint in ~/.stratus/tap_state.json -> survives restarts,
    never re-sends a line, never misses one.
  - Batches by sessionKey per poll for efficiency.
  - Best-effort: a STRATUS outage just means lines wait; offsets only advance on 200.
  - Loops every POLL_SECONDS. Idempotent and safe to run under launchd.
"""
import json, os, time, urllib.request, urllib.error, glob, sys

CONV_DIR = os.environ.get("SOURCE_CONV_DIR", os.path.expanduser("~/.external-memory/conversations"))
STRATUS  = os.environ.get("STRATUS_URL", "http://localhost:8077")
STATE    = os.path.expanduser("~/.stratus/tap_state.json")
LOG      = os.path.expanduser("~/.stratus/tap.log")
POLL_SECONDS = int(os.environ.get("TAP_POLL", "20"))

def log(m):
    line = f"{time.strftime('%Y-%m-%dT%H:%M:%S')} {m}"
    print(line, flush=True)
    try:
        with open(LOG, "a") as f: f.write(line + "\n")
    except Exception: pass

def load_state():
    try:
        with open(STATE) as f: return json.load(f)
    except Exception: return {}

def save_state(st):
    tmp = STATE + ".tmp"
    with open(tmp, "w") as f: json.dump(st, f)
    os.replace(tmp, STATE)

def post(route, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(STRATUS + route, data=data,
                                 headers={"content-type": "application/json"})
    with urllib.request.urlopen(req, timeout=10) as r:
        return r.status, r.read()

def stratus_up():
    try:
        with urllib.request.urlopen(STRATUS + "/healthz", timeout=5) as r:
            return r.status == 200
    except Exception:
        return False

def process_file(path, st):
    """Read new bytes from path, group new turns by sessionKey, forward to STRATUS."""
    off = st.get(path, 0)
    size = os.path.getsize(path)
    if size <= off:
        return 0
    sent = 0
    with open(path, "r") as f:
        f.seek(off)
        buf = f.read()
        new_off = f.tell()
    # group consecutive lines by session
    batches = {}
    consumed = off
    for raw in buf.splitlines(keepends=True):
        if not raw.endswith("\n"):
            # partial trailing line — stop here, leave offset before it
            break
        consumed += len(raw.encode())
        line = raw.strip()
        if not line:
            continue
        try:
            d = json.loads(line)
        except Exception:
            continue
        sk = d.get("sessionKey") or d.get("sessionId") or "unknown"
        role = d.get("role", "")
        content = d.get("content", "")
        if not content:
            continue
        batches.setdefault(sk, []).append({"role": role, "content": content})
    # forward each session batch
    for sk, msgs in batches.items():
        try:
            status, _ = post("/stream/add", {"session_id": f"ext:{sk}", "messages": msgs})
            if status == 200:
                sent += len(msgs)
            else:
                log(f"WARN /stream/add status={status} for {sk}; will retry (offset held)")
                return sent  # don't advance offset on failure
        except urllib.error.URLError as e:
            log(f"WARN STRATUS unreachable ({e}); holding offset")
            return sent
    st[path] = consumed if batches else new_off
    return sent

def main():
    log(f"STRATUS tap starting. conv_dir={CONV_DIR} stratus={STRATUS} poll={POLL_SECONDS}s")
    while True:
        if not stratus_up():
            log("STRATUS not healthy; waiting")
            time.sleep(POLL_SECONDS); continue
        st = load_state()
        total = 0
        for path in sorted(glob.glob(os.path.join(CONV_DIR, "*.jsonl"))):
            try:
                total += process_file(path, st)
            except Exception as e:
                log(f"ERR processing {path}: {e}")
        if total:
            save_state(st)
            log(f"mirrored {total} turns to STRATUS")
        time.sleep(POLL_SECONDS)

if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit(0)
