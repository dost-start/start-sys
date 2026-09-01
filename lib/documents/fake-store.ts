// ─────────────────────────────────────────────────────────────────────────────
// The fake document store — `DOCUMENT_STORE=fake`. BUILD_PLAN S3-T9.
//
// Backs the Vitest contract suite and CI's Playwright run. It is NOT a stub: it enforces
// the same allowlist, performs the same magic-byte sniff, and deletes-then-throws on the
// same disagreement as the two real drivers, because a fake that is permissive where the
// real ones are strict is a fake that makes a green suite mean nothing.
//
// ⚠️ WHY THIS TOUCHES THE FILESYSTEM AT ALL:
//   A module-level Map is not enough. In `pnpm test:e2e` the browser PUTs to a Next
//   route handler running in the Next server process, while the spec's assertions run in
//   the Playwright process, and `next build` may fan work across further workers. Those
//   are separate V8 isolates with separate module registries — bytes written to a Map in
//   one are invisible to the others, and the flow would fail in a way that reads exactly
//   like a broken upload. So the filesystem is the source of truth and the Map is a
//   write-through, same-process cache. Location: $FAKE_STORE_DIR, else a fixed directory
//   under os.tmpdir().
//
// ⚠️ AND WHY THAT IS SAFE: this module is unreachable unless DOCUMENT_STORE === 'fake'.
//   `getDocumentStore()` (index.ts) will not load it otherwise, and the PUT route
//   (app/api/fake-upload/[ref]/route.ts) 404s otherwise. It never runs in production.
//
// NOT `import "server-only"`. This module is imported directly by a Vitest suite, where
// the `server-only` package resolves to the throwing export. It is server-only by
// convention and by the env gate, which is what actually keeps it out of a client bundle.
// ─────────────────────────────────────────────────────────────────────────────

import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveVerifiedMime, sniffMime } from "./sniff-mime";
import {
  type AllowedMime,
  type CreateUploadSessionInput,
  type DocumentStore,
  type DocumentStream,
  DocumentRejectedError,
  DocumentUnavailableError,
  type UploadSession,
  type VerifiedUpload,
  MAX_PROOF_BYTES,
  SNIFF_BYTES,
  assertAcceptableUpload,
  extensionForMime,
} from "./types";

/** What `createUploadSession` recorded, plus what was actually PUT. */
type FakeEntry = {
  /** The type the client CLAIMED at session creation. Stands in for provider metadata. */
  declaredMime: string;
  /** The size the client CLAIMED. Never returned by `verifyUpload` — that is the point of the contract test. */
  declaredSize: number;
  /** The type recorded at PUT time, i.e. the request's own `Content-Type`. Still a claim. */
  storedMime: string | null;
  bytes: Uint8Array | null;
};

/**
 * Same-process cache. The filesystem is authoritative; this exists so a single-process
 * test run does no I/O it does not need, and so the store still works if the temp
 * directory is unwritable.
 */
const entries = new Map<string, FakeEntry>();

/** Where bytes and metadata live. Read at call time, never at module load, so a test can set it. */
function storeDir(): string {
  return process.env.FAKE_STORE_DIR ?? join(tmpdir(), "start-sys-fake-document-store");
}

function bytesPath(ref: string): string {
  return join(storeDir(), `${ref}.bin`);
}

function metaPath(ref: string): string {
  return join(storeDir(), `${ref}.meta.json`);
}

/**
 * A storage ref this driver will accept: `<uuid>__<16 hex>.<ext>`.
 *
 * NO SLASHES AND NO DOTS BEYOND THE EXTENSION, for two reasons. It is interpolated into
 * a route path (`/api/fake-upload/[ref]`), so a slash would not round-trip; and it is
 * joined onto a directory path, so this is also the path-traversal guard. The PUT route
 * re-checks it independently — a validator used in one place is a validator someone
 * removes from that place.
 */
const REF_PATTERN = /^[0-9a-f-]{36}__[0-9a-f]{16}\.[a-z0-9]{1,5}$/;

export function isValidFakeRef(ref: string): boolean {
  return REF_PATTERN.test(ref);
}

function assertValidRef(ref: string): void {
  if (!isValidFakeRef(ref)) {
    throw new DocumentUnavailableError("fake store: malformed storage ref");
  }
}

async function ensureDir(): Promise<void> {
  await mkdir(storeDir(), { recursive: true });
}

/** True for the "file is simply not there" family of errors, which several paths treat as normal. */
function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "ENOENT"
  );
}

async function readEntry(ref: string): Promise<FakeEntry | null> {
  assertValidRef(ref);

  try {
    const raw = await readFile(metaPath(ref), "utf8");
    const meta = JSON.parse(raw) as Omit<FakeEntry, "bytes">;
    let bytes: Uint8Array | null = null;
    try {
      const buffer = await readFile(bytesPath(ref));
      bytes = new Uint8Array(buffer);
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }
    const entry: FakeEntry = { ...meta, bytes };
    entries.set(ref, entry);
    return entry;
  } catch (error) {
    if (!isNotFound(error)) {
      // A malformed meta file is a broken fixture, not a missing document. Fall through
      // to the in-process cache rather than masking it as "not found".
      const cached = entries.get(ref);
      if (cached !== undefined) return cached;
      throw error;
    }
    return entries.get(ref) ?? null;
  }
}

async function writeEntry(ref: string, entry: FakeEntry): Promise<void> {
  entries.set(ref, entry);
  try {
    await ensureDir();
    const { bytes, ...meta } = entry;
    await writeFile(metaPath(ref), JSON.stringify(meta), "utf8");
    if (bytes !== null) await writeFile(bytesPath(ref), bytes);
  } catch {
    // Unwritable temp dir: the Map still holds the entry, so a single-process run works.
    // Nothing is logged — `no-console` is an error under lib/** and this path is noise.
  }
}

// ── The test hook ────────────────────────────────────────────────────────────

/**
 * Store bytes against a ref, simulating the browser's direct PUT.
 *
 * Two callers, both legitimate: the Vitest contract suite, which needs to upload without
 * a browser; and `app/api/fake-upload/[ref]/route.ts`, which is the endpoint the browser
 * actually PUTs to in a CI e2e run.
 *
 * `mime` stands in for the provider's stored metadata — pass a type that CONTRADICTS the
 * bytes to exercise the reject-and-delete path (contract.test.ts case 5).
 */
export async function fakeStorePut(ref: string, bytes: Uint8Array, mime: string): Promise<void> {
  assertValidRef(ref);
  const existing = await readEntry(ref);
  await writeEntry(ref, {
    declaredMime: existing?.declaredMime ?? mime,
    declaredSize: existing?.declaredSize ?? bytes.byteLength,
    storedMime: mime,
    bytes,
  });
}

/** Drop every entry. Test isolation only. */
export async function fakeStoreReset(): Promise<void> {
  entries.clear();
  try {
    const names = await readdir(storeDir());
    for (const name of names) {
      try {
        await unlink(join(storeDir(), name));
      } catch (error) {
        if (!isNotFound(error)) throw error;
      }
    }
  } catch (error) {
    if (!isNotFound(error)) throw error;
  }
}

// ── The store ────────────────────────────────────────────────────────────────

export const fakeDocumentStore: DocumentStore = {
  async createUploadSession(input: CreateUploadSessionInput): Promise<UploadSession> {
    // Before anything is written, exactly as the real drivers check before calling out.
    const mime: AllowedMime = assertAcceptableUpload(input);

    const applicationId = /^[0-9a-f-]{36}$/.test(input.applicationId)
      ? input.applicationId
      : randomUUID();
    const ref = `${applicationId}__${randomBytes(8).toString("hex")}.${extensionForMime(mime)}`;

    await writeEntry(ref, {
      declaredMime: mime,
      declaredSize: input.sizeBytes,
      storedMime: null,
      bytes: null,
    });

    // A RELATIVE app URL, not a dead absolute one: in CI the browser really does PUT
    // here, and it cannot PUT to a port nothing is listening on.
    return { uploadUrl: `/api/fake-upload/${ref}`, storageRef: ref };
  },

  async verifyUpload(storageRef: string): Promise<VerifiedUpload> {
    const entry = await readEntry(storageRef);
    if (entry === null || entry.bytes === null) {
      throw new DocumentUnavailableError("fake store: no bytes stored for that ref", 404);
    }

    const sizeBytes = entry.bytes.byteLength;

    if (sizeBytes === 0) {
      await fakeDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError("empty_file");
    }
    if (sizeBytes > MAX_PROOF_BYTES) {
      await fakeDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError("too_large");
    }

    const resolved = resolveVerifiedMime(
      entry.storedMime,
      sniffMime(entry.bytes.subarray(0, SNIFF_BYTES)),
    );
    if (!resolved.ok) {
      // Delete THEN throw — a rejected file must not be left in the store (types.ts).
      await fakeDocumentStore.deleteDocument(storageRef);
      throw new DocumentRejectedError(resolved.reason);
    }

    // The REAL byte count, never `entry.declaredSize`. That distinction is the whole
    // point of the contract test's "verifyUpload returns REAL size not claimed" case.
    return { sizeBytes, mimeType: resolved.mimeType, webViewLink: null };
  },

  async streamDocument(storageRef: string): Promise<DocumentStream> {
    const entry = await readEntry(storageRef);
    if (entry === null || entry.bytes === null) {
      throw new DocumentUnavailableError("fake store: no bytes stored for that ref", 404);
    }

    const bytes = entry.bytes;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    });

    return { stream, contentLength: bytes.byteLength };
  },

  async deleteDocument(storageRef: string): Promise<void> {
    assertValidRef(storageRef);
    entries.delete(storageRef);
    for (const path of [bytesPath(storageRef), metaPath(storageRef)]) {
      try {
        await unlink(path);
      } catch (error) {
        // Idempotent by contract: deleting an absent object succeeds.
        if (!isNotFound(error)) throw error;
      }
    }
  },

  async listOrphans(knownRefs: string[]): Promise<string[]> {
    const known = new Set(knownRefs);
    const found = new Set<string>();

    for (const [ref, entry] of entries) {
      if (entry.bytes !== null) found.add(ref);
    }

    try {
      for (const name of await readdir(storeDir())) {
        if (!name.endsWith(".bin")) continue;
        found.add(name.slice(0, -".bin".length));
      }
    } catch (error) {
      if (!isNotFound(error)) throw error;
    }

    return [...found].filter((ref) => !known.has(ref)).sort();
  },
};
