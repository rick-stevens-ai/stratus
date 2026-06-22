/**
 * STRATUS smoke test — exercises every tier and the hybrid recall path,
 * fully offline (deterministic local embedder, in-memory SQLite).
 */
import { Stratus } from "../src/stratus.js";
import { makeLocalEmbedder } from "../src/embedder.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let pass = 0, fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else    { fail++; console.log(`  FAIL ${name}`); }
}

async function main() {
  const blobDir = fs.mkdtempSync(path.join(os.tmpdir(), "stratus-"));
  const s = new Stratus({ dbPath: ":memory:", blobDir, embed: makeLocalEmbedder(768), dim: 768 });

  // T0 Stream
  const ids = await s.addStream("sess-1", [
    { role: "user", content: "We deployed the spallation neutron detector at 14.7 MeV." },
    { role: "assistant", content: "Logged. Calibration drift was under 2%." },
    { role: "user", content: "Remember the cryostat target temperature is 4.2 K." },
  ]);
  check("T0 add returns ids", ids.length === 3);
  check("T0 query by session", s.queryStream({ session_id: "sess-1" }).total === 3);
  const sHit = await s.searchStream("neutron detector energy", 2);
  check("T0 hybrid search returns hits", sHit.length > 0);
  check("T0 delete by session", s.deleteStream({ session_id: "sess-1" }) === 3);

  // T1 Atoms
  const a1 = await s.upsertAtom({ type: "fact", content: "Cryostat target temperature is 4.2 K." });
  const a2 = await s.upsertAtom({ type: "preference", content: "Report calibration drift as a percentage." });
  check("T1 upsert returns atom", !!a1.id && !!a2.id);
  const a1b = await s.upsertAtom({ id: a1.id, type: "fact", content: "Cryostat target temperature is 4.2 K (LHe)." });
  check("T1 upsert updates in place", a1b.id === a1.id);
  check("T1 query by type", s.queryAtoms({ type: "fact" }).total === 1);
  const aHit = await s.searchAtoms("what temperature is the cryostat", 3);
  check("T1 hybrid search returns hits", aHit.length > 0);
  check("T1 delete by id", s.deleteAtoms([a2.id]) === 1);

  // T2 Scenes
  s.writeScene("projects/sns/run-2026-06-22.md", "# Run summary\nDetector stable.");
  check("T2 scene read round-trips", s.readScene("projects/sns/run-2026-06-22.md")!.includes("Detector stable"));
  check("T2 scene ls finds it", s.listScenes("projects/").entries.length === 1);
  s.removeScene("projects/sns/run-2026-06-22.md");
  check("T2 scene rm", s.readScene("projects/sns/run-2026-06-22.md") === null);

  // T3 Core
  s.writeCore("# Agent core\nDomain: experimental nuclear physics.");
  check("T3 core round-trips", s.readCore().includes("nuclear physics"));

  s.close();
  fs.rmSync(blobDir, { recursive: true, force: true });

  console.log(`\nSTRATUS smoke: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log("ALL TIERS GREEN");
}
main().catch((e) => { console.error(e); process.exit(1); });
