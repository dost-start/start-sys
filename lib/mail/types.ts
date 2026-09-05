// ─────────────────────────────────────────────────────────────────────────────
// The outbound-mail boundary (ADR 0010).
//
// Everything that sends email goes through `MailTransport`, the way everything that
// stores a document goes through `DocumentStore` (lib/documents/). The interface has no
// provider vocabulary in it, so swapping Gmail SMTP for Resend (the locked stack's
// vendor, blocked until the org owns a domain — PRD OQ-10) is one env var, not a
// rewrite. Campaign code, templates and the send loop only ever see this file.
//
// PRIVACY: a recipient address is personal data (RA 10173, CBL Art. VIII §6). Nothing
// in this module logs a message body or an address; errors carry a provider code and a
// short message, never the recipient. `MailResult` is the whole of what a caller learns.
// ─────────────────────────────────────────────────────────────────────────────

/** One message to one recipient. Bulk sends are N of these — the queue is rows, not batches. */
export type MailMessage = {
  /** The recipient address. Never logged. */
  to: string;
  subject: string;
  /** Sanitized HTML. The composer renders and sanitizes before this point; the transport trusts it. */
  html: string;
  /** Plain-text alternative. Optional but strongly preferred — spam filters penalise HTML-only mail from gmail.com. */
  text?: string;
  /** Overrides the transport's default reply-to for this message. */
  replyTo?: string;
  /** Opaque tag the caller can use to correlate provider events with a queue row. */
  tag?: string;
};

export type MailResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; reason: MailFailureReason; message: string };

/**
 * Why a send failed, in the caller's terms. `rejected` is the provider refusing the
 * message (bad address, policy); `throttled` is a rate or quota limit — the queue
 * should back off, not retry immediately; `unavailable` is the transport itself being
 * unreachable; `misconfigured` is our fault (missing credentials) and never retriable.
 */
export type MailFailureReason = "rejected" | "throttled" | "unavailable" | "misconfigured";

export interface MailTransport {
  /** For health checks and the delivery report. Never used to branch behaviour. */
  readonly name: string;
  /** Sends one message. Resolves, never throws, for anything short of a programmer error. */
  send(message: MailMessage): Promise<MailResult>;
  /** A cheap liveness check — a connection or a no-op, never a message. */
  ping(): Promise<{ ok: boolean; detail: string }>;
}

/** The transports this build knows about. `MAIL_TRANSPORT` must name one of them. */
export const MAIL_TRANSPORT_NAMES = ["fake", "gmail_smtp"] as const;
export type MailTransportName = (typeof MAIL_TRANSPORT_NAMES)[number];

export function isMailTransportName(value: string): value is MailTransportName {
  return (MAIL_TRANSPORT_NAMES as readonly string[]).includes(value);
}

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** A shape check, not deliverability. Refuses the obviously broken before a provider is bothered. */
export function isPlausibleAddress(value: string): boolean {
  return value.length <= 254 && EMAIL_SHAPE.test(value);
}
