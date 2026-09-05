// ─────────────────────────────────────────────────────────────────────────────
// The in-memory transport for unit tests, Playwright and `MAIL_TRANSPORT=fake`
// deployments (previews). Records every message so a test can assert on what would
// have been sent, and can be told to fail so the queue's error paths are exercised.
//
// Never delivers anything. Never logs anything.
// ─────────────────────────────────────────────────────────────────────────────

import {
  isPlausibleAddress,
  type MailFailureReason,
  type MailMessage,
  type MailResult,
  type MailTransport,
} from "./types";

export type FakeSentMessage = MailMessage & { providerMessageId: string; sentAt: string };

type Failure = { reason: MailFailureReason; message: string };

/** Per-process record of what the fake "sent". Reset between tests with `resetFakeMail()`. */
const sent: FakeSentMessage[] = [];
let nextFailure: Failure | null = null;
let counter = 0;

/** Make the NEXT `send` fail with this reason, then clear. For queue error-path tests. */
export function failNextFakeSend(reason: MailFailureReason, message = `fake ${reason}`): void {
  nextFailure = { reason, message };
}

export function fakeSentMail(): readonly FakeSentMessage[] {
  return sent;
}

export function resetFakeMail(): void {
  sent.length = 0;
  nextFailure = null;
  counter = 0;
}

export const fakeMailTransport: MailTransport = {
  name: "fake",

  async send(message: MailMessage): Promise<MailResult> {
    if (nextFailure !== null) {
      const failure = nextFailure;
      nextFailure = null;
      return { ok: false, reason: failure.reason, message: failure.message };
    }
    if (!isPlausibleAddress(message.to)) {
      return { ok: false, reason: "rejected", message: "recipient address is not deliverable" };
    }
    counter += 1;
    const providerMessageId = `fake-${counter}`;
    sent.push({ ...message, providerMessageId, sentAt: new Date().toISOString() });
    return { ok: true, providerMessageId };
  },

  async ping() {
    return { ok: true, detail: "fake transport: nothing is delivered" };
  },
};
