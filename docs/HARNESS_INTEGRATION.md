# Connecting an agent harness to FALDA

FALDA is harness-agnostic: it speaks a small HTTP/JSON API (see `docs/API.md`)
plus a CLI (`bin/falda`). Any agent runtime can use it for memory. This guide
shows how to wire the two reference harnesses we run in production —
**Hermes** and **OpenClaw** — to a FALDA deployment, in either *shadow* mode
(capture + validate, not in the live recall path) or *live* mode (FALDA is the
agent's memory).

The two harnesses are independent agent runtimes on different hosts that share
one FALDA-family deployment. Nothing here couples FALDA to either harness —
these are integration recipes, not core requirements.

---

## 0. Connection surface (both harnesses)

Everything below is built on three primitives:

| Surface            | What it is                                  | Where documented |
|--------------------|---------------------------------------------|------------------|
| HTTP gateway       | `POST` JSON to `:8077` (`/stream/*`, `/atoms/*`, `/scenes/*`, `/core/*`, `/pools/*`) | `docs/API.md`, `docs/POOLS.md` |
| CLI                | `bin/falda` — same operations from a shell | `README.md` |
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

Run FALDA alongside Hermes' existing memory, capturing in parallel without
touching the live recall path. Two long-running processes, both under launchd:

- **Gateway** — `npm run gateway` (or `bin/falda serve`) from a checkout of
  this repo, pointed at a runtime data dir via env:

  ```bash
  FALDA_ROOT=~/.falda/data \
  FALDA_PORT=8077 \
  FALDA_EMBED=local \            # or remote; see docs/INSTALL.md
  node --import tsx src/gateway.ts
  ```

- **Tap** — `integrations/external-source/falda_tap.py` tails the existing
  memory provider's L0 JSONL and forwards new turns to `/stream/add`. Restart-
  safe via byte-offset checkpoint. See that dir's README for env.

This validates **capture**; pair with `compare_dualrun.py` to confirm parity
before trusting FALDA for live recall.

Reference launchd labels we run: `com.stevens.falda-gateway`,
`com.stevens.falda-tap` (both `KeepAlive=true`).

> Node ABI gotcha: `better-sqlite3` is a native module. The interpreter that
> runs `npm install` / `npm rebuild` MUST be the one the gateway runs under.
> Pin an absolute `node` path in the launchd plist if your shell `PATH` resolves
> a different version, else you get `ERR_DLOPEN_FAILED` (NODE_MODULE_VERSION
> mismatch).

### 1b. Live memory provider

To make FALDA the agent's memory, have the Hermes memory hooks call the
gateway: write turns to `/stream/add`, recall via `/stream/search` +
`/atoms/search`, persist distilled facts via `/atoms/upsert`, read the agent
core from `/core/read`. Address every call with the agent's `tenant`; omit
`pool` for private memory. Keep the gateway local (`127.0.0.1:8077`) or on the
tailnet; it has no auth of its own, so don't expose it publicly.

### 1c. Tool/CLI access

For ad-hoc agent use, expose `bin/falda` (or thin `curl` wrappers) as a Hermes
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

OpenClaw is a Node.js agent gateway (port 3000) with a plugin/skill layer,
cron scheduler, and a pluggable memory provider surface. The deployment runs
on the same host as the FALDA gateway (CherryRd, macOS).

### 2a. Shadow capture

- **Gateway**: `bin/falda serve` / `npm run gateway` already running on
  CherryRd at `localhost:8077` under launchd label
  `com.stevens.falda-gateway` (`KeepAlive=true`).

- **Tap**: `integrations/external-source/falda_tap.py` points at
  OpenClaw's L0 session-log export directory:

  ```
  SOURCE_CONV_DIR=~/.openclaw/sessions   # top-level session JSONL dir
  FALDA_URL=http://127.0.0.1:8077
  FALDA_TENANT=openclaw
  ```

  The tap tails any `*.jsonl` files in that tree, forwarding new turns to
  `/stream/add` with `{tenant: "openclaw"}`. Byte-offset checkpoint is
  stored at `~/.falda/tap-checkpoint-openclaw.json`.

- **Process manager**: launchd label `com.stevens.falda-tap-openclaw`
  (`KeepAlive=true`). Plist at
  `~/Library/LaunchAgents/com.stevens.falda-tap-openclaw.plist`.

### 2b. Live memory provider

OpenClaw exposes a memory-provider plugin interface. The FALDA provider
calls the same HTTP surface the Hermes side uses:

- **Write** (after each turn): `POST /stream/add` with
  `{tenant: "openclaw", turn: {role, content, ts}}`.
- **Read/recall**: `GET /stream/search?q=...&tenant=openclaw` +
  `GET /atoms/search?q=...&tenant=openclaw`.
- **Core/persona**: `GET /core/read?tenant=openclaw` on startup.
- **Distilled facts**: `POST /atoms/upsert` as the distillation sidecar
  promotes T0→T1→T2→T3.
- **Tenant id**: `openclaw` (private `self` store; no pool unless sharing
  with Hermes — see §3).

The provider plugin lives at
`~/.openclaw/plugins/falda-memory/index.js` (loaded via
`plugins.falda-memory` in Gateway config). Gateway runs FALDA in shadow
mode by default; flip `memory.provider: falda` in config to go live.

### 2c. Cross-agent messaging

- **Subscriber**: `~/.hermes/nats-subscriber.py` (shared script, one
  instance per agent identity). On the OpenClaw side it consumes
  `sibline.ollie.inbox` + `sibline.broadcast` from the JetStream durable
  (durable consumer `ollie-inbox-durable`) and bridges non-noise
  traffic into the file mailbox:
  `~/Dropbox/XFER/kukla-ollie/kukla-background-queue.jsonl`.
  The OpenClaw Gateway background-hook process polls that JSONL for
  inbound Kukla messages (the `kukla:background` hook, routed by
  `ingress:kukla-background`).

- **Python/runtime**: **Python 3.13** (`~/.hermes/venvs/sibline/bin/python3.13`,
  Homebrew). `nats-py 2.15.0` installed in that venv. No isoformat shim
  needed — 3.11+ `datetime.fromisoformat()` handles N-digit microseconds
  natively. (The shim in `nats-subscriber.py` is gated
  `if sys.version_info < (3, 11)` and is a no-op on this deployment.)

- **Send path** (symmetric — both legs every send):
  1. **Durable file leg first**: `sibline-send.py` appends the message
     envelope to
     `~/Dropbox/XFER/kukla-ollie/kukla-background-queue.jsonl` atomically.
  2. **Broker leg**: publishes to the peer's inbox on NATS best-effort
     (OpenClaw→Kukla = `sibline.kukla.inbox`; Kukla→OpenClaw =
     `sibline.ollie.inbox`), plus an audit copy to the sender's own
     `sibline.<self>.outbox`. Broker outage degrades to file-only delivery;
     no message loss.

  Live subject tree (verified against the broker at `nats://<m1>:4222`):
  streams `sibline-ollie` (`sibline.ollie.>`), `sibline-kukla`
  (`sibline.kukla.>`), `sibline-broadcast` (`sibline.broadcast`). Agent
  identities in subjects are `ollie` / `kukla`. (Legacy `sibling-*` streams
  are pending retirement; there is no `falda.*` subject tree.)
  Outbound from OpenClaw also has a signed-webhook path
  (`kukla_webhook_post.sh`, HMAC-SHA256) for out-of-band delivery when the
  shared Dropbox dir is the authoritative channel (e.g. this integration).

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

## 4. Broker deploy (NATS + JetStream, runs on Kukla's host)

The message bus described in §1 and §2c assumes a running NATS broker. Templates
live in `deploy/nats/`.

### `deploy/nats/nats-server.conf.template`

Key points:

- Tailscale-bound listener (`REPLACE_ME_TAILSCALE_IP:4222`); monitoring on
  `127.0.0.1:8222` only.
- JetStream enabled with file store; paths under `REPLACE_ME_HOME/.hermes/nats/`.
- Three users: `admin` (full `>`), `kukla`, `ollie` (scoped to `sibline.>`).

> **$JS.> grant gotcha**: Each agent user MUST have `publish: $JS.>` in addition
> to `sibline.>`. Without it, JetStream consumer/ack operations fail with
> "permission denied" even when `sibline.>` pub/sub works. The failure message
> points at subscribe but the missing grant is on the ack publish path. This bites
> every new deployment once.

See `deploy/nats/nats-server.conf.template` for the full tokenized config.

### `deploy/nats/create-streams.sh`

Creates the three sibline streams (`sibline-kukla`, `sibline-ollie`,
`sibline-broadcast`). File storage, 7d retention, 10k msgs, 1MB max. Idempotent
on re-run (check with `nats stream info <name>` before re-running; `stream add`
errors if the stream already exists).

### SIGHUP / reconnect procedure

ACL/permission changes reload cleanly with `kill -HUP <nats-server-pid>` — no
broker restart needed. **However**, py-nats durable subscribers do NOT survive
the underlying TCP reconnect: they enter a "consumer exists, no active interest"
zombie where messages queue but never deliver. Standard procedure for ANY
broker ACL/config change:

1. `kill -HUP <nats-server-pid>` — reload config.
2. `launchctl kickstart -k gui/$(id -u)/<subscriber-label>` — bounce every
   subscriber process.

---

## 5. Hermes-side launchd templates

Four `.plist.template` files live in `deploy/launchd/`. Tokens: `REPLACE_ME_HOME`,
`REPLACE_ME_TAILSCALE_IP`, `REPLACE_ME_NODE` (absolute node path — must match the
one used for `npm install`/`npm rebuild better-sqlite3`),
`REPLACE_ME_FALDA_CHECKOUT`, `REPLACE_ME_NODE_BINDIR`.

| Template | Label | Interpreter | Notes |
|---|---|---|---|
| `com.stevens.nats-broker.plist.template` | `com.stevens.nats-broker` | `/opt/homebrew/bin/nats-server` | Broker itself; Kukla's host |
| `com.stevens.nats-subscriber.plist.template` | `com.stevens.nats-subscriber` | sibline venv Python 3.13 | Needs `nats-py`; 3.11+ isoformat native |
| `com.stevens.falda-gateway.plist.template` | `com.stevens.falda-gateway` | Pinned `node` (same as `npm rebuild`) | ABI must match — see `REPLACE_ME_NODE` |
| `com.stevens.falda-tap.plist.template` | `com.stevens.falda-tap` | `/usr/bin/python3` (system) | stdlib only, no deps |

> **Why three interpreters?** Deliberately different: the broker is a Go binary;
the subscriber runs the sibline venv (needs `nats-py`, pinned to Python 3.13+);
the tap uses system Python (stdlib only, no deps, maximum portability); the
gateway runs pinned Node (native ABI dependency via `better-sqlite3`). Do not
"unify" them — each interpreter choice carries a real constraint.

---

## 6. Hermes-side bootstrap order

```
1. Broker host (Kukla's m1):
   brew install nats-server nats   # server + CLI
   mkdir -p ~/.hermes/nats/jetstream ~/.hermes/logs
   cp deploy/nats/nats-server.conf.template ~/.hermes/nats/nats-server.conf
   # fill REPLACE_ME_* (tailnet IP, passwords)
   cp deploy/launchd/com.stevens.nats-broker.plist.template \
      ~/Library/LaunchAgents/com.stevens.nats-broker.plist  # fill tokens
   launchctl load ~/Library/LaunchAgents/com.stevens.nats-broker.plist
   # create a `nats context` with url+creds, then:
   bash deploy/nats/create-streams.sh
   nats --context sibline stream ls      # verify 3 streams

2. FALDA gateway (any host; typically same as broker):
   git clone <repo> ~/code/falda && cd ~/code/falda
   nvm use 24                            # pin the node you'll run under
   npm ci
   npm rebuild better-sqlite3           # SAME node as runtime (ABI must match)
   mkdir -p ~/.falda/blobs
   cp deploy/launchd/com.stevens.falda-gateway.plist.template \
      ~/Library/LaunchAgents/com.stevens.falda-gateway.plist
   # set REPLACE_ME_NODE = $(which node) under the pinned nvm version
   launchctl load ~/Library/LaunchAgents/com.stevens.falda-gateway.plist
   curl -s localhost:8077/healthz       # {"ok":true,...}

3. Sibline subscriber (Hermes side):
   python3.13 -m venv ~/.hermes/venvs/sibline
   ~/.hermes/venvs/sibline/bin/pip install nats-py
   # creds: echo 'SIBLING_NATS_PASS=...' > ~/.config/sibling-nats/cred (chmod 0600)
   cp deploy/launchd/com.stevens.nats-subscriber.plist.template \
      ~/Library/LaunchAgents/com.stevens.nats-subscriber.plist  # fill tokens
   launchctl load ~/Library/LaunchAgents/com.stevens.nats-subscriber.plist

4. FALDA tap (shadow capture):
   # set SOURCE_CONV_DIR (memory provider L0 JSONL dir) + FALDA_TENANT in plist
   cp deploy/launchd/com.stevens.falda-tap.plist.template \
      ~/Library/LaunchAgents/com.stevens.falda-tap.plist  # fill tokens
   launchctl load ~/Library/LaunchAgents/com.stevens.falda-tap.plist

5. Verify end-to-end:
   - Publish a test envelope to sibline.<peer>.inbox; confirm peer receives.
   - tail ~/.falda/tap.log; confirm new turns flow to /stream/add.
   - curl 'localhost:8077/stream/search?q=test&tenant=<tenant>'; confirm capture.
```

### Secrets layout

| Secret | Location | Mode | Notes |
|---|---|---|---|
| NATS agent password | `~/.config/sibling-nats/cred` (`SIBLING_NATS_PASS=`) | 0600 | Canonical. `/tmp/.nats_creds` is a stale fallback, may not exist. |
| Webhook HMAC secret | `~/.hermes/webhook_subscriptions.json` | 0600 | Hermes auto-redacts in echo; JSON parser sees raw value. |
| Argo API key (remote embed/distill) | env / keychain | — | Only if `FALDA_EMBED=remote`. |

---

## 7. Checklist for a new harness

1. Choose a stable `tenant` id for the agent.
2. Stand up (or reuse) a FALDA gateway; confirm `/healthz`.
3. Decide shadow vs. live; for shadow, run a tap + `compare_dualrun.py`.
4. If sharing memory with another harness, declare a pool with explicit access.
5. If coordinating via the message bus, run a subscriber on a modern Python and
   make the send path symmetric (file + broker).
6. Keep the gateway off the public internet (no built-in auth).

---

## 5. Install / bootstrap order (replication-grade)

The broker leg lives on the Hermes host (m1); see `KUKLA_DELTA.md` +
`deploy/nats/` for the `nats-server.conf` 3-user ACL (note the
`publish: $JS.>` JetStream grant gotcha) and stream-create commands. Once the
broker + streams exist, bring up the OpenClaw side in this order:

```
1.  git checkout + cd falda
2.  npm install            # use the pinned Node (see package.json engines)
3.  npm rebuild better-sqlite3   # ABI must match the pinned Node; pin the
                                 # absolute node path in any launchd plist env
4.  mkdir -p ~/.openclaw/falda-dualrun ~/.openclaw/logs ~/.falda
5.  (Hermes host) start nats-server + create streams (KUKLA_DELTA.md)
6.  (Hermes host) create durable consumers: sibline-ollie/ollie-inbox-durable,
    sibline-broadcast/ollie-bcast-durable
7.  start FALDA gateway:  launchctl bootstrap + kickstart
    com.example.falda-gateway  ->  verify  curl -s localhost:8077/healthz
8.  start the shadow tap:   com.example.falda-tap-openclaw
                           ->  confirm /stream/add receiving tenant=openclaw
9.  start the subscriber:   com.example.nats-subscriber
                           ->  log shows js-subscribed filter=sibline.ollie.inbox
10. verify end-to-end: publish a kind=ping to sibline.ollie.inbox; expect a
    pong on sibline.<peer>.inbox + an `inbox appended` line in the subscriber log
```

Plist templates with `REPLACE_ME_*` tokens are in `deploy/launchd/`
(`com.example.falda-gateway`, `com.example.falda-tap-openclaw`,
`com.example.nats-subscriber`). Replace `REPLACE_ME_HOME` /
`REPLACE_ME_PYTHON` / `REPLACE_ME_FALDA_URL` before installing.

---

## 6. Secrets layout (OpenClaw side)

Nothing in this stack reads secrets from source. Concrete locations:

| Secret | Storage | Notes |
|---|---|---|
| Cross-agent webhook HMAC secret | file: `~/.openclaw/agent-secrets/kukla-webhook.env` (mode `0600`) | Sourced by `kukla_webhook_post.sh` as a fallback **before** the keychain lookup. Required because a login keychain is **locked in non-GUI SSH sessions**, so `security find-generic-password` returns empty there. File-first avoids that trap. |
| NATS broker user/password | env file on each host, mode `0600` | Never inline in the plist; pass via `EnvironmentVariables` or a sourced env file. Broker ACL config is on the Hermes host (`deploy/nats/`). |
| FALDA gateway | none | No built-in auth — bind to loopback only and keep off the public internet. |

Keychain-vs-file rule of thumb: anything a launchd/SSH/cron context must read
unattended goes in a `0600` env file (keychain is unreliable headless);
interactive-only secrets may stay in the keychain.
