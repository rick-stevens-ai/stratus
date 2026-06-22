# STRATUS API

All routes are `POST` with a JSON body and JSON response, except `/healthz` (`GET`).
Gateway default port: `8077` (`STRATUS_PORT`).

## Tier T0 — Stream

### `POST /stream/add`
```json
{ "session_id": "sess-1", "messages": [ { "role": "user", "content": "..." } ] }
```
→ `{ "accepted_ids": ["..."], "total_count": 1 }`

### `POST /stream/query`
```json
{ "session_id": "sess-1", "limit": 50, "offset": 0, "time_start": "...", "time_end": "..." }
```
→ `{ "messages": [ { "id", "role", "content", "timestamp" } ], "total": 42 }`

### `POST /stream/search`  (hybrid dense + lexical)
```json
{ "query": "neutron detector energy", "limit": 10 }
```
→ `{ "messages": [ { "id", "role", "content", "timestamp", "score" } ] }`

### `POST /stream/delete`
```json
{ "ids": ["..."] }            // or { "session_id": "sess-1" }
```
→ `{ "deleted_count": 3 }`

## Tier T1 — Atoms

### `POST /atoms/upsert`
```json
{ "id": "optional", "type": "fact", "content": "...", "background": "optional" }
```
→ `{ "id", "type", "content", "background", "created_at", "updated_at" }`

### `POST /atoms/query`
```json
{ "type": "fact", "limit": 50, "offset": 0 }
```
→ `{ "items": [ Atom ], "total": 10 }`

### `POST /atoms/search`  (hybrid dense + lexical)
```json
{ "query": "what temperature is the cryostat?", "limit": 10 }
```
→ `{ "items": [ { ...Atom, "score" } ] }`

### `POST /atoms/delete`
```json
{ "ids": ["..."] }
```
→ `{ "deleted_count": 1 }`

## Tier T2 — Scenes  (markdown blobs on local FS)

| Route | Body | Returns |
|-------|------|---------|
| `POST /scenes/ls`    | `{ "prefix": "projects/" }` | `{ "entries": [ { "path", "created_at", "updated_at" } ], "total" }` |
| `POST /scenes/read`  | `{ "path": "a/b.md" }`      | `{ "path", "content" }` |
| `POST /scenes/write` | `{ "path": "a/b.md", "content": "..." }` | `{ "path" }` |
| `POST /scenes/rm`    | `{ "path": "a/b.md" }`      | `{ "path" }` |

## Tier T3 — Core  (single markdown document)

| Route | Body | Returns |
|-------|------|---------|
| `POST /core/read`  | `{}`                  | `{ "content" }` |
| `POST /core/write` | `{ "content": "..." }`| `{ "ok": true }` |

## Health

### `GET /healthz`
→ `{ "ok": true, "tiers": ["stream", "atoms", "scenes", "core"] }`
