/**
 * Embedding client for STRATUS.
 *
 * Calls an OpenAI-compatible /v1/embeddings endpoint — use any US open-weights
 * embedding model served via vLLM, Ollama, llama.cpp, or a hosted lab endpoint
 * (e.g. nomic-embed-text, BAAI/bge-base-en-v1.5, gte-base).
 *
 * Env:
 *   STRATUS_EMBED_BASE_URL   e.g. http://localhost:11434/v1  or  http://<lab-host>/v1
 *   STRATUS_EMBED_API_KEY    bearer token ("x" for keyless local servers)
 *   STRATUS_EMBED_MODEL      e.g. nomic-embed-text
 */
export interface EmbedderConfig { baseUrl?: string; apiKey?: string; model?: string; }

export function makeEmbedder(cfg: EmbedderConfig = {}) {
  const baseUrl = cfg.baseUrl ?? process.env.STRATUS_EMBED_BASE_URL ?? "http://localhost:11434/v1";
  const apiKey = cfg.apiKey ?? process.env.STRATUS_EMBED_API_KEY ?? "x";
  const model = cfg.model ?? process.env.STRATUS_EMBED_MODEL ?? "nomic-embed-text";

  return async function embed(text: string): Promise<number[]> {
    const resp = await fetch(`${baseUrl}/embeddings`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, input: text }),
    });
    if (!resp.ok) throw new Error(`embeddings ${resp.status}: ${await resp.text()}`);
    const j = (await resp.json()) as any;
    return j.data[0].embedding as number[];
  };
}

/** Deterministic local embedder for tests / offline development (no network). */
export function makeLocalEmbedder(dim = 768) {
  return async function embed(text: string): Promise<number[]> {
    const v = new Array(dim).fill(0);
    for (let i = 0; i < text.length; i++) v[i % dim] += text.charCodeAt(i) / 255;
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  };
}
