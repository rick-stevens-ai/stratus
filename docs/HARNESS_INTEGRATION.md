# Connecting an agent harness to STRATUS

STRATUS is harness-agnostic: it speaks a small HTTP/JSON API (see `docs/API.md`)
plus a CLI (`bin/stratus`). Any agent runtime can use it for memory. This guide
shows how to wire the two reference harnesses we run in production —
**Hermes** and **OpenClaw** — to a STRATUS deployment, in either *shadow* mode
(capture + validate, not in the live recall path) or *live* mode (STRATUS is the
agent's memory).

The two harnesses are independent agent runtimes on different hosts that share
one STRATUS-family deployment. Nothing here couples STRATUS to either harness —
these are integration recipes, not core requirements.

---

## 0. Connection surface (both harnesses)

Everything below is built on three primitives:

| Surface            | What it is                                  | Where documented |
|--------------------|---------------------------------------------|------------------|
| HTTP gateway       | `POST` JSON to `:8077` (`/stream/*`, `/atoms/*`, `/scenes/*`, `/core/*`, `/pools/*`) | `docs/API.md`, `docs/POOLS.md` |
| CLI                | `bin/stratus` — same operations from a shell | `README.md` |
| Multi-tenant addr  | every op takes optional `{tenant, pool}`; no pool ⇒ the tenant's private `self` store | `docs/POOLS.md` |

Pick a stable **tenant id per agent** (e.g. one per agent identity). Two agents
sharing memory do it via an opt-in named **pool** (`docs/POOLS.md`), never by
sharing a tenant.

Health check, harness-independent:

```bash
curl -s localhost:8077/healthz      # {"ok":true,"tiers":[...],"pools":true}
```

---

## 1. Hermes harness

Hermes is a Python agent runtime with a long-running **gateway** process, a
**tool/skill** layer, **cron** jobs, and a pluggable **memory provider**. There
are three integration points, from lightest to deepest.

### 1a. Shadow capture (recommended first step)

Run STRATUS alongside Hermes' existing memory, capturing in parallel without
touching the live recall path. Two long-running processes, both under launchd:

- **Gateway** — `npm run gateway` (or `bin/stratus serve`) from a checkout of
  this repo, pointed at a runtime data dir via env:

  ```bash
  STRATUS_ROOT=~/.stratus/data \
  STRATUS_PORT=8077 \
  STRATUS_EMBED=local \            # or remote; see docs/INSTALL.md
  node --import tsx src/gateway.ts
  ```

- **Tap** — `integrations/external-source/stratus_tap.py` tails the existing
  memory provider's L0 JSONL and forwards new turns to `/stream/add`. Restart-
  safe via byte-offset checkpoint. See that dir's README for env.

This validates **capture**; pair with `compare_dualrun.py` to confirm parity
before trusting STRATUS for live recall.

Reference launchd labels we run: `com.stevens.stratus-gateway`,
`com.stevens.stratus-tap` (both `KeepAlive=true`).

> Node ABI gotcha: `better-sqlite3` is a native module. The interpreter that
> runs `npm install` / `npm rebuild` MUST be the one the gateway runs under.
> Pin an absolute `node` path in the launchd plist if your shell `PATH` resolves
> a different version, else you get `ERR_DLOPEN_FAILED` (NODE_MODULE_VERSION
> mismatch).

### 1b. Live memory provider

To make STRATUS the agent's memory, have the Hermes memory hooks call the
gateway: write turns to `/stream/add`, recall via `/stream/search` +
`/atoms/search`, persist distilled facts via `/atoms/upsert`, read the agent
core from `/core/read`. Address every call with the agent's `tenant`; omit
`pool` for private memory. Keep the gateway local (`127.0.0.1:8077`) or on the
tailnet; it has no auth of its own, so don't expose it publicly.

### 1c. Tool/CLI access

For ad-hoc agent use, expose `bin/stratus` (or thin `curl` wrappers) as a Hermes
tool/skill so the agent can query/insert memory mid-task. Same HTTP surface,
just driven from the tool layer.

### Cross-agent messaging (how the two harnesses coordinate)

Memory is not the only shared surface. Our Hermes↔OpenClaw deployment also runs
a small agent-to-agent message bus so the two harnesses coordinate work:

- **Broker**: NATS + JetStream, one durable inbox per agent
  (`<bus>.<agent>.inbox`), an audit outbox (`<bus>.<agent>.outbox`), a
  broadcast subject, and ephemeral presence. Envelope:
  `{id, from, to, ts, reply_to?, kind, body}`.
- **Subscriber daemon** (Hermes side): a Python process that consumes the
  agent's durable inbox + broadcast and bridges non-noise traffic into a local
  file mailbox the agent polls. Run it under a **modern Python (3.11+)** so
  `datetime.fromisoformat()` parses the broker's N-digit-microsecond timestamps
  natively — older interpreters need a compat shim. We isolate this in a
  dedicated venv to keep it off system package management.
- **File mailbox fallback**: an append-only JSONL pair in a shared dir, so a
  broker outage degrades to file-only delivery rather than message loss. The
  send path writes the file first (durable), then publishes to the broker
  (realtime) best-effort.

Symmetry rule: **both** directions must use the **same** transport. If agent A→B
rides the broker but B→A only writes the file, you get a latency/visibility
asymmetry that looks like a bug. Make every send do both legs.

---

## 2. OpenClaw harness

> **OpenClaw maintainer: please fill in.** Stubbed by the Hermes side; the
> OpenClaw integration specifics (process model, memory-hook location, plugin
> vs. native, runtime dir conventions) should be authored by whoever runs the
> OpenClaw deployment.

Expected shape, by analogy to the Hermes side:

### 2a. Shadow capture
- [ ] Gateway: same `bin/stratus serve` / `npm run gateway`, own
  `STRATUS_ROOT`/`STRATUS_PORT` on the OpenClaw host (or shared via tailnet +
  a pool).
- [ ] Tap: point `stratus_tap.py` (or an OpenClaw-native equivalent) at
  OpenClaw's L0 conversation export. Document `SOURCE_CONV_DIR` for OpenClaw.
- [ ] Process manager: launchd/systemd label(s) used.

### 2b. Live memory provider
- [ ] Where OpenClaw's memory read/write hooks live and how they'd call the
  STRATUS HTTP surface.
- [ ] Tenant id used for the OpenClaw agent.

### 2c. Cross-agent messaging
- [ ] OpenClaw-side subscriber/bridge that consumes `<bus>.<agent>.inbox` +
  broadcast.
- [ ] Python/runtime version used (confirm modern interpreter so no isoformat
  shim is needed, or note the shim).
- [ ] Send path: confirm it does BOTH the durable-file leg and the broker
  publish leg (the symmetry rule above).

---

## 3. Shared-pool collaboration between harnesses

When the two harnesses should share a slice of memory (not their whole stores),
declare an opt-in pool and give each agent's tenant the access it needs:

```bash
curl -s localhost:8077/pools/declare -d '{
  "name": "shared-corpus",
  "members": {"agent-a": "readwrite", "agent-b": "read"},
  "description": "facts both harnesses contribute to / read"
}'
```

Then each harness addresses shared reads/writes with `"pool": "shared-corpus"`;
private memory stays in each agent's `self` store, physically isolated. Full
semantics + isolation guarantees in `docs/POOLS.md`.

---

## 4. Checklist for a new harness

1. Choose a stable `tenant` id for the agent.
2. Stand up (or reuse) a STRATUS gateway; confirm `/healthz`.
3. Decide shadow vs. live; for shadow, run a tap + `compare_dualrun.py`.
4. If sharing memory with another harness, declare a pool with explicit access.
5. If coordinating via the message bus, run a subscriber on a modern Python and
   make the send path symmetric (file + broker).
6. Keep the gateway off the public internet (no built-in auth).
