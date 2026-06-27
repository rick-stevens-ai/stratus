// FALDA deck generator — open, US-origin hierarchical agent-memory store.
// Reuses the shared deck_lib (palette, fonts, >=16pt rule, diagram primitives).
// HARD RULE: no fontSize below 16 anywhere.
const path = require("path");
const LIB = path.join(__dirname, "deck_lib.cjs");
const { C, HF, BF, makeLib, PptxGenJS } = require(LIB);

const pptx = new PptxGenJS();
pptx.defineLayout({ name: "W", width: 13.333, height: 7.5 });
pptx.layout = "W";
const L = makeLib(pptx);
const TOTAL = 14;
let N = 0;
const slide = () => { N++; return pptx.addSlide(); };

// ───────────────────────── 1. TITLE ─────────────────────────
(() => {
  const s = slide(); L.bgDark(s);
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 0, w: 13.333, h: 0.18, fill: { color: C.CYAN }, line: { type: "none" } });
  s.addText("FALDA", { x: 0.7, y: 2.2, w: 12, h: 1.4, fontFace: HF, fontSize: 76, bold: true, color: C.WHITE, charSpacing: 4 });
  s.addText("Clustered hierarchical memory for scientific agents", { x: 0.72, y: 3.6, w: 12, h: 0.7, fontFace: BF, fontSize: 26, color: C.ICE });
  s.addText("Open components · self-hosted · built to scale from one agent to thousands",
    { x: 0.72, y: 4.35, w: 12, h: 0.6, fontFace: BF, fontSize: 18, color: C.CYAN });
  L.pill(s, 0.72, 5.4, 3.2, 0.5, "Apache-2.0 · open stack", C.TEAL);
})();

// ───────────────────────── 2. WHAT IT IS ─────────────────────────
(() => {
  const s = slide(); L.bgLight(s);
  L.kicker(s, "Overview", C.TEAL);
  L.title(s, "A memory store shaped like memory");
  s.addText("Agents need more than a chat log. FALDA layers memory into four strata — from raw observation to long-lived persona — so recall returns the right grain of context for the question.",
    { x: 0.7, y: 1.95, w: 12, h: 0.9, fontFace: BF, fontSize: 18, color: "33414F", lineSpacingMultiple: 1.15 });
  const y = 3.05, w = 2.86, h = 2.9, gap = 0.18;
  const cards = [
    ["T0 · Stream", "Raw conversation and observation log. Every turn, every event.", C.CYAN],
    ["T1 · Atoms", "Distilled atomic memories — facts, preferences, rules.", C.TEAL],
    ["T2 · Scenes", "Synthesized episodic blocks summarizing what happened.", C.GREEN],
    ["T3 · Core", "Long-lived persona and project core. The durable self.", C.GOLD],
  ];
  cards.forEach((c, i) => L.card(s, 0.7 + i * (w + gap), y, w, h, c[0], c[1], { accent: c[2], hsize: 19, bsize: 17 }));
  L.foot(s, N, TOTAL, false);
})();

// ───────────────────────── 3. ARCHITECTURE DIAGRAM ─────────────────────────
(() => {
  const s = slide(); L.bgDark(s);
  L.kicker(s, "Architecture", C.CYAN);
  s.addText("Four tiers, one open backing store", { x: 0.7, y: 0.98, w: 12, h: 1.0, fontFace: HF, fontSize: 40, bold: true, color: C.WHITE });
  // tier stack left
  const tx = 0.8, tw = 3.4, th = 0.92, ty0 = 2.2, vg = 0.28;
  const tiers = [["T0", "Stream", C.CYAN], ["T1", "Atoms", C.TEAL], ["T2", "Scenes", C.GREEN], ["T3", "Core", C.GOLD]];
  tiers.forEach((t, i) => {
    const yy = ty0 + i * (th + vg);
    L.node(s, tx, yy, tw, th, t[1], { tag: t[0], line: t[2] });
    if (i < 3) L.arrowDown(s, tx + tw / 2, yy + th + 0.02, vg - 0.04, t[2]);
  });
  // backing stores right
  const bx = 6.4;
  s.addText("BACKING STORE (all open)", { x: bx, y: 2.0, w: 6, h: 0.4, fontFace: BF, fontSize: 16, bold: true, color: C.ICE, charSpacing: 1 });
  L.card(s, bx, 2.45, 6.0, 0.95, "SQLite + sqlite-vec", "Dense vector recall — cosine similarity over per-tier vectors.", { fill: C.NAVY2, line: C.CYAN, hcolor: C.WHITE, bcolor: C.ICE, accent: C.CYAN, bsize: 16 });
  L.card(s, bx, 3.55, 6.0, 0.95, "SQLite FTS5", "Lexical recall — BM25 full-text over the same content.", { fill: C.NAVY2, line: C.TEAL, hcolor: C.WHITE, bcolor: C.ICE, accent: C.TEAL, bsize: 16 });
  L.card(s, bx, 4.65, 6.0, 0.95, "Local filesystem", "Scene (T2) and core (T3) blobs, beside the database.", { fill: C.NAVY2, line: C.GOLD, hcolor: C.WHITE, bcolor: C.ICE, accent: C.GOLD, bsize: 16 });
  s.addText("No proprietary database. No managed service. Runs fully offline.", { x: bx, y: 5.75, w: 6, h: 0.5, fontFace: BF, fontSize: 17, italic: true, color: C.CYAN });
  L.foot(s, N, TOTAL, true);
})();

// ───────────────────────── 4. RECALL FUSION ─────────────────────────
(() => {
  const s = slide(); L.bgLight(s);
  L.kicker(s, "Recall", C.TEAL);
  L.title(s, "Dense + lexical, fused");
  s.addText("A query runs against both indexes; results merge by reciprocal-rank fusion. Semantic matches and exact-term matches each get their say — neither dominates.",
    { x: 0.7, y: 1.95, w: 12, h: 0.85, fontFace: BF, fontSize: 18, color: "33414F", lineSpacingMultiple: 1.15 });
  // query -> two paths -> fuse -> result
  L.node(s, 0.8, 3.4, 2.5, 1.0, "Query", { fill: C.INK, line: C.GREY });
  L.node(s, 4.2, 2.75, 3.0, 0.95, "Dense (sqlite-vec)\ncosine", { fill: C.TEAL, line: C.CYAN, size: 16 });
  L.node(s, 4.2, 4.05, 3.0, 0.95, "Lexical (FTS5)\nBM25", { fill: C.NAVY2, line: C.TEAL, size: 16 });
  L.node(s, 8.3, 3.4, 2.3, 1.0, "RRF fuse", { fill: C.GOLD, line: C.AMBER, tc: C.INK });
  L.node(s, 11.0, 3.4, 1.7, 1.0, "Ranked\nresults", { fill: C.GREEN, line: C.GREEN });
  L.arrowRight(s, 3.35, 3.9, 0.8, C.GREY);
  L.arrowRight(s, 7.25, 3.22, 1.0, C.CYAN);
  L.arrowRight(s, 7.25, 4.52, 1.0, C.TEAL);
  L.arrowRight(s, 10.65, 3.9, 0.3, C.GOLD);
  L.foot(s, N, TOTAL, false);
})();

// ───────────────────────── 5. SINGLE-NODE SHAPE ─────────────────────────
(() => {
  const s = slide(); L.bgLight(s);
  L.kicker(s, "Today", C.TEAL);
  L.title(s, "One process, one box, 1–50 agents");
  s.addText("`falda serve` embeds an entire store in a single Node process over one SQLite database. Install, smoke-test, and a live gateway in under a minute — the right shape for a workstation or a single VM.",
    { x: 0.7, y: 1.95, w: 12, h: 0.9, fontFace: BF, fontSize: 18, color: "33414F", lineSpacingMultiple: 1.15 });
  L.card(s, 0.7, 3.1, 3.9, 2.3, "Install", "./install.sh\n— checks Node ≥ 20\n— builds + smoke-tests\n— links the CLI", { accent: C.CYAN, bsize: 16 });
  L.card(s, 4.75, 3.1, 3.9, 2.3, "Run", "falda serve\nfalda health\nfalda smoke\n\nOffline by default.", { accent: C.TEAL, bsize: 16 });
  L.card(s, 8.8, 3.1, 3.85, 2.3, "Use", "POST /stream/add\nPOST /atoms/upsert\nPOST /*/search\nPOST /core/read|write", { accent: C.GOLD, bsize: 16 });
  L.foot(s, N, TOTAL, false);
})();

// ───────────────────────── 6. THE SCALING QUESTION ─────────────────────────
(() => {
  const s = slide(); L.bgDark(s);
  L.kicker(s, "The question", C.CYAN);
  s.addText("What does it take to run thousands of agents?", { x: 0.7, y: 0.98, w: 12, h: 1.0, fontFace: HF, fontSize: 40, bold: true, color: C.WHITE });
  s.addText("Design point: 1,000–10,000 agents, ~20% active at once.", { x: 0.7, y: 2.05, w: 12, h: 0.5, fontFace: BF, fontSize: 19, color: C.ICE });
  L.bigstat(s, 0.8, 2.9, 3.0, "2,000", "active agents (20% of 10k)", C.CYAN);
  L.bigstat(s, 4.0, 2.9, 3.0, "~2k/s", "sustained writes", C.GREEN);
  L.bigstat(s, 7.2, 2.9, 3.0, "~600/s", "recalls (embed+search)", C.GOLD);
  L.bigstat(s, 10.2, 2.9, 2.6, "10s of M", "vectors in aggregate", C.TEAL);
  s.addText("Two numbers dominate the plan: embedding throughput, and vector-search QPS × index size.",
    { x: 0.7, y: 5.6, w: 12, h: 0.5, fontFace: BF, fontSize: 18, italic: true, color: C.CYAN });
  L.foot(s, N, TOTAL, true);
})();

// ───────────────────────── 7. THE FOUR MOVES ─────────────────────────
(() => {
  const s = slide(); L.bgLight(s);
  L.kicker(s, "What we do", C.TEAL);
  L.title(s, "Four moves, all on the open stack");
  const y = 2.0, w = 5.9, h = 2.35, gx = 0.18, gy = 0.2;
  const moves = [
    ["1 · Store pool + sharding", "One SQLite DB per agent, lazily opened and LRU-evicted. Agents map to shards by hash(agent_id). Removes write contention entirely.", C.CYAN],
    ["2 · Stateless gateway fleet", "K replicas behind a consistent-hash router, shared-nothing — each owns a disjoint slice of agents. The biggest unlock, no shared hot-path state.", C.TEAL],
    ["3 · Dedicated embedding tier", "Batched GPU embedding service (vLLM/Ollama, open model) off the request path. Decouples embed throughput from gateway count.", C.GOLD],
    ["4 · Async pipeline workers", "T0→T1→T2 distillation runs on a worker pool off the hot path, reusing the lab's shared open-model LLM tier.", C.GREEN],
  ];
  moves.forEach((m, i) => {
    const cx = 0.7 + (i % 2) * (w + gx);
    const cy = y + Math.floor(i / 2) * (h + gy);
    L.card(s, cx, cy, w, h, m[0], m[1], { accent: m[2], hsize: 19, bsize: 17 });
  });
  L.foot(s, N, TOTAL, false);
})();

// ───────────────────────── 8. SCALING PHASES ─────────────────────────
(() => {
  const s = slide(); L.bgDark(s);
  L.kicker(s, "Rollout", C.CYAN);
  s.addText("Five phases, each independently shippable", { x: 0.7, y: 0.98, w: 12, h: 1.0, fontFace: HF, fontSize: 38, bold: true, color: C.WHITE });
  const rows = [
    ["Phase 1", "Store pool + sharding", "100s of agents on one node", C.CYAN],
    ["Phase 2", "Gateway fleet + router", "1,000s across a few nodes", C.TEAL],
    ["Phase 3", "Batched embedding tier", "removes write-path bottleneck", C.GOLD],
    ["Phase 4", "Async pipeline workers", "memory quality without blocking", C.GREEN],
    ["Phase 5", "ANN + aggregation + federation", "largest agents, multi-collection", C.ICE],
  ];
  let y = 2.2;
  rows.forEach((r) => {
    L.pill(s, 0.8, y, 1.7, 0.55, r[0], r[3], r[3] === C.ICE ? C.NAVY : C.NAVY);
    s.addText(r[1], { x: 2.7, y: y - 0.02, w: 5.2, h: 0.6, fontFace: BF, fontSize: 19, bold: true, color: C.WHITE, valign: "middle" });
    s.addText("→ " + r[2], { x: 8.0, y: y - 0.02, w: 4.8, h: 0.6, fontFace: BF, fontSize: 17, color: C.ICE, valign: "middle" });
    y += 0.85;
  });
  L.foot(s, N, TOTAL, true);
})();

// ───────────────────────── 9-11. HARDWARE TIERS ─────────────────────────
function hwSlide(kick, titleTxt, sub, rows, accent) {
  const s = slide(); L.bgLight(s);
  L.kicker(s, kick, C.TEAL);
  L.title(s, titleTxt);
  s.addText(sub, { x: 0.7, y: 1.9, w: 12, h: 0.55, fontFace: BF, fontSize: 18, color: "33414F" });
  let y = 2.65;
  rows.forEach((r) => {
    L.pill(s, 0.7, y + 0.06, 2.5, 0.5, r[0], accent, C.WHITE);
    s.addText(r[1], { x: 3.4, y, w: 3.0, h: 0.62, fontFace: BF, fontSize: 18, bold: true, color: C.INK, valign: "middle" });
    s.addText(r[2], { x: 6.5, y, w: 6.2, h: 0.62, fontFace: BF, fontSize: 16, color: "33414F", valign: "middle", lineSpacingMultiple: 1.05 });
    y += 0.72;
  });
  L.foot(s, N, TOTAL, false);
  return s;
}
hwSlide("Hardware · Tier A", "Pilot — up to ~250 agents", "Single node. One workstation or one cloud VM.", [
  ["CPU", "16 cores", "gateway event loop + SQLite + FTS across active stores"],
  ["RAM", "64 GB", "hot store pool (LRU) + FTS/vec page cache"],
  ["Disk", "2 TB NVMe", "per-agent SQLite + vectors; NVMe for random I/O"],
  ["GPU", "1 × 24 GB", "batched embedding model (A10 / L4 / 3090 class)"],
  ["Net", "10 GbE", "local — not a constraint at this size"],
], C.CYAN);

hwSlide("Hardware · Tier B", "Department — ~1,000–2,500 agents", "Shared-nothing shards; turn the embedding-GPU knob first when p99 climbs.", [
  ["Gateways", "3–4 nodes", "16-core / 64 GB / 2 TB NVMe each, agent→node by hash"],
  ["Router", "1 small node", "consistent-hash routing (or HW load balancer)"],
  ["Embed GPU", "1–2 × 40–48 GB", "A100-40 / L40S — ~600–1,500 embeds/sec batched"],
  ["Workers", "8–16 CPU", "async distillation; LLM calls go to shared tier"],
  ["Storage", "~8 TB NVMe", "per-agent DBs + blobs, 3-copy durability"],
], C.TEAL);

hwSlide("Hardware · Tier C", "Lab-wide — ~10,000 agents", "Binding constraint is embedding-GPU throughput, then aggregate NVMe IOPS.", [
  ["Gateways", "10–16 nodes", "32-core / 128 GB / 4 TB NVMe — wider shard fan-out"],
  ["Router", "HA pair", "consistent hashing, no single point of failure"],
  ["Embed GPU", "4–8 × 80 GB", "A100-80 / H100 / MI300 — 10k+ embeds/sec"],
  ["Workers", "40–80", "keep distillation backlog near zero"],
  ["Storage", "40–80 TB NVMe", "tens of millions of vectors + blobs, ≥3× replicated"],
], C.GOLD);

// ───────────────────────── 12. SIZING RULES ─────────────────────────
(() => {
  const s = slide(); L.bgLight(s);
  L.kicker(s, "Sizing rules", C.TEAL);
  L.title(s, "Plan GPU first, fast disk second, CPU last");
  const y = 2.1, w = 5.9, h = 1.7, gx = 0.18, gy = 0.2;
  const rules = [
    ["Embedding GPUs", "ceil(peak_embeds/sec ÷ per-GPU batched throughput). One 40–80 GB GPU ≈ 1–3k embeds/sec. Size with ≥25% headroom.", C.GOLD],
    ["Gateway nodes", "ceil(N_agents ÷ agents_per_node), where agents_per_node ≈ 250–700 by activity and RAM for the hot pool.", C.TEAL],
    ["NVMe storage", "N_agents × per_agent_bytes × replication. Always NVMe — SQLite + vector queries are random-I/O bound.", C.CYAN],
    ["RAM", "working-set stores × per-store page cache. Cold agents cost only disk, not memory.", C.GREEN],
  ];
  rules.forEach((r, i) => {
    const cx = 0.7 + (i % 2) * (w + gx);
    const cy = y + Math.floor(i / 2) * (h + gy);
    L.card(s, cx, cy, w, h, r[0], r[1], { accent: r[2], hsize: 19, bsize: 17 });
  });
  L.foot(s, N, TOTAL, false);
})();

// ───────────────────────── 13. WHAT WE DON'T NEED ─────────────────────────
(() => {
  const s = slide(); L.bgDark(s);
  L.kicker(s, "Out of scope", C.CYAN);
  s.addText("What we explicitly do not need", { x: 0.7, y: 0.98, w: 12, h: 1.0, fontFace: HF, fontSize: 40, bold: true, color: C.WHITE });
  const items = [
    "No proprietary vector database — sqlite-vec + optional faiss/hnsw covers it.",
    "No managed cloud queue, cache, or warehouse — a plain work queue + per-agent SQLite fan-out suffices.",
    "No dedicated distillation cluster — reuse the lab's shared open-model inference tier.",
    "No shared mutable cross-node state on the hot path — sharding by agent keeps the fleet shared-nothing.",
  ];
  let y = 2.3;
  items.forEach((t) => {
    s.addShape(pptx.ShapeType.roundRect, { x: 0.8, y: y + 0.08, w: 0.35, h: 0.35, rectRadius: 0.05, fill: { color: C.GREEN }, line: { type: "none" } });
    s.addText("✓", { x: 0.8, y: y + 0.02, w: 0.35, h: 0.45, fontFace: BF, fontSize: 18, bold: true, color: C.NAVY, align: "center" });
    s.addText(t, { x: 1.35, y, w: 11.3, h: 0.7, fontFace: BF, fontSize: 19, color: C.ICE, valign: "middle", lineSpacingMultiple: 1.1 });
    y += 1.0;
  });
  L.foot(s, N, TOTAL, true);
})();

// ───────────────────────── 14. CLOSE ─────────────────────────
(() => {
  const s = slide(); L.bgDark(s);
  s.addShape(pptx.ShapeType.rect, { x: 0, y: 7.32, w: 13.333, h: 0.18, fill: { color: C.CYAN }, line: { type: "none" } });
  s.addText("One agent to thousands — four moves, one open stack", { x: 0.7, y: 2.4, w: 12, h: 1.4, fontFace: HF, fontSize: 38, bold: true, color: C.WHITE, lineSpacingMultiple: 1.05 });
  s.addText("Store pool + sharding · stateless gateway fleet · batched embedding tier · async pipeline workers.\nDominated by embedding GPUs and fast NVMe — gateway CPU is the cheap part. Three-copy durability throughout.",
    { x: 0.72, y: 4.0, w: 12, h: 1.4, fontFace: BF, fontSize: 19, color: C.ICE, lineSpacingMultiple: 1.2 });
  L.pill(s, 0.72, 5.7, 5.4, 0.55, "FALDA · open · self-hosted · Apache-2.0", C.TEAL);
})();

const OUT = path.join("/Users/stevens/code/falda/deck", "FALDA.pptx");
require("fs").mkdirSync(path.dirname(OUT), { recursive: true });
pptx.writeFile({ fileName: OUT }).then(() => console.log("WROTE " + OUT + " (" + N + " slides)"));
