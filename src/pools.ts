/**
 * STRATUS pool layer — multi-tenant routing + opt-in shared pools.
 *
 * Design (see docs/POOLS.md for the full contract):
 *
 *   Every memory operation is addressed by a (tenant, pool) pair.
 *     tenant = agent identity (e.g. "kukla", "ollie"). Always required.
 *     pool   = namespace within reach. "self" (private, default) or a named
 *              shared pool ("lucid", "osti", ...).
 *
 *   Sharing is NOT the default. With no pool specified, every agent reaches
 *   only its own private store (pool="self") — exact single-store parity.
 *
 *   A shared pool exists only after it is DECLARED, with an explicit member
 *   roster and per-member access mode. Touching an undeclared pool is an error,
 *   never an autovivify.
 *
 * Strict-clean isolation is PHYSICAL, not predicate-based:
 *   - Each (tenant, "self") is its own SQLite file + blob dir.
 *   - Each named pool is ONE SQLite file + blob dir that member tenants route to.
 *   - A self query literally cannot open a pool DB and vice-versa. There is no
 *     shared table with a tenant column that a forgotten WHERE clause could leak.
 *
 * Layout under root/:
 *   root/tenants/<tenant>/self/{stratus.db, blobs/}     private store
 *   root/pools/<pool>/{stratus.db, blobs/}              shared store
 *   root/pools.json                                     pool registry
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { Stratus, type Embedder } from "./stratus.js";

export type Access = "none" | "read" | "readwrite";

export interface PoolDecl {
  /** Pool name (namespace key). */
  name: string;
  /** Free-text description for humans/audit. */
  description?: string;
  /** Per-tenant access map. Tenants absent from the map have "none". */
  members: Record<string, Access>;
  created_at: string;
  updated_at: string;
}

interface Registry { pools: Record<string, PoolDecl>; }

/** A pool name must be a safe single path segment. "self" is reserved. */
const NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;
const TENANT_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export class PoolError extends Error {
  constructor(public code: "bad_name" | "bad_tenant" | "no_such_pool" | "not_a_member" | "read_only" | "reserved" | "exists", msg: string) {
    super(msg);
    this.name = "PoolError";
  }
}

export class PoolManager {
  private root: string;
  private embed: Embedder;
  private dim: number;
  /** Open store cache keyed by physical store path. */
  private stores = new Map<string, Stratus>();
  private regPath: string;

  constructor(opts: { root: string; embed: Embedder; dim?: number }) {
    this.root = opts.root;
    this.embed = opts.embed;
    this.dim = opts.dim ?? 768;
    fs.mkdirSync(path.join(this.root, "tenants"), { recursive: true });
    fs.mkdirSync(path.join(this.root, "pools"), { recursive: true });
    this.regPath = path.join(this.root, "pools.json");
  }

  // ─── registry persistence ──────────────────────────────────────────────────
  private loadReg(): Registry {
    if (!fs.existsSync(this.regPath)) return { pools: {} };
    try { return JSON.parse(fs.readFileSync(this.regPath, "utf8")); }
    catch { return { pools: {} }; }
  }
  private saveReg(r: Registry) {
    fs.writeFileSync(this.regPath, JSON.stringify(r, null, 2), "utf8");
  }

  // ─── validation ─────────────────────────────────────────────────────────────
  private vTenant(t: string) {
    if (!TENANT_RE.test(t)) throw new PoolError("bad_tenant", `invalid tenant id: ${JSON.stringify(t)}`);
  }
  private vName(n: string) {
    if (n === "self") throw new PoolError("reserved", `"self" is the reserved private pool and cannot be declared`);
    if (!NAME_RE.test(n)) throw new PoolError("bad_name", `invalid pool name: ${JSON.stringify(n)}`);
  }

  // ─── pool declaration / admin ────────────────────────────────────────────────
  /** Declare a new shared pool. Fails if it already exists. */
  declarePool(name: string, members: Record<string, Access>, description = ""): PoolDecl {
    this.vName(name);
    for (const t of Object.keys(members)) this.vTenant(t);
    const reg = this.loadReg();
    if (reg.pools[name]) throw new PoolError("exists", `pool already exists: ${name}`);
    const now = new Date().toISOString();
    const decl: PoolDecl = { name, description, members: { ...members }, created_at: now, updated_at: now };
    reg.pools[name] = decl;
    this.saveReg(reg);
    // Materialize the store directory eagerly so membership == existence is honest.
    fs.mkdirSync(this.poolStorePath(name).dir, { recursive: true });
    return decl;
  }

  /** Update an existing pool's membership/description. Replaces the member map. */
  updatePool(name: string, patch: { members?: Record<string, Access>; description?: string }): PoolDecl {
    this.vName(name);
    const reg = this.loadReg();
    const decl = reg.pools[name];
    if (!decl) throw new PoolError("no_such_pool", `no such pool: ${name}`);
    if (patch.members) {
      for (const t of Object.keys(patch.members)) this.vTenant(t);
      decl.members = { ...patch.members };
    }
    if (patch.description !== undefined) decl.description = patch.description;
    decl.updated_at = new Date().toISOString();
    this.saveReg(reg);
    return decl;
  }

  /** Grant/change a single tenant's access without rewriting the whole roster. */
  grant(name: string, tenant: string, access: Access): PoolDecl {
    this.vName(name); this.vTenant(tenant);
    const reg = this.loadReg();
    const decl = reg.pools[name];
    if (!decl) throw new PoolError("no_such_pool", `no such pool: ${name}`);
    if (access === "none") delete decl.members[tenant];
    else decl.members[tenant] = access;
    decl.updated_at = new Date().toISOString();
    this.saveReg(reg);
    return decl;
  }

  getPool(name: string): PoolDecl | null { return this.loadReg().pools[name] ?? null; }
  listPools(): PoolDecl[] { return Object.values(this.loadReg().pools); }

  /** Pools a tenant can reach, with their effective access (read/readwrite only). */
  poolsForTenant(tenant: string): Array<{ name: string; access: Access; description: string }> {
    this.vTenant(tenant);
    return this.listPools()
      .map((p) => ({ name: p.name, access: p.members[tenant] ?? "none", description: p.description ?? "" }))
      .filter((p) => p.access !== "none");
  }

  // ─── access resolution ───────────────────────────────────────────────────────
  /**
   * Resolve a (tenant, pool) request to a physical store, enforcing access.
   * @param write true if the operation mutates the store.
   * Throws PoolError on missing pool / insufficient access.
   */
  resolve(tenant: string, pool: string | undefined, write: boolean): Stratus {
    this.vTenant(tenant);
    const p = pool ?? "self";
    if (p === "self") return this.storeAt(this.selfStorePath(tenant));

    this.vName(p);
    const decl = this.getPool(p);
    if (!decl) throw new PoolError("no_such_pool", `no such pool: ${p} (declare it first)`);
    const access = decl.members[tenant] ?? "none";
    if (access === "none") throw new PoolError("not_a_member", `tenant ${tenant} has no access to pool ${p}`);
    if (write && access !== "readwrite") throw new PoolError("read_only", `tenant ${tenant} has read-only access to pool ${p}`);
    return this.storeAt(this.poolStorePath(p));
  }

  // ─── physical store paths ────────────────────────────────────────────────────
  private selfStorePath(tenant: string) {
    const dir = path.join(this.root, "tenants", tenant, "self");
    return { dir, db: path.join(dir, "stratus.db"), blobs: path.join(dir, "blobs") };
  }
  private poolStorePath(pool: string) {
    const dir = path.join(this.root, "pools", pool);
    return { dir, db: path.join(dir, "stratus.db"), blobs: path.join(dir, "blobs") };
  }

  /** Open (or reuse) the Stratus store at a physical location. */
  private storeAt(loc: { dir: string; db: string; blobs: string }): Stratus {
    const key = loc.db;
    let s = this.stores.get(key);
    if (!s) {
      fs.mkdirSync(loc.dir, { recursive: true });
      s = new Stratus({ dbPath: loc.db, blobDir: loc.blobs, embed: this.embed, dim: this.dim });
      this.stores.set(key, s);
    }
    return s;
  }

  closeAll() { for (const s of this.stores.values()) s.close(); this.stores.clear(); }
}
