/**
 * STRATUS HTTP gateway — exposes the four-tier memory store over a small JSON API.
 *
 * Routes (all POST, JSON in/out):
 *   /stream/add      {session_id, messages[]}            -> {accepted_ids, total_count}
 *   /stream/query    {session_id?, limit?, ...}          -> {messages, total}
 *   /stream/search   {query, limit?}                     -> {messages: hits}
 *   /stream/delete   {ids?|session_id}                   -> {deleted_count}
 *   /atoms/upsert    {id?, type?, content, background?}  -> Atom
 *   /atoms/query     {type?, limit?, ...}                -> {items, total}
 *   /atoms/search    {query, limit?}                     -> {items: hits}
 *   /atoms/delete    {ids[]}                             -> {deleted_count}
 *   /scenes/ls       {prefix?}                           -> {entries, total}
 *   /scenes/read     {path}                              -> {path, content}
 *   /scenes/write    {path, content}                     -> {path}
 *   /scenes/rm       {path}                              -> {path}
 *   /core/read       {}                                  -> {content}
 *   /core/write      {content}                           -> {ok}
 *   /healthz         (GET)                               -> {ok, tiers}
 */
import { createServer } from "node:http";
import { Stratus } from "./stratus.js";
import { makeEmbedder, makeLocalEmbedder } from "./embedder.js";

const PORT = Number(process.env.STRATUS_PORT ?? 8077);
const DIM = Number(process.env.STRATUS_DIM ?? 768);

// Embedder selection:
//   STRATUS_EMBED=local                  -> deterministic offline embedder (no network)
//   STRATUS_EMBED=remote                 -> require a configured /v1/embeddings endpoint
//   (unset) + STRATUS_EMBED_BASE_URL set -> remote
//   (unset) + no base URL                -> local offline default (so it just works)
function selectEmbedder() {
  const mode = (process.env.STRATUS_EMBED ?? "").toLowerCase();
  const hasRemote = !!process.env.STRATUS_EMBED_BASE_URL;
  if (mode === "local") { console.log("STRATUS embedder: local (offline, deterministic)"); return makeLocalEmbedder(DIM); }
  if (mode === "remote" || hasRemote) { console.log(`STRATUS embedder: remote (${process.env.STRATUS_EMBED_BASE_URL ?? "http://localhost:11434/v1"})`); return makeEmbedder(); }
  console.log("STRATUS embedder: local (offline default; set STRATUS_EMBED_BASE_URL for dense recall)");
  return makeLocalEmbedder(DIM);
}

const store = new Stratus({
  dbPath: process.env.STRATUS_DB ?? "./stratus.db",
  blobDir: process.env.STRATUS_BLOBS ?? "./stratus-blobs",
  embed: selectEmbedder(),
  dim: DIM,
});

async function handle(route: string, b: any) {
  switch (route) {
    case "/stream/add":    return { accepted_ids: await store.addStream(b.session_id, b.messages ?? []), total_count: (b.messages ?? []).length };
    case "/stream/query":  return store.queryStream(b);
    case "/stream/search": return { messages: await store.searchStream(b.query, b.limit) };
    case "/stream/delete": return { deleted_count: store.deleteStream(b) };
    case "/atoms/upsert":  return await store.upsertAtom(b);
    case "/atoms/query":   return store.queryAtoms(b);
    case "/atoms/search":  return { items: await store.searchAtoms(b.query, b.limit) };
    case "/atoms/delete":  return { deleted_count: store.deleteAtoms(b.ids ?? []) };
    case "/scenes/ls":     return store.listScenes(b.prefix ?? "");
    case "/scenes/read":   return { path: b.path, content: store.readScene(b.path) };
    case "/scenes/write":  return (store.writeScene(b.path, b.content ?? ""), { path: b.path });
    case "/scenes/rm":     return (store.removeScene(b.path), { path: b.path });
    case "/core/read":     return { content: store.readCore() };
    case "/core/write":    return (store.writeCore(b.content ?? ""), { ok: true });
    default: return null;
  }
}

createServer((req, res) => {
  if (req.method === "GET" && req.url === "/healthz") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, tiers: ["stream", "atoms", "scenes", "core"] }));
  }
  if (req.method !== "POST") { res.writeHead(405); return res.end(); }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", async () => {
    try {
      const parsed = body ? JSON.parse(body) : {};
      const out = await handle(req.url ?? "", parsed);
      if (out === null) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ error: "unknown route" })); }
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e: any) {
      res.writeHead(500, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: String(e?.message ?? e) }));
    }
  });
}).listen(PORT, () => console.log(`STRATUS gateway listening on :${PORT}`));
