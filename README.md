# STRATUS

**Clustered hierarchical memory for scientific agents.**

STRATUS gives an autonomous agent a layered, long-lived memory — like atmospheric
strata, knowledge settles into tiers, from raw observation up to a stable core.
It is built entirely on open, self-hostable components: SQLite, `sqlite-vec`,
SQLite FTS5, and any OpenAI-compatible embedding endpoint. No external service,
no managed database, no cloud lock-in.

---

## The four tiers

| Tier | Name   | Holds                                              | Backing store            |
|------|--------|----------------------------------------------------|--------------------------|
| T0   | Stream | raw conversation / observation log                 | SQLite + vec + FTS5      |
| T1   | Atoms  | distilled atomic memories (facts, prefs, rules)    | SQLite + vec + FTS5      |
| T2   | Scenes | synthesized episodic scene blocks (markdown)       | local filesystem         |
| T3   | Core   | long-lived persona / project core (markdown)       | local filesystem         |

Lower tiers are high-volume and queryable; higher tiers are curated and stable.
An agent writes raw turns to **Stream**, distills durable facts into **Atoms**,
periodically synthesizes episodes into **Scenes**, and maintains a single
**Core** document describing who/what it is and the project it serves.

## Recall

Both vectorized tiers (Stream, Atoms) support **hybrid recall**: a dense nearest-
neighbor search (`sqlite-vec`, cosine) and a lexical BM25 search (FTS5) are fused
via reciprocal-rank fusion. You get semantic recall *and* exact-term recall in a
single call, with no separate search service.

---

## Quick start

```bash
npm install
npm run smoke      # offline, deterministic — prints "ALL TIERS GREEN"
```

### As a library

```ts
import { Stratus, makeEmbedder } from "stratus-memory";

const memory = new Stratus({
  dbPath: "./stratus.db",
  blobDir: "./stratus-blobs",
  embed: makeEmbedder(),   // OpenAI-compatible /v1/embeddings endpoint
  dim: 768,
});

await memory.addStream("session-1", [
  { role: "user", content: "The cryostat target temperature is 4.2 K." },
]);
await memory.upsertAtom({ type: "fact", content: "Cryostat target temperature is 4.2 K." });

const hits = await memory.searchAtoms("what temperature is the cryostat?", 3);
```

### As a service

```bash
npm run gateway     # JSON HTTP API on :8077
curl localhost:8077/healthz
```

See [`docs/API.md`](docs/API.md) for the full route table.

### Distillation (T0 → T1 → T2 → T3)

The gateway provides the storage primitives; promotion between tiers is driven
by a standalone sidecar, [`stratus_distiller.py`](stratus_distiller.py). It
polls the Stream over the HTTP API and uses any OpenAI-compatible chat model to:

- **T0 → T1**: extract typed atoms (`persona` / `episodic` / `instruction`)
  from new turns, in small windows (defaults to 12-turn chunks — large blobs
  cause under-extraction).
- **T1 → T2**: synthesize periodic scene summaries (`L2_INTERVAL_S`, default 1h).
- **T2 → T3**: synthesize a stable core/persona (`L3_INTERVAL_S`, default 6h).

It touches only the documented HTTP API plus your LLM endpoint, and keeps a
restart-safe checkpoint in `~/.stratus/distiller_state.json`.

```bash
export LLM_BASE_URL=http://localhost:8000/v1   # any OpenAI-compatible chat endpoint
export LLM_API_KEY=...                          # required, no default
export DISTILLER_MODEL=gpt-4o-mini
python3 stratus_distiller.py --once             # one backfill pass
python3 stratus_distiller.py                    # continuous loop
```

| Env var          | Default            | Notes                              |
|------------------|--------------------|------------------------------------|
| `LLM_BASE_URL`   | `localhost:8000/v1`| chat-completions endpoint          |
| `LLM_API_KEY`    | _(required)_       | bearer token for the chat endpoint |
| `DISTILLER_MODEL`| `gpt-4o-mini`      | extraction/synthesis model id      |
| `L1_EVERY_N`     | `10`               | new turns before an atom pass      |
| `L2_INTERVAL_S`  | `3600`             | scene synthesis cadence            |
| `L3_INTERVAL_S`  | `21600`            | core synthesis cadence             |

---

## Configuration

Embeddings come from any OpenAI-compatible endpoint — run open-weights models
locally (Ollama, vLLM, llama.cpp) or against a self-hosted lab server.

| Env var                   | Default                        | Notes                                  |
|---------------------------|--------------------------------|----------------------------------------|
| `STRATUS_EMBED_BASE_URL`  | `http://localhost:11434/v1`    | embeddings endpoint                    |
| `STRATUS_EMBED_API_KEY`   | `x`                            | bearer token (`x` for keyless local)   |
| `STRATUS_EMBED_MODEL`     | `nomic-embed-text`             | embedding model id                     |
| `STRATUS_DIM`             | `768`                          | must match the model's dimensionality  |
| `STRATUS_DB`              | `./stratus.db`                 | SQLite file                            |
| `STRATUS_BLOBS`           | `./stratus-blobs`              | scene + core blob directory            |
| `STRATUS_PORT`            | `8077`                         | gateway port                           |

Recommended open embedding models: `nomic-embed-text` (768), `BAAI/bge-base-en-v1.5`
(768), `nomic-ai/nomic-embed-text-v1.5` (768). Set `STRATUS_DIM` to match.

---

## Architecture

```
                    ┌──────────────────────────┐
   agent  ───────▶  │  Stratus  (lib or HTTP)  │
                    └────────────┬─────────────┘
            ┌────────────────────┼────────────────────┐
            ▼                    ▼                     ▼
     ┌─────────────┐    ┌────────────────┐    ┌────────────────┐
     │ SQLite      │    │ SQLite FTS5    │    │ local FS       │
     │ + sqlite-vec│    │ (BM25 lexical) │    │ scenes + core  │
     │ (T0,T1 vec) │    │ (T0,T1 lexical)│    │ (T2,T3)        │
     └─────────────┘    └────────────────┘    └────────────────┘
                          embeddings via OpenAI-compatible endpoint
```

The store is a single embeddable class (`Stratus`). The gateway is a thin
JSON wrapper over it for multi-process or polyglot deployments.

---

## Why "STRATUS"

Memory in this system is **stratified**: it settles into discrete layers, and
recall draws from whichever stratum best answers a query. *Strata* is the
scientific term for layers; the name reads operationally and describes exactly
what the system does.

## License

Apache-2.0. See [LICENSE](LICENSE).
