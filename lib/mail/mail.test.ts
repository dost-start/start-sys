// The transport contract: the fake and the Gmail SMTP transport behave identically at
// the boundary the campaign code sees. nodemailer is exercised through a stubbed
// Transporter, so nothing here opens a socket and no test needs a credential.

import { afterEach, describe, expect, it, vi } from "vitest";

import { failNextFakeSend, fakeMailTransport, fakeSentMail, resetFakeMail } from "./fake-transport";
import {
  classifySmtpError,
  createGmailSmtpTransport,
  readGmailSmtpConfig,
} from "./gmail-smtp-transport";
import { isPlausibleAddress, MAIL_TRANSPORT_NAMES, type MailTransport } from "./types";

const MESSAGE = {
  to: "scholar@example.edu.ph",
  subject: "Membership Application Form",
  html: "<p>Hello {{given_name}}</p>",
  text: "Hello",
};

type SendMailStub = ReturnType<typeof vi.fn>;

function stubbedGmail(sendMail: SendMailStub, verify: SendMailStub = vi.fn(async () => true)) {
  const transporter = { sendMail, verify } as unknown as Parameters<
    typeof createGmailSmtpTransport
  >[1];
  return createGmailSmtpTransport(
    {
      user: "start.community@gmail.com",
      appPassword: "abcd efgh ijkl mnop",
      fromName: "START-DOST CRRD",
      replyTo: null,
    },
    transporter,
  );
}

afterEach(() => {
  resetFakeMail();
});

describe.each<[string, () => MailTransport]>([
  ["fake", () => fakeMailTransport],
  ["gmail_smtp", () => stubbedGmail(vi.fn(async () => ({ messageId: "<abc@gmail.com>" })))],
])("MailTransport contract — %s", (_name, make) => {
  it("sends a well-formed message and reports a provider id (or null)", async () => {
    const result = await make().send(MESSAGE);
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(
        result.providerMessageId === null || typeof result.providerMessageId === "string",
      ).toBe(true);
  });

  it("rejects an implausible address without touching the provider", async () => {
    const result = await make().send({ ...MESSAGE, to: "not-an-address" });
    expect(result).toEqual({
      ok: false,
      reason: "rejected",
      message: "recipient address is not deliverable",
    });
  });

  it("answers a ping without sending", async () => {
    const ping = await make().ping();
    expect(ping.ok).toBe(true);
  });
});

describe("fake transport", () => {
  it("records what it would have sent, in order, with a distinct id each", async () => {
    await fakeMailTransport.send(MESSAGE);
    await fakeMailTransport.send({ ...MESSAGE, to: "second@example.edu.ph" });
    const sent = fakeSentMail();
    expect(sent.map((m) => m.to)).toEqual(["scholar@example.edu.ph", "second@example.edu.ph"]);
    expect(new Set(sent.map((m) => m.providerMessageId)).size).toBe(2);
  });

  it("fails the NEXT send on request, then recovers — the queue's retry path has something to test", async () => {
    failNextFakeSend("throttled");
    const first = await fakeMailTransport.send(MESSAGE);
    const second = await fakeMailTransport.send(MESSAGE);
    expect(first).toMatchObject({ ok: false, reason: "throttled" });
    expect(second.ok).toBe(true);
  });
});

describe("gmail_smtp transport", () => {
  it("sends from the configured display name and account, with the reply-to when set", async () => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- the parameter types the mock so `.mock.calls[0][0]` is inspectable
    const sendMail = vi.fn(async (_opts: Record<string, unknown>) => ({
      messageId: "<x@gmail.com>",
    }));
    const transporter = { sendMail, verify: vi.fn(async () => true) } as unknown as Parameters<
      typeof createGmailSmtpTransport
    >[1];
    const transport = createGmailSmtpTransport(
      {
        user: "start.community@gmail.com",
        appPassword: "x",
        fromName: 'START "CRRD"',
        replyTo: "crrd@example.org",
      },
      transporter,
    );
    await transport.send({ ...MESSAGE, tag: "campaign-1" });
    expect(sendMail).toHaveBeenCalledTimes(1);
    const call = sendMail.mock.calls[0]?.[0] ?? {};
    expect(call.from).toBe('"START CRRD" <start.community@gmail.com>');
    expect(call.to).toBe("scholar@example.edu.ph");
    expect(call.replyTo).toBe("crrd@example.org");
    expect(call.html).toBe(MESSAGE.html);
  });

  it("maps Gmail's error surface to the four reasons and never echoes the recipient", async () => {
    const boom = (error: unknown) =>
      stubbedGmail(
        vi.fn(async () => {
          throw error;
        }),
      );
    const auth = await boom({ code: "EAUTH", responseCode: 535 }).send(MESSAGE);
    const quota = await boom({
      responseCode: 421,
      response: "4.7.0 Daily user sending quota exceeded",
    }).send(MESSAGE);
    const bad = await boom({
      responseCode: 550,
      response: "5.1.1 The email account does not exist",
    }).send(MESSAGE);
    const down = await boom(new Error("ECONNREFUSED")).send(MESSAGE);
    expect(auth).toMatchObject({ ok: false, reason: "misconfigured" });
    expect(quota).toMatchObject({ ok: false, reason: "throttled" });
    expect(bad).toMatchObject({ ok: false, reason: "rejected" });
    expect(down).toMatchObject({ ok: false, reason: "unavailable" });
    for (const r of [auth, quota, bad, down]) {
      if (!r.ok) expect(r.message).not.toContain("scholar@example.edu.ph");
    }
  });

  it("classifies a rate-limit text without a code as throttled", () => {
    expect(classifySmtpError({ message: "Too many login attempts, rate limit" }).reason).toBe(
      "throttled",
    );
  });

  it("reads its five variables and refuses to start without the credential", () => {
    expect(() => readGmailSmtpConfig({ GMAIL_SMTP_USER: "a@gmail.com" })).toThrow(
      /GMAIL_SMTP_APP_PASSWORD/,
    );
    const cfg = readGmailSmtpConfig({
      GMAIL_SMTP_USER: " a@gmail.com ",
      GMAIL_SMTP_APP_PASSWORD: "abcd efgh ijkl mnop",
      MAIL_FROM_NAME: "",
      MAIL_REPLY_TO: "",
    });
    expect(cfg).toEqual({
      user: "a@gmail.com",
      appPassword: "abcdefghijklmnop",
      fromName: "START-DOST",
      replyTo: null,
    });
  });

  it("reports a failed ping as not ok with a reason, not a throw", async () => {
    const transport = stubbedGmail(
      vi.fn(),
      vi.fn(async () => {
        throw { code: "EAUTH", responseCode: 535 };
      }),
    );
    await expect(transport.ping()).resolves.toEqual({
      ok: false,
      detail: "smtp authentication failed",
    });
  });
});

describe("types", () => {
  it("names exactly the two transports this build knows", () => {
    expect([...MAIL_TRANSPORT_NAMES]).toEqual(["fake", "gmail_smtp"]);
  });

  it("isPlausibleAddress is a shape check, not deliverability", () => {
    expect(isPlausibleAddress("a@b.co")).toBe(true);
    expect(isPlausibleAddress("a@b")).toBe(false);
    expect(isPlausibleAddress("")).toBe(false);
    expect(isPlausibleAddress(`${"a".repeat(250)}@b.co`)).toBe(false);
  });
});
