/**
 * FALDA pool test — proves multi-tenant isolation + opt-in shared-pool semantics.
 * Fully offline (deterministic local embedder, temp root on disk).
 *
 * Guarantees under test:
 *   1. Private "self" stores are physically isolated per tenant (no bleed).
 *   2. Sharing is opt-in: touching an undeclared pool errors.
 *   3. Non-members are denied (not_a_member).
 *   4. Read-only members cannot write (read_only).
 *   5. A readwrite member's write is visible to another (read) member — and ONLY
 *      through the pool, never through either member's private self store.
 */
import { PoolManager, PoolError } from "../src/pools.js";
import { makeLocalEmbedder } from "../src/embedder.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

let pass = 0, fail = 0;
function check(name: string, ok: boolean) {
  if (ok) { pass++; console.log(`  ok   ${name}`); }
  else    { fail++; console.log(`  FAIL ${name}`); }
}
async function throws(name: string, fn: () => Promise<any> | any, code: string) {
  try { await fn(); check(`${name} (expected ${code})`, false); }
  catch (e: any) { check(name, e instanceof PoolError && e.code === code); }
}

async function main() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "falda-pools-"));
  const pm = new PoolManager({ root, embed: makeLocalEmbedder(768), dim: 768 });

  // ── 1. Private self isolation ────────────────────────────────────────────
  const kSelf = pm.resolve("kukla", undefined, true);
  const oSelf = pm.resolve("ollie", undefined, true);
  await kSelf.upsertAtom({ id: "k1", type: "fact", content: "kukla private: OSTI corpus is 278,645 papers." });
  await oSelf.upsertAtom({ id: "o1", type: "fact", content: "ollie private: LUCID-100 is 91 of 91 parsed." });
  check("1a self stores are distinct objects", kSelf !== oSelf);
  check("1b kukla self sees only its own atom", pm.resolve("kukla", undefined, false).queryAtoms({}).total === 1);
  check("1c ollie self sees only its own atom", pm.resolve("ollie", undefined, false).queryAtoms({}).total === 1);
  const kHasO = await pm.resolve("kukla", undefined, false).searchAtoms("LUCID-100 parsed", 5);
  check("1d kukla self search cannot find ollie private", !kHasO.some((h) => h.id === "o1"));

  // ── 2. Sharing is opt-in: undeclared pool errors ─────────────────────────
  await throws("2a write to undeclared pool errors", () => pm.resolve("kukla", "ghost", true), "no_such_pool");
  await throws("2b read from undeclared pool errors", () => pm.resolve("kukla", "ghost", false), "no_such_pool");
  check("2c reserved name 'self' cannot be declared",
    (() => { try { pm.declarePool("self", {}); return false; } catch (e: any) { return e.code === "reserved"; } })());

  // ── 3. Declare a shared pool with explicit roster ────────────────────────
  const decl = pm.declarePool("corpus", { kukla: "readwrite", ollie: "read" }, "shared corpus facts");
  check("3a pool declared with members", decl.members.kukla === "readwrite" && decl.members.ollie === "read");
  check("3b pool appears in kukla's reachable set", pm.poolsForTenant("kukla").some((p) => p.name === "corpus"));
  check("3c pool appears in ollie's reachable set (read)",
    pm.poolsForTenant("ollie").some((p) => p.name === "corpus" && p.access === "read"));
  check("3d non-member sees no reachable pools", pm.poolsForTenant("piago").length === 0);

  // ── 4. Access enforcement ────────────────────────────────────────────────
  await throws("4a non-member denied", () => pm.resolve("piago", "corpus", false), "not_a_member");
  await throws("4b read-only member denied write", () => pm.resolve("ollie", "corpus", true), "read_only");

  // ── 5. Shared write visible to other member, isolated from self ──────────
  const kPool = pm.resolve("kukla", "corpus", true);
  await kPool.upsertAtom({ id: "shared1", type: "fact", content: "shared: Genesis Mission has 21 challenge areas." });
  check("5a readwrite member wrote to pool", pm.resolve("kukla", "corpus", false).queryAtoms({}).total === 1);
  const oPoolView = pm.resolve("ollie", "corpus", false);
  check("5b read member sees the shared atom", oPoolView.queryAtoms({}).total === 1);
  const oFind = await oPoolView.searchAtoms("how many challenge areas Genesis", 5);
  check("5c read member can search the shared atom", oFind.some((h) => h.id === "shared1"));
  // Strict-clean: the shared atom must NOT appear in anyone's private self store.
  check("5d shared atom absent from kukla self", pm.resolve("kukla", undefined, false).queryAtoms({}).total === 1);
  check("5e shared atom absent from ollie self", pm.resolve("ollie", undefined, false).queryAtoms({}).total === 1);
  // And private atoms must NOT appear in the pool.
  const poolIds = pm.resolve("kukla", "corpus", false).queryAtoms({}).items.map((a: any) => a.id);
  check("5f pool contains only shared atom", poolIds.length === 1 && poolIds[0] === "shared1");

  // ── 6. grant() flips access live ─────────────────────────────────────────
  pm.grant("corpus", "ollie", "readwrite");
  const oPoolW = pm.resolve("ollie", "corpus", true); // must not throw now
  await oPoolW.upsertAtom({ id: "shared2", type: "fact", content: "shared: topics 18-21 are cross-cutting platforms." });
  check("6a granted member can now write", pm.resolve("kukla", "corpus", false).queryAtoms({}).total === 2);
  pm.grant("corpus", "piago", "none"); // no-op removal, must not throw
  check("6b revoking a non-member is a safe no-op", pm.getPool("corpus")!.members.piago === undefined);

  pm.closeAll();
  fs.rmSync(root, { recursive: true, force: true });

  console.log(`\nFALDA pools: ${pass} passed, ${fail} failed`);
  if (fail) process.exit(1);
  console.log("POOL SEMANTICS GREEN");
}
main().catch((e) => { console.error(e); process.exit(1); });
