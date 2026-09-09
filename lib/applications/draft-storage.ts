// ─────────────────────────────────────────────────────────────────────────────
// PR D — DRAFT AUTOSAVE FOR THE TWO PUBLIC FORMS.
//
// WHY: `/apply` is four steps of typing plus two document uploads, filled on a phone on
// Philippine mobile data. A reload, a backgrounded browser that gets evicted, or an
// accidental Back loses the lot, and the applicant starts over — which is also how the
// system accumulates abandoned draft rows full of PII (PR F).
//
// WHERE: localStorage, per Ethan's call (2026-09-09). Deliberately NOT a server-side
// draft: a server draft would need a row for someone who has not consented yet, an
// identifier to look it up by (an email — which is an enumeration surface the anon
// policies spend their whole design removing), and its own retention rule.
//
// ⚠ WHAT IS DELIBERATELY NOT SAVED, and each is a decision rather than a limitation:
//
//   · THE TWO DOCUMENTS. A `File` is a handle to bytes the page does not own and cannot
//     be serialized; storing the bytes themselves would put a scholar's Certificate of
//     Registration — their name, student number and address — in localStorage on what may
//     be a shared campus PC. The applicant re-picks the files. That is the right trade.
//
//   · THE CONSENT BOXES. RA 10173 requires consent to be a freely given AFFIRMATIVE act at
//     collection. Restoring a ticked box IS pre-ticking it, which the form is explicitly
//     built not to do (`consent-section.tsx`), so both consent keys and the accuracy
//     certification are stripped on write and can never be restored.
//
//   · THE MEMBER ID on `/renew`, for the same reason the renewal form never echoes it: the
//     member ID plus the email on file IS the credential that authorizes a renewal
//     (0044). Leaving it on a shared machine hands the next person a scholar's identity.
//
// ⚠ THIS PUTS PII ON THE VIEWER'S DEVICE. A birthdate, an address and a contact number
// sit in localStorage until the applicant submits, clicks "Clear the saved draft", or the
// expiry passes. That is disclosed in the privacy notice (`docs/privacy/PRIVACY_NOTICE.md`
// and `/privacy`) rather than left implicit, and the clear control is rendered where the
// applicant can find it, not buried.
//
// Everything here is defensive: localStorage throws in a private window, in a browser set
// to block site data, and inside a thumbnail/preview context. Every read and write is
// wrapped, and a failure means "no draft", never a broken form.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bump when the saved shape changes in a way an old draft cannot satisfy.
 *
 * A version mismatch DISCARDS rather than migrates: a half-restored form whose fields no
 * longer match the schema produces validation errors on fields the applicant never
 * touched, which is worse than an empty form.
 */
const DRAFT_VERSION = 1;

/** After this, a saved draft is treated as absent and removed on the next read. */
export const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type DraftFormKind = "apply" | "renew";

const KEY_PREFIX = "start-sys:draft";

export function draftKey(kind: DraftFormKind): string {
  return `${KEY_PREFIX}:${kind}:v${DRAFT_VERSION}`;
}

/**
 * Keys that are NEVER written to disk. See the header — each of these is a considered
 * exclusion, not a field somebody forgot.
 */
const NEVER_SAVED = new Set([
  "consent_privacy_notice",
  "consent_privacy_notice_version",
  "certify_accuracy",
  "member_id",
]);

type StoredDraft = { savedAt: number; values: Record<string, unknown> };

/** `window.localStorage`, or null wherever it is unavailable or throws on access. */
function storage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Strip the never-saved keys and drop empties, so a blank draft is not "a draft". */
function scrub(values: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (NEVER_SAVED.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    if (typeof value === "object") continue; // a File, a FileList — never serialized
    out[key] = value;
  }
  return out;
}

/** Save, or do nothing at all. Never throws, never reports. */
export function saveDraft(kind: DraftFormKind, values: Record<string, unknown>): void {
  const store = storage();
  if (store === null) return;
  const scrubbed = scrub(values);
  try {
    if (Object.keys(scrubbed).length === 0) {
      store.removeItem(draftKey(kind));
      return;
    }
    const payload: StoredDraft = { savedAt: Date.now(), values: scrubbed };
    store.setItem(draftKey(kind), JSON.stringify(payload));
  } catch {
    // Quota exceeded, or site data blocked. A draft that cannot be saved is not an error
    // the applicant needs to see — the form works either way.
  }
}

/**
 * The saved draft, or null.
 *
 * An expired, malformed or unreadable entry is REMOVED on the way out, so a bad value
 * cannot make every subsequent load pay to parse it again.
 */
export function loadDraft(kind: DraftFormKind): Record<string, unknown> | null {
  const store = storage();
  if (store === null) return null;
  const key = draftKey(kind);
  try {
    const raw = store.getItem(key);
    if (raw === null) return null;

    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) {
      store.removeItem(key);
      return null;
    }
    const draft = parsed as Partial<StoredDraft>;
    if (typeof draft.savedAt !== "number" || Date.now() - draft.savedAt > DRAFT_MAX_AGE_MS) {
      store.removeItem(key);
      return null;
    }
    if (typeof draft.values !== "object" || draft.values === null) {
      store.removeItem(key);
      return null;
    }
    const values = scrub(draft.values as Record<string, unknown>);
    return Object.keys(values).length === 0 ? null : values;
  } catch {
    try {
      store.removeItem(key);
    } catch {
      /* nothing further to try */
    }
    return null;
  }
}

/** Remove the draft. Called on a successful submit, and by the clear control. */
export function clearDraft(kind: DraftFormKind): void {
  const store = storage();
  if (store === null) return;
  try {
    store.removeItem(draftKey(kind));
    // Older versions of this key are removed too, so bumping DRAFT_VERSION does not leave
    // a scholar's birthdate sitting under a key nothing reads any more.
    for (let version = 1; version < DRAFT_VERSION; version += 1) {
      store.removeItem(`${KEY_PREFIX}:${kind}:v${version}`);
    }
  } catch {
    /* nothing to clear if the store is unreachable */
  }
}

/** Whether a restorable draft exists right now, without restoring it. */
export function hasDraft(kind: DraftFormKind): boolean {
  return loadDraft(kind) !== null;
}
