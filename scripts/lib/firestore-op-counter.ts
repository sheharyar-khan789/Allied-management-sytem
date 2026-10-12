/**
 * TEST-ONLY Firestore operation counter. Patches the Admin SDK (@google-cloud/firestore) so every
 * billable document read and write is counted the way Firestore bills them:
 *  - document gets (doc.get, getAll, transaction.get(doc)): 1 read per requested document, found
 *    or missing;
 *  - queries (query.get, transaction.get(query)): 1 read per returned document, minimum 1;
 *  - aggregation queries (count/sum): 1 read per 1000 index entries matched, minimum 1;
 *  - writes (set/create/update/delete, in batches, transactions or doc.set): 1 write each.
 *
 * Imported only by scripts under scripts/ — never by application code.
 */
import { createRequire } from "module";
import path from "path";

const req = createRequire(path.join(process.cwd(), "package.json"));
const firestoreMain = req.resolve("@google-cloud/firestore");
const buildDir = path.dirname(firestoreMain);
// Load the package entry point first: requiring its internal modules before it would leave the
// entry point half-initialised (circular requires) for the app's own imports.
req("@google-cloud/firestore");
// Deep requires by absolute path (the package "exports" map hides these modules).
const { DocumentReader } = req(path.join(buildDir, "document-reader.js"));
const { Query } = req(path.join(buildDir, "reference", "query.js"));
const { AggregateQuery } = req(path.join(buildDir, "reference", "aggregate-query.js"));
const { WriteBatch } = req(path.join(buildDir, "write-batch.js"));

export interface OpCounts {
  reads: number;
  writes: number;
  /** Per-collection breakdown, e.g. { "students": 300 }. */
  readsByCollection: Record<string, number>;
  writesByCollection: Record<string, number>;
}

const counts: OpCounts = { reads: 0, writes: 0, readsByCollection: {}, writesByCollection: {} };
let installed = false;

export type ReadKind = "doc" | "query" | "aggregate";
interface Fault {
  match: (kind: ReadKind, collection: string) => boolean;
  makeError: () => Error;
  /** How many matching reads fail before the fault stops (Infinity = until removed). */
  remaining: number;
  /** Matching reads attempted while the fault was installed (failed or not). */
  calls: number;
}
let fault: Fault | null = null;

/**
 * TEST-ONLY fault injection: matching reads throw `makeError()` (e.g. a gRPC RESOURCE_EXHAUSTED)
 * instead of reaching the emulator. Returns a handle with the call count and a remove().
 */
export function injectFirestoreFault(options: {
  match: (kind: ReadKind, collection: string) => boolean;
  makeError: () => Error;
  times?: number;
}): { readonly calls: number; remove: () => void } {
  const f: Fault = { match: options.match, makeError: options.makeError, remaining: options.times ?? Infinity, calls: 0 };
  fault = f;
  return {
    get calls() {
      return f.calls;
    },
    remove: () => {
      if (fault === f) fault = null;
    },
  };
}

/** A gRPC-shaped Firestore error, as the Admin SDK throws it. */
export function grpcError(code: number, name: string, message: string): Error {
  return Object.assign(new Error(`${code} ${name}: ${message}`), { code, details: message });
}

function maybeFail(kind: ReadKind, collection: string): void {
  const f = fault;
  if (!f || !f.match(kind, collection)) return;
  f.calls++;
  if (f.remaining <= 0) return;
  f.remaining--;
  throw f.makeError();
}

function collectionOfPath(p: string | undefined): string {
  if (!p) return "?";
  const parts = p.split("/").filter(Boolean);
  // documents/<col>/<id>/<sub>/<id> -> last collection segment
  if (parts.length % 2 === 0) return parts[parts.length - 2] || "?";
  return parts[parts.length - 1] || "?";
}

function addRead(collection: string, n: number) {
  counts.reads += n;
  counts.readsByCollection[collection] = (counts.readsByCollection[collection] || 0) + n;
}

function addWrite(collection: string, n = 1) {
  counts.writes += n;
  counts.writesByCollection[collection] = (counts.writesByCollection[collection] || 0) + n;
}

export function installFirestoreOpCounter(): void {
  if (installed) return;
  installed = true;

  const origReaderGet = DocumentReader.prototype._get;
  DocumentReader.prototype._get = async function (this: any, ...args: unknown[]) {
    maybeFail("doc", collectionOfPath(this.allDocuments?.[0]?.path));
    const result = await origReaderGet.apply(this, args);
    for (const ref of this.allDocuments || []) addRead(collectionOfPath(ref.path), 1);
    return result;
  };

  const origQueryGet = Query.prototype._get;
  Query.prototype._get = async function (this: any, ...args: unknown[]) {
    maybeFail("query", this._queryOptions?.collectionId || "?");
    const out = await origQueryGet.apply(this, args);
    const snap = out?.result;
    const size = typeof snap?.size === "number" ? snap.size : 0;
    const col = this._queryOptions?.collectionId || "?";
    addRead(col, Math.max(1, size));
    return out;
  };

  const origAggGet = AggregateQuery.prototype._get;
  AggregateQuery.prototype._get = async function (this: any, ...args: unknown[]) {
    maybeFail("aggregate", this._query?._queryOptions?.collectionId || "?");
    const out = await origAggGet.apply(this, args);
    const data = out?.result?.data?.() || {};
    const matched = typeof data.count === "number" ? data.count : 0;
    const col = this._query?._queryOptions?.collectionId || "?";
    addRead(col, Math.max(1, Math.ceil(matched / 1000)));
    return out;
  };

  for (const method of ["set", "create", "update", "delete"] as const) {
    const orig = WriteBatch.prototype[method];
    WriteBatch.prototype[method] = function (this: any, ref: any, ...rest: unknown[]) {
      addWrite(collectionOfPath(ref?.path));
      return orig.call(this, ref, ...rest);
    };
  }
}

export function resetOpCounts(): void {
  counts.reads = 0;
  counts.writes = 0;
  counts.readsByCollection = {};
  counts.writesByCollection = {};
}

export function snapshotOpCounts(): OpCounts {
  return {
    reads: counts.reads,
    writes: counts.writes,
    readsByCollection: { ...counts.readsByCollection },
    writesByCollection: { ...counts.writesByCollection },
  };
}

/** Runs `fn` and returns the reads/writes it caused. */
export async function measure<T>(fn: () => Promise<T>): Promise<{ result: T; ops: OpCounts }> {
  resetOpCounts();
  const result = await fn();
  return { result, ops: snapshotOpCounts() };
}
