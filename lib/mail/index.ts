// ─────────────────────────────────────────────────────────────────────────────
// The single entry point for outbound mail. Mirrors lib/documents/index.ts: the
// transport is chosen by ONE environment variable, an unknown value throws at first
// use, and nothing outside this folder imports nodemailer.
//
// `MAIL_TRANSPORT`:
//   fake        unit tests, Playwright, preview deployments — records, never delivers
//   gmail_smtp  the org's @gmail.com account over SMTP with an App Password (ADR 0010)
//
// Server-only: a client bundle that reached this module would carry the App Password.
// ─────────────────────────────────────────────────────────────────────────────

import "server-only";

import { createGmailSmtpTransport, readGmailSmtpConfig } from "./gmail-smtp-transport";
import { fakeMailTransport } from "./fake-transport";
import {
  isMailTransportName,
  MAIL_TRANSPORT_NAMES,
  type MailTransport,
  type MailTransportName,
} from "./types";

export type {
  MailFailureReason,
  MailMessage,
  MailResult,
  MailTransport,
  MailTransportName,
} from "./types";
export { MAIL_TRANSPORT_NAMES, isPlausibleAddress } from "./types";

export function mailTransportName(): MailTransportName {
  const raw = process.env.MAIL_TRANSPORT;
  if (raw === undefined || raw === "") {
    throw new Error(
      `MAIL_TRANSPORT is not set. Expected one of: ${MAIL_TRANSPORT_NAMES.join(", ")}. ` +
        `See .env.example and docs/decisions/0010-gmail-smtp-mail-transport.md.`,
    );
  }
  if (!isMailTransportName(raw)) {
    throw new Error(
      `MAIL_TRANSPORT="${raw}" is not a known mail transport. ` +
        `Expected one of: ${MAIL_TRANSPORT_NAMES.join(", ")}.`,
    );
  }
  return raw;
}

let gmail: MailTransport | null = null;

export function getMailTransport(): MailTransport {
  switch (mailTransportName()) {
    case "fake":
      return fakeMailTransport;
    case "gmail_smtp":
      // One pooled transporter per process — the credentials are read once and the
      // SMTP connection is reused across a campaign chunk.
      gmail ??= createGmailSmtpTransport(readGmailSmtpConfig(process.env));
      return gmail;
  }
}

/** For /api/health: which transport is live and whether it answers. Never sends. */
export async function pingMailTransport(): Promise<{
  driver: MailTransportName;
  ok: boolean;
  detail: string;
}> {
  const transport = getMailTransport();
  const result = await transport.ping();
  return { driver: mailTransportName(), ...result };
}
