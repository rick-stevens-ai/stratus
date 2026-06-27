# FALDA at Scale — Supporting Thousands of Agents

**Document status:** architecture & capacity plan
**Component:** FALDA hierarchical agent-memory store
**Question answered:** *What do we have to do, and what hardware do we need, to run FALDA for thousands of concurrent scientific agents?*

---

## 1. What FALDA is today

FALDA is a four-tier memory store, all-open, all-local:

| Tier | Name | Contents | Backing store |
|---|---|---|---|
| **T0** | Stream | raw conversation / observation log | SQLite table + FTS5 + sqlite-vec |
| **T1** | Atoms | distilled facts / preferences / rules | SQLite table + FTS5 + sqlite-vec |
| **T2** | Scenes | synthesized episodic blocks | filesystem blobs + index |
| **T3** | Core | long-lived persona / project core | filesystem blob |

Recall fuses **dense** (sqlite-vec cosine) and **lexical** (FTS5 BM25) results
via reciprocal-rank fusion. The default single-process gateway (`falda serve`)
embeds an entire store in one Node process backed by one SQLite database.

That shape is perfect for **1–50 agents on one box**. It is *not* what carries
1,000–10,000 agents. The rest of this document is the path from one to many.

---

## 2. The shape of the workload at 1,000s of agents

Design point we size against:

- **N = 1,000 to 10,000 agents**, each with its own logical memory store.
- **Working set:** ~20% of agents active in any 5-minute window.
- **Per active agent:** ~1 write/sec (stream append) + ~0.3 recall/sec.
- **Memory footprint per agent:** 10k–500k stream rows, 1k–50k atoms,
  hundreds of scene blobs over its lifetime.

Aggregate at N = 10,000 (20% active = 2,000 active agents):

- ~2,000 writes/sec sustained, bursting to ~10k/sec.
- ~600 recalls/sec sustained (each recall = 1 embed call + 1 vector query + 1 FTS query + fusion).
- ~2,000 logical SQLite databases live, tens of millions of vectors in aggregate.

Two numbers dominate the hardware plan: **embedding throughput** (every write
and every recall needs a vector) and **vector-search QPS × index size**.

---

## 3. What we have to do (engineering)

The single-process gateway has four scaling limits. Each has a concrete fix.

### 3.1 Per-store isolation → store pool + sharding
*Limit:* one SQLite DB and one in-process store object.
*Fix:* a **store-pool** keyed by agent id. One SQLite database **per agent**
(or per small agent-group) instead of one shared DB — this is the natural unit
because SQLite write contention is per-database. Stores are opened lazily and
LRU-evicted from memory; cold agents cost only disk. Shard agents across M
gateway nodes by `hash(agent_id) % M` so any node owns a fixed, disjoint slice.

### 3.2 Single gateway process → horizontal gateway fleet
*Limit:* one Node process, one core effectively for the event loop.
*Fix:* run **K stateless gateway replicas** behind a load balancer. Each replica
owns its shard of agent stores (shared-nothing — no two replicas open the same
agent DB). Routing is deterministic by agent id, so there is no cross-node
coordination on the hot path. Add a thin **router** (or LB with consistent
hashing) in front. This is the single biggest unlock and needs no shared state.

### 3.3 Inline embedding → dedicated embedding tier
*Limit:* embedding is on the request path; a slow/remote embedder serializes writes.
*Fix:* stand up a **dedicated embedding service** (vLLM or Ollama serving an
open embedding model — `bge-base`, `gte-base`, `nomic-embed-text`) on GPU,
fronted by a queue. Gateways call it over the network; it batches requests
(32–256 texts/batch) to saturate the GPU. This decouples embed throughput from
gateway count and is where most of the GPU budget goes.

### 3.4 No background distillation → async pipeline workers
*Limit:* T0→T1 (atom extraction) and T1→T2 (scene synthesis) are LLM-heavy and
must not block writes.
*Fix:* a **pipeline-worker pool** consuming a work queue. Stream appends enqueue
a "maybe-distill" job; workers run the LLM extraction off the hot path and write
atoms/scenes back. Concurrency is tunable (start at ~10/worker). Workers are
horizontally scalable and independent of the gateway fleet. The LLM they call is
the same shared open-model inference tier the rest of the lab already runs.

### 3.5 Cross-cutting
- **Write path:** keep SQLite in WAL mode (already on); one writer per DB means
  sharding by agent removes contention entirely.
- **Vector index:** sqlite-vec is brute-force cosine — fine to ~10^5–10^6 vectors
  per store. For agents whose atom/stream vector count exceeds ~10^6, add an ANN
  index (hnswlib / faiss flat→IVF) behind the same recall interface. Most agents
  never hit this; it is a per-hot-agent upgrade, not a fleet-wide requirement.
- **Observability:** per-shard metrics (writes/sec, recall p50/p99, embed queue
  depth, distill backlog). Backlog depth is the early-warning signal for
  under-provisioned embedding/pipeline tiers.
- **Durability:** SQLite files on a replicated/over-3-store filesystem; scene/core
  blobs likewise. (Matches Rick's defense-in-depth posture: multiple copies.)

### Phased rollout

1. **Phase 1 — Store pool + sharding.** Lazy per-agent DBs, LRU eviction, deterministic agent→shard mapping. *Unblocks 100s of agents on one node.*
2. **Phase 2 — Gateway fleet + router.** K stateless replicas, consistent-hash routing, health checks. *Unblocks 1,000s across a few nodes.*
3. **Phase 3 — Embedding tier.** Batched GPU embedding service + queue. *Removes the write-path embed bottleneck.*
4. **Phase 4 — Pipeline workers.** Async T0→T1→T2 distillation off the hot path. *Keeps memory quality high without blocking writes.*
5. **Phase 5 — ANN + aggregation.** Per-hot-agent ANN index, cross-agent rollups, federation across collections. *Handles the largest individual agents and multi-collection deployments.*

---

## 4. Hardware configuration

Three sizing tiers. All numbers assume open components only (SQLite, sqlite-vec,
FTS5, vLLM/Ollama for embeddings, an existing shared open-model LLM tier for
distillation). Storage assumes embeddings at 768-dim float32 = 3 KB/vector.

### Tier A — Pilot: up to ~250 agents (single node)

| Resource | Spec | Why |
|---|---|---|
| CPU | 16 cores | gateway event loop + SQLite + FTS across active stores |
| RAM | 64 GB | hot store pool (LRU) + FTS/vec page cache |
| Disk | 2 TB NVMe SSD | ~250 agents × (stream+atoms+vectors); NVMe for SQLite random I/O |
| GPU | 1 × 24 GB (e.g. one A10/L4/3090) | embedding model serving, batched |
| Network | 10 GbE | local, not a constraint at this size |

Single `falda serve` + one embedding container co-resident. No router needed.
This is the "one good workstation / one cloud VM" tier.

### Tier B — Department: ~1,000–2,500 agents

| Resource | Spec | Why |
|---|---|---|
| Gateway nodes | 3–4 × (16-core, 64 GB, 2 TB NVMe) | shared-nothing shards, agent→node by hash |
| Router / LB | 1 small node (4-core, 8 GB) or HW LB | consistent-hash routing |
| Embedding GPUs | 1–2 × 40–48 GB (A100-40 / L40S) | ~600–1,500 embeds/sec batched |
| Pipeline workers | 8–16 CPU workers (can share gateway nodes) | async distillation; LLM calls go to shared tier |
| LLM for distillation | shared lab open-model inference tier | not dedicated; reuse existing |
| Aggregate storage | ~8 TB NVMe across nodes + replicated backing | per-agent DBs + blobs, 3-copy durability |

Sustains ~2,000 writes/sec and ~600 recalls/sec with headroom. The embedding GPU
count is the knob you turn first when recall p99 climbs.

### Tier C — Lab-wide: ~10,000 agents

| Resource | Spec | Why |
|---|---|---|
| Gateway nodes | 10–16 × (32-core, 128 GB, 4 TB NVMe) | wider shard fan-out; bigger page cache per node |
| Router | HA pair, consistent hashing | no single point of failure |
| Embedding GPUs | 4–8 × A100-80 / H100 (or MI300) | 10k+ embeds/sec; this is the dominant GPU spend |
| Pipeline workers | 40–80 workers across a small cluster | keep distill backlog near zero |
| LLM for distillation | shared multi-GPU open-model tier (existing) | scale distill quality independently |
| ANN service | optional, for the few agents >10^6 vectors | faiss/hnsw behind the recall interface |
| Storage | ~40–80 TB NVMe (sharded) + ≥3× replication | tens of millions of vectors + blobs, durable |

At this tier the binding constraint is **embedding GPU throughput**, followed by
**aggregate NVMe IOPS** for the per-agent SQLite fan-out. Gateway CPU is cheap by
comparison. Plan GPU first, fast disk second, CPU last.

### Sizing rules of thumb

- **Embedding GPUs** ≈ ceil( peak_embeds_per_sec / per_GPU_batched_throughput ).
  One modern 40–80 GB GPU serving `bge-base`-class models does ~1,000–3,000
  embeds/sec batched. This is the number that scales with agent count — size it
  with ≥25% headroom (matches Rick's wider-than-tighter HPC heuristic).
- **Gateway nodes** ≈ ceil( N_agents / agents_per_node ), `agents_per_node`
  ≈ 250–700 depending on activity and RAM for the hot pool.
- **NVMe** ≈ N_agents × per_agent_bytes × replication_factor. Always NVMe, never
  spinning disk — SQLite + vector queries are random-I/O bound.
- **RAM** ≈ working-set stores × per-store page cache. Cold agents cost only disk.

---

## 5. What we explicitly do *not* need

- No proprietary vector database — sqlite-vec + optional faiss/hnsw covers it.
- No managed cloud queue/cache/warehouse — a plain work queue and the per-agent
  SQLite fan-out are sufficient; everything stays on open, self-hostable parts.
- No dedicated distillation cluster — reuse the lab's existing shared open-model
  inference tier.
- No shared mutable cross-node state on the hot path — sharding by agent id keeps
  the fleet shared-nothing, which is what makes it scale linearly.

---

## 6. Summary

Getting FALDA from one agent to thousands is four moves — **store pool +
sharding, a stateless gateway fleet, a batched embedding tier, and async pipeline
workers** — none of which require leaving the open/self-hosted stack. The
hardware story is dominated by **embedding GPUs** and **fast NVMe**; gateway CPU
is the cheap part. A single 24 GB-GPU workstation carries the pilot; 3–4 nodes
plus one or two 40 GB GPUs carry a department; ~12 nodes plus 4–8 large GPUs
carry the full lab at 10,000 agents — with three-copy durability throughout.
