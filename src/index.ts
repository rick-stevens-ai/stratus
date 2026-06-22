/**
 * STRATUS — clustered hierarchical memory for scientific agents.
 * Public API barrel.
 */
export { Stratus } from "./stratus.js";
export type {
  StratusOptions, Embedder, StreamItem, StreamHit, Atom, AtomHit, SceneEntry,
} from "./stratus.js";
export { makeEmbedder, makeLocalEmbedder } from "./embedder.js";
export type { EmbedderConfig } from "./embedder.js";
