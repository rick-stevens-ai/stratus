/**
 * Minimal embedded-library usage example.
 * Run: npx tsx examples/basic.ts   (after `npm install`)
 */
import { Falda, makeLocalEmbedder } from "../src/index.js";

const memory = new Falda({
  dbPath: "./example.db",
  blobDir: "./example-blobs",
  embed: makeLocalEmbedder(768), // swap for makeEmbedder() against a real endpoint
  dim: 768,
});

await memory.addStream("session-A", [
  { role: "user", content: "The beamline runs at 2.4 GeV." },
  { role: "assistant", content: "Noted." },
]);

await memory.upsertAtom({ type: "fact", content: "Beamline energy is 2.4 GeV." });

const hits = await memory.searchAtoms("how much energy does the beamline use?", 3);
console.log(hits);

memory.writeScene("session-A/summary.md", "# Session A\nDiscussed beamline energy.");
memory.writeCore("# Core\nProject: accelerator operations.");

memory.close();
