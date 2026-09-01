// ─────────────────────────────────────────────────────────────────────────────
// The shared DocumentStore contract. BUILD_PLAN S3-T9.
//
// ONE SUITE, PARAMETERISED OVER EVERY AVAILABLE DRIVER. That is the whole design: the
// value of the fallback (ADR 0005) rests on the claim that the drivers behave
// identically, and a claim nothing checks is a claim that is false within a fortnight.
//
// The fake driver always runs. Drive and Supabase Storage are SKIPPED unless their
// environment is present — they make real network calls and would turn every PR red on a
// laptop with no credentials. Running them is a deliberate act:
//
//     DOCUMENT_STORE=drive GOOGLE_SA_CLIENT_EMAIL=... GOOGLE_SA_PRIVATE_KEY=... \
//       GOOGLE_DRIVE_PROOF_FOLDER_ID=... pnpm test lib/documents/contract.test.ts
//
// S3-T23's acceptance requires the Drive driver to be exercised against the real provider
// at least once before Day 3 closes. This file is where that is done; CI runs the fake.
//
// ⚠️ The five cases below are not arbitrary. Each is a place where a driver could look
// correct and be wrong in a way that only shows up with a real applicant's file.
// ─────────────────────────────────────────────────────────────────────────────

import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { fakeDocumentStore, fakeStorePut, fakeStoreReset } from "./fake-store";
import {
  type DocumentStore,
  DocumentRejectedError,
  MAX_PROOF_BYTES,
  type UploadSession,
} from "./types";

// ── Fixtures ─────────────────────────────────────────────────────────────────

/** A byte string whose first bytes are a real signature, padded to `length`. */
function fileOf(head: readonly number[], length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  bytes.set(head, 0);
  for (let i = head.length; i < length; i += 1) bytes[i] = i % 251;
  return bytes;
}

const JPEG = fileOf([0xff, 0xd8, 0xff, 0xe0], 4096);
const PNG = fileOf([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 2048);
const PDF = fileOf([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37], 1024);

type Driver = {
  name: string;
  store: DocumentStore;
  /**
   * Do what the browser does: send the bytes to the minted upload URL.
   *
   * The real drivers genuinely PUT, so running this suite against Drive exercises the
   * resumable session end to end. The fake driver's URL is a relative app route with no
   * server behind it under Vitest, so it uses its own hook — the same code path the PUT
   * route calls.
   */
  put(session: UploadSession, bytes: Uint8Array, mime: string): Promise<void>;
  reset(): Promise<void>;
};

/** The browser's half of the direct-PUT flow, for the drivers that have a real provider. */
async function putToProvider(
  session: UploadSession,
  bytes: Uint8Array,
  mime: string,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const response = await fetch(session.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": mime, ...extraHeaders },
    body: bytes as unknown as BodyInit,
  });
  if (!response.ok) {
    throw new Error(`upload to provider failed with ${response.status}`);
  }
}

const drivers: Driver[] = [
  {
    name: "fake",
    store: fakeDocumentStore,
    put: (session, bytes, mime) => fakeStorePut(session.storageRef, bytes, mime),
    reset: () => fakeStoreReset(),
  },
];

// Drive and Supabase Storage are opt-in, and their absence is announced rather than
// silent — a skipped security test that nobody knows is skipped is worse than no test.
const driveConfigured =
  process.env.DOCUMENT_STORE === "drive" &&
  Boolean(process.env.GOOGLE_SA_CLIENT_EMAIL) &&
  Boolean(process.env.GOOGLE_SA_PRIVATE_KEY) &&
  Boolean(process.env.GOOGLE_DRIVE_PROOF_FOLDER_ID);

const storageConfigured =
  process.env.DOCUMENT_STORE === "supabase_storage" &&
  Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY) &&
  Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL);

describe.skipIf(driveConfigured || storageConfigured)("contract coverage", () => {
  it("announces which drivers this run did NOT exercise", () => {
    // Not a real assertion — a visible marker in the output so nobody reads a green run
    // as "all three drivers pass". Drive must be run by hand once before S3 closes.
    expect(drivers.map((d) => d.name)).toEqual(["fake"]);
  });
});

if (driveConfigured) {
  const { driveDocumentStore } = await import("./drive-store");
  drivers.push({
    name: "drive",
    store: driveDocumentStore,
    put: (session, bytes, mime) => putToProvider(session, bytes, mime),
    // No reset: this writes into a real Shared Drive folder. Each case uses a fresh
    // application id, and the orphan case cleans up after itself. Point this at the
    // STAGING folder — never at the production one.
    reset: async () => {},
  });
}

if (storageConfigured) {
  const { supabaseStorageDocumentStore } = await import("./supabase-storage-store");
  drivers.push({
    name: "supabase_storage",
    store: supabaseStorageDocumentStore,
    // `x-upsert` so a retried case overwrites rather than colliding, matching what the
    // upload widget sends.
    put: (session, bytes, mime) => putToProvider(session, bytes, mime, { "x-upsert": "true" }),
    reset: async () => {},
  });
}

// ── The suite ────────────────────────────────────────────────────────────────

describe.each(drivers)("DocumentStore contract — $name", (driver) => {
  const store = driver.store;

  beforeEach(async () => {
    await driver.reset();
  });

  afterAll(async () => {
    await driver.reset();
  });

  function session(overrides: Partial<Parameters<DocumentStore["createUploadSession"]>[0]> = {}) {
    return {
      applicationId: randomUUID(),
      fileName: "cor.jpg",
      mimeType: "image/jpeg",
      sizeBytes: JPEG.byteLength,
      ...overrides,
    };
  }

  // Case 1 — CLAIMED oversize is refused BEFORE the provider is contacted.
  // An anonymous caller must not be able to spend API quota, or create an object we then
  // have to clean up, by declaring a 4GB file (S3-T10 acceptance).
  it("rejects an oversize file before any upload session exists", async () => {
    await expect(
      store.createUploadSession(session({ sizeBytes: MAX_PROOF_BYTES + 1 })),
    ).rejects.toThrow(DocumentRejectedError);

    await expect(
      store.createUploadSession(session({ sizeBytes: MAX_PROOF_BYTES + 1 })),
    ).rejects.toMatchObject({ reason: "too_large" });
  });

  it("rejects a zero-byte or nonsensical declared size", async () => {
    await expect(store.createUploadSession(session({ sizeBytes: 0 }))).rejects.toMatchObject({
      reason: "empty_file",
    });
    await expect(store.createUploadSession(session({ sizeBytes: -1 }))).rejects.toMatchObject({
      reason: "empty_file",
    });
  });

  // Case 2 — a type outside the allowlist never gets a session at all.
  it("rejects a disallowed MIME type before any upload session exists", async () => {
    for (const mimeType of ["image/gif", "text/html", "application/zip", "", "image/svg+xml"]) {
      await expect(
        store.createUploadSession(session({ mimeType, fileName: "x" })),
      ).rejects.toMatchObject({ reason: "mime_not_allowed" });
    }
  });

  // Case 3 — THE ONE THAT MATTERS MOST. The client declares a size; the client is not
  // believed. `verifyUpload` reports the provider's own byte count. Without this, a
  // 6MB file declared as 2MB would be recorded as 2MB and the size cap would be advisory.
  it("verifyUpload returns the REAL size, not the size the client claimed", async () => {
    const uploaded = await store.createUploadSession(
      session({ sizeBytes: 1024 }), // a lie: the real file is 4096 bytes
    );
    await driver.put(uploaded, JPEG, "image/jpeg");

    const verified = await store.verifyUpload(uploaded.storageRef);

    expect(verified.sizeBytes).toBe(JPEG.byteLength);
    expect(verified.sizeBytes).not.toBe(1024);
    expect(verified.mimeType).toBe("image/jpeg");
  });

  // Case 4 — deleting an object that is already gone is a success. The abandoned-draft
  // sweep (S3-T22) deletes refs that may already have been removed, and it must not fail
  // the whole job over one of them.
  it("deleteDocument is idempotent", async () => {
    const uploaded = await store.createUploadSession(session());
    await driver.put(uploaded, JPEG, "image/jpeg");

    await expect(store.deleteDocument(uploaded.storageRef)).resolves.toBeUndefined();
    await expect(store.deleteDocument(uploaded.storageRef)).resolves.toBeUndefined();
  });

  // Case 5 — the sniff disagreement path, and the fact that a rejected file DOES NOT
  // REMAIN IN THE STORE. A PNG renamed .pdf and declared application/pdf is refused, and
  // the bytes are deleted: it is somebody's file, we have no basis to keep it, and it
  // would become an orphan no purge job ever finds because no row points at it.
  it("rejects bytes that contradict the declared type, and deletes them", async () => {
    const uploaded = await store.createUploadSession(
      session({ mimeType: "application/pdf", fileName: "cor.pdf", sizeBytes: PNG.byteLength }),
    );
    await driver.put(uploaded, PNG, "application/pdf");

    await expect(store.verifyUpload(uploaded.storageRef)).rejects.toMatchObject({
      name: "DocumentRejectedError",
      reason: "mime_mismatch",
    });

    // The object is gone: a second verify no longer finds bytes to reject.
    await expect(store.verifyUpload(uploaded.storageRef)).rejects.toMatchObject({
      name: "DocumentUnavailableError",
    });
    expect(await store.listOrphans([])).not.toContain(uploaded.storageRef);
  });

  it("rejects bytes it cannot identify at all, and deletes them", async () => {
    const uploaded = await store.createUploadSession(
      session({ mimeType: "application/pdf", sizeBytes: 64 }),
    );
    await driver.put(uploaded, new TextEncoder().encode("not a document"), "application/pdf");

    await expect(store.verifyUpload(uploaded.storageRef)).rejects.toMatchObject({
      reason: "unidentifiable",
    });
    expect(await store.listOrphans([])).not.toContain(uploaded.storageRef);
  });

  // A provider type outside the allowlist is not a contradiction — Drive and Storage both
  // fall back to octet-stream for HEIC, and refusing that would reject the majority
  // real-world submission: a photo taken on an iPhone.
  it("accepts a file whose provider metadata is octet-stream but whose bytes are valid", async () => {
    const uploaded = await store.createUploadSession(
      session({ mimeType: "application/pdf", sizeBytes: PDF.byteLength }),
    );
    await driver.put(uploaded, PDF, "application/octet-stream");

    const verified = await store.verifyUpload(uploaded.storageRef);
    expect(verified.mimeType).toBe("application/pdf");
  });

  // Round trip: what went in comes out, and the proxy gets a length it can put on the
  // response.
  it("streamDocument returns the stored bytes", async () => {
    const uploaded = await store.createUploadSession(session());
    await driver.put(uploaded, JPEG, "image/jpeg");

    const { stream, contentLength } = await store.streamDocument(uploaded.storageRef);

    const chunks: Uint8Array[] = [];
    const reader = stream.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value !== undefined) chunks.push(value);
    }
    const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);

    expect(total).toBe(JPEG.byteLength);
    expect(contentLength).toBe(JPEG.byteLength);
  });

  // The orphan case this exists for: the PUT succeeded but finalize never ran, so the
  // bytes exist and no database row points at them. Nothing else would ever find them.
  it("listOrphans returns refs the caller does not know about", async () => {
    const known = await store.createUploadSession(session());
    const orphan = await store.createUploadSession(session());
    await driver.put(known, JPEG, "image/jpeg");
    await driver.put(orphan, PDF, "application/pdf");

    const orphans = await store.listOrphans([known.storageRef]);

    expect(orphans).toContain(orphan.storageRef);
    expect(orphans).not.toContain(known.storageRef);
  });

  it("reports an unknown ref as unavailable rather than inventing an empty document", async () => {
    const uploaded = await store.createUploadSession(session());
    await expect(store.verifyUpload(uploaded.storageRef)).rejects.toMatchObject({
      name: "DocumentUnavailableError",
    });
  });
});
