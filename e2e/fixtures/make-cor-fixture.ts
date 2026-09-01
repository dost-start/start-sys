// ═══════════════════════════════════════════════════════════════════════════════════
// e2e/fixtures/make-cor-fixture.ts — proof-of-enrollment files, GENERATED AT RUNTIME.
// BUILD_PLAN S3-T23.
//
// ⚠ THE SIZE IS THE POINT, and it is the whole reason this file exists rather than a
//   committed sample.
//
//   Vercel caps a function request body at 4.5MB. A phone photo of a Certificate of
//   Registration is routinely 6MB. The entire upload design — a server-minted resumable
//   session URI and a DIRECT browser PUT that never passes through a Route Handler
//   (ARCHITECTURE.md §4.1 step 4) — exists to survive that gap. A 200KB fixture would
//   pass EVEN IF the bytes were wrongly routed through a Vercel function, so the test
//   would be green about a system that fails on the first real applicant.
//
//   `DEFAULT_COR_BYTES` is therefore above the cap on purpose. Do not shrink it to make
//   a run faster; shrinking it deletes the assertion.
//
// WHY GENERATED AND NOT COMMITTED:
//   1. A 6MB binary in git is 6MB in every clone, forever, and the repo is handed to
//      student officers on student laptops.
//   2. `git diff` cannot review it, so nobody would ever notice it being swapped.
//   3. The oversize case needs 12MB, which is worse on both counts.
//   4. A generated file can assert its own byte count, which is what the happy-path spec
//      compares against `applications.proof_size_bytes` to prove the provider's OWN
//      metadata — not the client's claim — reached the database (S3-T16).
//
// WHAT THESE FILES ARE NOT: decodable images. They carry a byte-exact JFIF header and
//   an EOI marker with filler in between. That is sufficient and correct for what is
//   under test — every gate in the system inspects the FIRST BYTES, never the pixels:
//   `sniffMime()` reads 512 bytes (lib/documents/sniff-mime.ts), and both real drivers
//   cross-check those against provider metadata. Producing a genuinely encoded 6MB JPEG
//   would need an image library, which is a runtime dependency added for decoration.
//
// NOTHING HERE IS PII. The bytes are deterministic filler; no real scholar's document is
//   ever committed, generated, or copied into a fixture directory.
// ═══════════════════════════════════════════════════════════════════════════════════

import { createHash } from "node:crypto";
import { mkdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// ─────────────────────────────────────────────────────────────────────────────
// Sizes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * ~6.5MB — comfortably above Vercel's 4.5MB body cap and comfortably below the
 * 10MB `MAX_PROOF_BYTES` limit, so the happy path proves the direct PUT works
 * without straying into the oversize case's territory.
 */
export const DEFAULT_COR_BYTES = 6_815_744; // 6.5 * 1024 * 1024

/**
 * 12MB — above `MAX_PROOF_BYTES` (10MB), so the form must refuse it CLIENT-SIDE, before
 * a database row, a submit token or an upload session exists. The spec asserts zero rows
 * for that applicant afterwards, which is what makes "refused before anything happened"
 * a fact rather than a hope.
 */
export const OVERSIZE_COR_BYTES = 12 * 1024 * 1024;

// ─────────────────────────────────────────────────────────────────────────────
// Where the files live
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Under `os.tmpdir()` and NOT under the repository, so a generated 12MB file can never
 * be staged by an absent-minded `git add -A`. Overridable for a CI runner that wants
 * them on a specific volume.
 */
export const COR_FIXTURE_DIR = resolve(
  process.env.E2E_COR_FIXTURE_DIR ?? join(tmpdir(), "start-sys-e2e-cor"),
);

// ─────────────────────────────────────────────────────────────────────────────
// The bytes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A byte-exact JFIF header: SOI (`FF D8 FF`) followed by an APP0 `JFIF\0` segment.
 *
 * `FF D8 FF` is precisely the three-byte signature `sniffMime()` matches for
 * `image/jpeg`, so a file starting with this is identified as a JPEG by our own sniffer,
 * by Google Drive and by Supabase Storage alike.
 */
const JFIF_HEADER = Uint8Array.from([
  0xff,
  0xd8,
  0xff,
  0xe0, // SOI + APP0 marker
  0x00,
  0x10, // APP0 segment length (16)
  0x4a,
  0x46,
  0x49,
  0x46,
  0x00, // "JFIF\0"
  0x01,
  0x01, // version 1.01
  0x00, // density units: none
  0x00,
  0x01,
  0x00,
  0x01, // x/y density
  0x00,
  0x00, // no thumbnail
]);

/** EOI. Present so the file both begins and ends the way a JPEG does. */
const JPEG_EOI = Uint8Array.from([0xff, 0xd9]);

/**
 * Deterministic filler.
 *
 * Deliberately NOT `crypto.randomBytes`: 12MB of CSPRNG output on every worker of every
 * project is real wall-clock time in a seven-day sprint, and randomness buys nothing —
 * no gate under test reads past byte 512. A cheap counter-based sequence gives bytes
 * that are non-uniform (so nothing accidentally depends on a run of zeroes) and
 * identical on every run (so a failure reproduces).
 *
 * `0xff` is never emitted, so the filler cannot accidentally spell a JPEG marker that
 * confuses a provider's own parser.
 */
function fillerBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  let x = 0x9e_37_79_b9; // golden-ratio odd constant; any odd 32-bit seed works
  for (let i = 0; i < length; i += 1) {
    x = (Math.imul(x, 1_664_525) + 1_013_904_223) >>> 0;
    out[i] = (x >>> 16) & 0xfe; // never 0xff — see above
  }
  return out;
}

/** Header + filler + EOI, sized so the TOTAL is exactly `totalBytes`. */
function jpegOfExactSize(totalBytes: number): Uint8Array {
  const overhead = JFIF_HEADER.length + JPEG_EOI.length;
  if (totalBytes <= overhead) {
    throw new Error(`A JPEG fixture must be larger than ${overhead} bytes.`);
  }
  const out = new Uint8Array(totalBytes);
  out.set(JFIF_HEADER, 0);
  out.set(fillerBytes(totalBytes - overhead), JFIF_HEADER.length);
  out.set(JPEG_EOI, totalBytes - JPEG_EOI.length);
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────
// The public shape
// ─────────────────────────────────────────────────────────────────────────────

export type GeneratedProofFile = {
  /** Absolute path, for `page.setInputFiles(path)`. */
  readonly path: string;
  /** The name the browser will report. Chosen so the browser infers the MIME we want. */
  readonly fileName: string;
  /**
   * The file's REAL byte count, read back from the filesystem after writing.
   *
   * Read back rather than assumed: this number is the happy path's load-bearing
   * assertion (`proof_size_bytes` must equal it), so it must be an observation, not the
   * argument we passed in.
   */
  readonly byteLength: number;
  /** What the browser is expected to declare for this file, given its extension. */
  readonly expectedMimeType: string;
  /** sha256 of the written bytes. Diagnostic only — makes a truncated write obvious. */
  readonly sha256: string;
};

async function writeFixture(
  fileName: string,
  bytes: Uint8Array,
  expectedMimeType: string,
): Promise<GeneratedProofFile> {
  await mkdir(COR_FIXTURE_DIR, { recursive: true });
  const path = join(COR_FIXTURE_DIR, fileName);

  await writeFile(path, bytes);

  // Read the size back off the filesystem. A short write on a full CI volume would
  // otherwise surface as a confusing size mismatch in the database assertion instead of
  // as a clear failure here.
  const { size } = await stat(path);
  if (size !== bytes.byteLength) {
    throw new Error(`Short write for ${path}: wrote ${bytes.byteLength}, file is ${size}.`);
  }

  return {
    path,
    fileName,
    byteLength: size,
    expectedMimeType,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
}

/** A unique-per-call name, so parallel Playwright projects never write the same path. */
function uniqueName(prefix: string, extension: string): string {
  const token = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  return `${prefix}-${token}.${extension}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// The three fixtures the spec needs
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The realistic case: a ~6.5MB phone photo of a Certificate of Registration.
 *
 * This is the file that proves the direct browser PUT bypasses Vercel's 4.5MB cap. If it
 * uploads and `applications.proof_size_bytes` equals `byteLength`, the bytes went to the
 * document store and the server re-read the provider's own metadata (S3-T16).
 */
export async function makeCorPhoto(
  totalBytes: number = DEFAULT_COR_BYTES,
): Promise<GeneratedProofFile> {
  return writeFixture(uniqueName("cor-photo", "jpg"), jpegOfExactSize(totalBytes), "image/jpeg");
}

/**
 * 12MB — over the 10MB cap.
 *
 * Must be refused by the form itself. `startApplication` also refuses it server-side and
 * so does `createUploadSession`, but the assertion here is the outermost one: no row, no
 * token, no session, no provider call.
 */
export async function makeOversizeCor(): Promise<GeneratedProofFile> {
  return writeFixture(
    uniqueName("cor-oversize", "jpg"),
    jpegOfExactSize(OVERSIZE_COR_BYTES),
    "image/jpeg",
  );
}

/**
 * A TEXT FILE WEARING A `.pdf` EXTENSION — the lie the whole verify step exists to catch.
 *
 * The browser will happily declare `application/pdf` for this, because a browser types a
 * file by its extension. Every client-side check therefore passes, the draft row is
 * created, and the bytes really are uploaded. Only `verifyUpload()`'s magic-byte sniff
 * disagrees — the bytes do not begin `%PDF-` — at which point the store DELETES the
 * object and throws, `finalizeApplication` maps it to `validation`, and the row stays
 * `draft`.
 *
 * That sequence is the one that proves the server does not believe the client, so the
 * spec asserts the end state precisely: exactly one row, status `draft`, no `pending`.
 *
 * Small on purpose: nothing about this case depends on size.
 */
export async function makeDisguisedTextAsPdf(): Promise<GeneratedProofFile> {
  const text =
    "This is not a PDF. It is a text file named .pdf, so the browser declares " +
    "application/pdf and every client-side gate passes. The magic-byte sniff in " +
    "lib/documents/sniff-mime.ts is the gate that refuses it.\n";
  return writeFixture(
    uniqueName("cor-disguised", "pdf"),
    new TextEncoder().encode(text.repeat(64)),
    "application/pdf",
  );
}

/**
 * Remove the whole generated-fixture directory.
 *
 * Called from an `afterAll`. Best-effort by design: a leftover file in `os.tmpdir()` is
 * harmless (it contains no personal data — see the header), and failing a spec run over
 * a cleanup error would turn a passing security test red for no reason.
 */
export async function cleanupCorFixtures(): Promise<void> {
  await rm(COR_FIXTURE_DIR, { recursive: true, force: true }).catch(() => undefined);
}
