/**
 * FALDA Distiller — L0→L1→L2→L3 pipeline runner.
 *
 * Reads new T0 stream turns since a watermark, calls an LLM to extract
 * atoms (T1), synthesizes scene blocks (T2), and refreshes core (T3).
 *
 * Usage (CLI):
 *   FALDA_PORT=8077 FALDA_LLM_BASE_URL=http://... FALDA_LLM_MODEL=... \
 *     node dist/distiller.js [--once] [--interval-ms=60000]
 *
 * Or import and call distillOnce() from your own scheduler.
 *
 * Environment:
 *   FALDA_PORT            Gateway port (default 8077)
 *   FALDA_DISTILL_WINDOW  Seconds of stream to scan per run (default 3600 = 1 hour)
 *   FALDA_LLM_BASE_URL    OpenAI-compatible base URL for LLM calls
 *   FALDA_LLM_API_KEY     API key for the LLM endpoint
 *   FALDA_LLM_MODEL       Model to use for extraction (default gpt-4o-mini)
 *   FALDA_DISTILL_INTERVAL_MS  Interval between runs in daemon mode (default 60000)
 *   FALDA_WATERMARK_FILE  Path to persist the watermark timestamp (default .falda-watermark)
 */

import * as fs from "node:fs";

// ─── Config ───────────────────────────────────────────────────────────────────

const GATEWAY = `http://localhost:${process.env.FALDA_PORT ?? 8077}`;
const LLM_BASE = (process.env.FALDA_LLM_BASE_URL ?? "").replace(/\/$/, "");
const LLM_KEY = process.env.FALDA_LLM_API_KEY ?? "";
const LLM_MODEL = process.env.FALDA_LLM_MODEL ?? "gpt-4o-mini";
const WINDOW_SECS = Number(process.env.FALDA_DISTILL_WINDOW ?? 3600);
const INTERVAL_MS = Number(process.env.FALDA_DISTILL_INTERVAL_MS ?? 60_000);
const WATERMARK_FILE = process.env.FALDA_WATERMARK_FILE ?? ".falda-watermark";

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function faldaPost(route: string, body: unknown): Promise<any> {
  const res = await fetch(`${GATEWAY}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`FALDA ${route} → ${res.status}: ${await res.text()}`);
  return res.json();
}

async function llmChat(systemPrompt: string, userText: string): Promise<string> {
  if (!LLM_BASE) throw new Error("FALDA_LLM_BASE_URL is not set");
  const res = await fetch(`${LLM_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(LLM_KEY ? { authorization: `Bearer ${LLM_KEY}` } : {}),
    },
    body: JSON.stringify({
      model: LLM_MODEL,
      temperature: 0.2,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userText },
      ],
    }),
  });
  if (!res.ok) throw new Error(`LLM call failed ${res.status}: ${await res.text()}`);
  const data: any = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

function readWatermark(): string {
  try { return fs.readFileSync(WATERMARK_FILE, "utf8").trim(); } catch { return ""; }
}

function writeWatermark(ts: string) {
  fs.writeFileSync(WATERMARK_FILE, ts, "utf8");
}

// ─── Extraction prompts (Argo extraction style) ──────────────────

const ATOM_SYSTEM = `\
You are a memory distiller. Given a block of conversation turns, extract
atomic facts, preferences, decisions, and rules worth remembering long-term.
Return ONLY a JSON array of objects, each with:
  { "type": "fact"|"preference"|"rule"|"decision", "content": "...", "background": "..." }
"content" is the distilled atom (one sentence). "background" is optional supporting context.
Extract only genuinely reusable information — skip greetings, filler, and transient data.
If nothing is worth keeping, return [].`;

const SCENE_SYSTEM = `\
You are a memory synthesizer. Given a set of distilled atoms and existing scene notes,
write or update a short scene-block markdown summary (3–8 sentences) capturing
the key themes, decisions, and context from this session window.
Return ONLY the markdown text (no JSON wrapper, no preamble).`;

const CORE_SYSTEM = `\
You are a persona/project synthesizer. Given the current core document and new atoms,
update the core document to reflect any durable changes to identity, preferences,
long-running projects, or key contacts. Preserve existing content unless clearly
superseded. Return ONLY the updated markdown document.`;

// ─── Main distillation pass ───────────────────────────────────────────────────

export async function distillOnce(opts: { verbose?: boolean } = {}): Promise<void> {
  const log = opts.verbose ? console.log : () => {};

  // 1. Read watermark — scan stream since last run
  const watermark = readWatermark();
  const now = new Date().toISOString();
  const windowStart = watermark || new Date(Date.now() - WINDOW_SECS * 1000).toISOString();

  log(`[distiller] scanning stream from ${windowStart} → ${now}`);

  // 2. Fetch stream turns in window
  const streamResult = await faldaPost("/stream/query", {
    time_start: windowStart,
    time_end: now,
    limit: 500,
    offset: 0,
  });

  const messages: Array<{ id: string; role: string; content: string; timestamp: string }> =
    streamResult.messages ?? [];

  if (messages.length === 0) {
    log("[distiller] no new stream turns — nothing to distill");
    writeWatermark(now);
    return;
  }

  log(`[distiller] found ${messages.length} stream turns to distill`);

  // 3. L0→L1: Extract atoms
  const turnText = messages
    .map((m) => `[${m.timestamp}] ${m.role}: ${m.content}`)
    .join("\n");

  const atomJson = await llmChat(ATOM_SYSTEM, turnText);
  let newAtoms: Array<{ type: string; content: string; background?: string }> = [];
  try {
    newAtoms = JSON.parse(atomJson);
    if (!Array.isArray(newAtoms)) newAtoms = [];
  } catch {
    log("[distiller] atom extraction returned non-JSON, skipping atom upsert");
  }

  log(`[distiller] extracted ${newAtoms.length} atoms`);
  for (const atom of newAtoms) {
    if (!atom.content?.trim()) continue;
    await faldaPost("/atoms/upsert", atom);
  }

  // 4. L1→L2: Synthesize a scene block for this window
  if (newAtoms.length > 0) {
    const scenePath = `auto/${now.slice(0, 10)}.md`;
    let existing = "";
    try {
      const sr = await faldaPost("/scenes/read", { path: scenePath });
      existing = sr.content ?? "";
    } catch { /* new scene */ }

    const sceneInput = [
      "## Existing scene\n" + (existing || "(none)"),
      "## New atoms\n" + newAtoms.map((a) => `- [${a.type}] ${a.content}`).join("\n"),
    ].join("\n\n");

    const sceneContent = await llmChat(SCENE_SYSTEM, sceneInput);
    if (sceneContent.trim()) {
      await faldaPost("/scenes/write", { path: scenePath, content: sceneContent.trim() });
      log(`[distiller] wrote scene → ${scenePath}`);
    }
  }

  // 5. L2→L3: Update core if we have enough new atoms (batch guard — avoid noisy core churn)
  if (newAtoms.length >= 3) {
    const coreResult = await faldaPost("/core/read", {});
    const currentCore: string = coreResult.content ?? "";
    const coreInput = [
      "## Current core\n" + (currentCore || "(empty — this is the first run)"),
      "## New atoms to integrate\n" + newAtoms.map((a) => `- [${a.type}] ${a.content}`).join("\n"),
    ].join("\n\n");

    const updatedCore = await llmChat(CORE_SYSTEM, coreInput);
    if (updatedCore.trim()) {
      await faldaPost("/core/write", { content: updatedCore.trim() });
      log(`[distiller] updated core (T3)`);
    }
  }

  // 6. Advance watermark
  writeWatermark(now);
  log(`[distiller] done — watermark advanced to ${now}`);
}

// ─── CLI entrypoint ───────────────────────────────────────────────────────────

if (process.argv[1]?.endsWith("distiller.js") || process.argv[1]?.endsWith("distiller.ts")) {
  const once = process.argv.includes("--once");
  const intervalArg = process.argv.find((a) => a.startsWith("--interval-ms="));
  const intervalMs = intervalArg ? Number(intervalArg.split("=")[1]) : INTERVAL_MS;

  (async () => {
    if (once) {
      await distillOnce({ verbose: true });
    } else {
      console.log(`[distiller] daemon mode — interval ${intervalMs}ms`);
      await distillOnce({ verbose: true });
      setInterval(() => distillOnce({ verbose: true }).catch(console.error), intervalMs);
    }
  })().catch((e) => { console.error("[distiller] fatal:", e); process.exit(1); });
}
