# STRATUS Pools — multi-tenant routing + opt-in shared pools

Status: **v1 contract.** Implemented in `src/pools.ts`, wired in `src/gateway.ts`,
proven by `test/pools.test.ts` (21 assertions). Additive — single-store callers
and the `Stratus` class are unchanged.

## Why

Until now STRATUS was single-tenant: one DB, one blob dir, no tenant axis. Two
needs:

1. **Tenant routing** — many agents share one gateway, each with a *private*
   store, zero bleed. This is the default and matches single-store behavior exactly.
2. **Shared pools** — an *opt-in* way for named groups of agents to read/write a
   shared slice of memory at any tier, with careful, enforced access — without
   ever making sharing the default.

## Addressing model

Every data operation is addressed by a **(tenant, pool)** pair.

| field    | meaning                                   | default            |
|----------|-------------------------------------------|--------------------|
| `tenant` | agent identity (`kukla`, `ollie`, …)      | `STRATUS_DEFAULT_TENANT` (`default`) |
| `pool`   | namespace within reach                    | `self` (private)   |

- **No `pool`** → the tenant's own private store (`self`). Pure single-store parity.
- **`pool: "<name>"`** → a declared shared pool the tenant is a member of.
- `self` is **reserved** — it is the private pool and cannot be declared.

## Sharing is opt-in and explicit

- A shared pool exists **only after it is declared** with an explicit member
  roster. Touching an undeclared pool is an error (`no_such_pool`), never an
  autovivify.
- A tenant absent from a pool's roster has access `none` and is denied
  (`not_a_member`). Membership is allow-list, not deny-list.
- Per-member access modes: `none` (default), `read`, `readwrite`. A `read`
  member writing is denied (`read_only`).

## Strict-clean isolation is PHYSICAL, not predicate-based

This is the load-bearing design choice. Isolation is **not** a `tenant` column on
a shared table guarded by WHERE clauses (one forgotten `AND` = a cross-tenant
leak — the exact discipline-based failure mode we reject). Instead:

- Each `(tenant, self)` is **its own SQLite file + blob dir.**
- Each named pool is **one SQLite file + blob dir** that member tenants route to.
- A `self` query literally **cannot open** a pool DB, and a pool query cannot
  open a `self` DB. The isolation boundary is the filesystem, not a query
  predicate.

On-disk layout under `STRATUS_ROOT`:

```
root/
  tenants/<tenant>/self/{stratus.db, blobs/}   private store (one per agent)
  pools/<pool>/{stratus.db, blobs/}            shared store (one per pool)
  pools.json                                   pool registry (roster + access)
```

Proven by tests 5d–5f: a shared write is visible to other members **only**
through the pool, never through any member's private `self` store; private atoms
never appear in the pool.

## Recall scoping

A search/query runs against **exactly one** (tenant, pool) target. There is no
implicit union across self + pools — a forgotten scope can never silently widen
recall. A "search my self and every pool I can reach" view is a deliberate
multi-target fan-out the caller composes explicitly (client-side, or a future
`/recall/union` route), never the default.

## HTTP API

### Data routes (all POST) — each accepts optional `{tenant?, pool?}`

Behavior identical to single-store STRATUS, now scoped to the addressed store:

```
/stream/{add,query,search,delete}
/atoms/{upsert,query,search,delete}
/scenes/{ls,read,write,rm}
/core/{read,write}
```

Write routes (`/stream/add`, `/stream/delete`, `/atoms/upsert`, `/atoms/delete`,
`/scenes/write`, `/scenes/rm`, `/core/write`) require `readwrite` on a shared
pool. Read routes require `read` or `readwrite`.

### Pool admin routes (POST)

```
/pools/declare  {name, members:{tenant:access}, description?}  -> PoolDecl
/pools/update   {name, members?, description?}                 -> PoolDecl   (replaces roster)
/pools/grant    {name, tenant, access}                         -> PoolDecl   (one tenant; access="none" removes)
/pools/get      {name}                                         -> {pool}
/pools/list     {}                                             -> {pools}
/pools/mine     {tenant}                                       -> {pools}    (only reachable, with access)
```

### Status codes

| code | error                          | HTTP |
|------|--------------------------------|------|
| `no_such_pool`  | pool not declared   | 404  |
| `not_a_member`  | tenant has no access| 403  |
| `read_only`     | write w/ read access| 403  |
| `bad_name` / `bad_tenant` / `reserved` / `exists` | malformed / reserved / dup | 400 |

## Environment

| var | meaning | default |
|-----|---------|---------|
| `STRATUS_ROOT`           | pool root dir        | `./stratus-data` |
| `STRATUS_DEFAULT_TENANT` | tenant when unset    | `default` |
| `STRATUS_PORT` / `STRATUS_DIM` / `STRATUS_EMBED*` | as before | — |

## Migration from single-store

The old `STRATUS_DB` / `STRATUS_BLOBS` single-store layout is superseded by
`STRATUS_ROOT`. To migrate an existing deployment's data into the new layout,
move the old store under the default tenant's self slot:

```
mkdir -p $STRATUS_ROOT/tenants/$STRATUS_DEFAULT_TENANT/self
mv old/stratus.db        $STRATUS_ROOT/tenants/default/self/stratus.db
mv old/stratus-blobs     $STRATUS_ROOT/tenants/default/self/blobs
```

After that, an unaddressed request (`{}`) hits exactly the old data — no behavior
change for existing single-tenant callers.

## What this contract does NOT yet include (next deltas)

- **Cross-pool union recall** (`/recall/union`) — explicit multi-target fan-out.
- **Pool-scoped distillation** — the distiller currently runs per single store;
  a pool with shared T0 should distill into shared T1/T2/T3 under a named owner.
- **Audit log** of pool writes (who wrote what, when) for shared-pool governance.
- **Quota / retention** per pool.

These are deliberately deferred so the isolation + access core lands first and
small.
