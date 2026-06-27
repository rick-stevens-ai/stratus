# Installing FALDA

FALDA is a self-contained TypeScript/Node package. It has two runtime
dependencies — `better-sqlite3` (embedded SQLite, with a native addon) and
`sqlite-vec` (vector search) — and runs fully offline by default.

## Requirements

- **Node.js 20–26** and npm (npm ships with Node). CI covers Node 20, 22, 24, and 26 on Linux and macOS.
- **No C toolchain needed for the common case.** `better-sqlite3` (>= 12) ships
  prebuilt binaries for macOS (arm64/x64) and Linux (arm64/x64) on supported Node
  versions, and `sqlite-vec` is distributed as a prebuilt extension — so a normal
  `npm install` does not compile anything.
- A C toolchain is only needed as a **fallback** if no prebuilt binary matches your
  platform/Node combo:
  - **macOS:** Xcode Command Line Tools (`xcode-select --install`).
  - **Linux:** `build-essential` + `python3` (e.g. `apt install build-essential python3`).
  - **Windows:** the windows-build-tools / Visual Studio C++ workload.

> Note: pin `better-sqlite3` to a release that supports your Node version. Versions
> < 12 predate Node 26 and will fall back to a native compile (and may fail) on
> newer Node. FALDA pins `^12.11.1` for this reason.

No external service is required to install or smoke-test. Embeddings are
optional and only contacted at runtime if you configure an embedder endpoint.

## Quick install

```bash
git clone <your-falda-remote> falda     # or copy the directory
cd falda
./install.sh
```

The installer:

1. verifies Node >= 20 and npm,
2. installs dependencies (`npm ci` when a lockfile is present),
3. builds TypeScript to `dist/`,
4. runs the offline smoke test (all four tiers + hybrid recall),
5. prints next steps.

### Put the CLI on your PATH

```bash
./install.sh --link                 # symlink bin/falda into /usr/local/bin or ~/.local/bin
./install.sh --link --prefix ~/bin  # choose the link target
```

### Other flags

```bash
./install.sh --no-smoke    # skip the smoke test (faster CI installs)
./install.sh --help
```

## Using the CLI

```bash
falda serve            # start the HTTP gateway (default :8077)
falda health           # curl /healthz
falda smoke            # re-run the offline smoke test
falda build            # recompile to dist/
falda version
```

## Using it as a library

```bash
npm install falda-memory
```

```ts
import { Falda, makeLocalEmbedder } from "falda-memory";

const mem = new Falda({ db: ":memory:", embedder: makeLocalEmbedder(768) });
await mem.addStream({ agent: "kukla", role: "user", text: "remember this" });
const hits = await mem.recall("kukla", "what should I remember?");
```

## Configuration (environment)

| Variable | Default | Meaning |
|---|---|---|
| `FALDA_PORT` | `8077` | Gateway listen port |
| `FALDA_DB` | `./falda.db` | SQLite path (`:memory:` for ephemeral) |
| `FALDA_EMBED_BASE_URL` | _(unset)_ | OpenAI-compatible `/v1/embeddings` base URL |
| `FALDA_EMBED_API_KEY` | _(unset)_ | API key for the embedder, if required |
| `FALDA_EMBED_MODEL` | `nomic-embed-text` | Embedding model id |

With no embedder configured, FALDA uses a built-in **deterministic local
embedder** so the gateway and all four tiers work fully offline out of the box
(lexical FTS5/BM25 recall plus a no-network dense vector). Set
`FALDA_EMBED_BASE_URL` (or `FALDA_EMBED=remote`) to switch to a real
embedding model — local Ollama, self-hosted vLLM/llama.cpp, or any
OpenAI-compatible service — for production-quality dense + hybrid recall.

Embedder selection precedence (gateway):

- `FALDA_EMBED=local` → force the offline deterministic embedder.
- `FALDA_EMBED=remote` → require a configured `/v1/embeddings` endpoint.
- unset + `FALDA_EMBED_BASE_URL` present → remote.
- unset + no base URL → offline local default.

> **Native addon / Node pinning.** `better-sqlite3` compiles a native addon
> against the Node.js ABI of whatever `node` ran `npm install`. If you later
> run the gateway under a *different* Node major version you may see
> `ERR_DLOPEN_FAILED` / `NODE_MODULE_VERSION` mismatch. Fix: run FALDA under
> the same Node you installed with, or rebuild with `npm rebuild better-sqlite3`.

## Uninstall

```bash
rm -f /usr/local/bin/falda ~/.local/bin/falda   # remove the symlink, if linked
rm -rf node_modules dist                             # remove build artifacts
```
