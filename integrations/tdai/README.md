# TDAI integration adapters

Bridge scripts for running STRATUS in **shadow mode** alongside an existing
[TDAI / memory-tencentdb](https://github.com/) deployment — STRATUS captures and
distills in parallel without being in the agent's live recall path, so it can be
validated before any cutover.

These are reference adapters, not core STRATUS. They talk to the STRATUS gateway
only over its documented HTTP API.

## `stratus_tap.py`

Tails TDAI's L0 conversation JSONL and forwards new turns to STRATUS
`/stream/add`. Per-file byte-offset checkpoint makes it restart-safe (no
double-send). Run continuously (e.g. under launchd/systemd).

| Env var         | Default                                              | Notes                          |
|-----------------|------------------------------------------------------|--------------------------------|
| `TDAI_CONV_DIR` | `~/.memory-tencentdb/memory-tdai/conversations`      | TDAI L0 JSONL directory        |
| `STRATUS_URL`   | `http://localhost:8077`                              | STRATUS gateway                |
| `TAP_POLL`      | `20`                                                 | poll interval (seconds)        |

State/log live in `~/.stratus/` (runtime data dir), separate from this repo.

## `compare_dualrun.py`

Side-by-side report of TDAI vs STRATUS tier counts during a dual-run, to confirm
STRATUS is capturing/distilling the same material before trusting it.

## Runtime data vs. source

This repo is the **single canonical source**. The runtime data directory
(`~/.stratus/` by convention: gateway DB, blobs, logs, checkpoints) holds only
mutable state — it should never contain a second copy of this source tree. Run
the gateway and these adapters *from a checkout of this repo*, pointing them at
the runtime data dir via env.
