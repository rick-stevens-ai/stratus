# External-source integration adapters

Bridge scripts for running FALDA in **shadow mode** alongside an existing
external memory deployment — FALDA captures and distills in parallel without
being in the agent's live recall path, so it can be validated before any cutover.

These are reference adapters, not core FALDA. They talk to the FALDA gateway
only over its documented HTTP API, and they only **read** the external source's
output files. The external source remains 100% authoritative and untouched.

## `falda_tap.py`

Tails the external source's L0 conversation JSONL and forwards new turns to
FALDA `/stream/add`. Per-file byte-offset checkpoint makes it restart-safe (no
double-send). Run continuously (e.g. under launchd/systemd).

| Env var          | Default                              | Notes                            |
|------------------|--------------------------------------|----------------------------------|
| `SOURCE_CONV_DIR`| `~/.external-memory/conversations`   | External L0 JSONL directory      |
| `FALDA_URL`    | `http://localhost:8077`              | FALDA gateway                  |
| `TAP_POLL`       | `20`                                 | poll interval (seconds)          |

State/log live in `~/.falda/` (runtime data dir), separate from this repo.

## `compare_dualrun.py`

Side-by-side report of external-source vs FALDA tier counts during a dual-run,
to confirm FALDA is capturing/distilling the same material before trusting it.

| Env var          | Default                              | Notes                            |
|------------------|--------------------------------------|----------------------------------|
| `SOURCE_DB`      | `~/.external-memory/vectors.db`      | External source SQLite store     |
| `FALDA_URL`    | `http://localhost:8077`              | FALDA gateway                  |

## Runtime data vs. source

This repo is the **single canonical source**. The runtime data directory
(`~/.falda/` by convention: gateway DB, blobs, logs, checkpoints) holds only
mutable state — it should never contain a second copy of this source tree. Run
the gateway and these adapters *from a checkout of this repo*, pointing them at
the runtime data dir via env.
