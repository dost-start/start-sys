// ─────────────────────────────────────────────────────────────────────────────
// Queue and send a campaign, and watch it go (PRD US-G4: "a 600-recipient send completes
// without manual intervention and shows progress while running").
//
// Two steps, deliberately separate:
//   1. "Freeze the recipient list" — `sendCampaign` → `send_campaign()`: the audience is
//      resolved ONCE and written as recipient rows. Idempotent; a double click adds nothing.
//   2. "Send" — `drainCampaign` in a loop, one chunk per Server Action call, until nothing
//      is queued or the transport says stop (throttled / misconfigured). A chunk that dies
//      leaves leased rows that the next click re-claims after ten minutes; nothing is sent
//      twice because every row's status is checked in the database, not here.
//
// ⚠ NOTHING HERE IS AN ENFORCEMENT. Both actions open with withRole([...]) and the three
// definer functions refuse anyone outside crrd_admin / exec_admin independently.
// ─────────────────────────────────────────────────────────────────────────────
"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import type { Enums } from "@/database.types";
import { drainCampaign, sendCampaign } from "@/lib/campaigns/actions";

export type CampaignSendPanelProps = {
  campaignId: string;
  status: Enums<"campaign_status">;
  recipientCount: number;
  sentCount: number;
  failedCount: number;
  /** The configured transport, so the officer knows whether real mail leaves. */
  transportName: string;
};

type Progress = { sent: number; failed: number; remaining: number };

export function CampaignSendPanel({
  campaignId,
  status,
  recipientCount,
  sentCount,
  failedCount,
  transportName,
}: CampaignSendPanelProps) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [progress, setProgress] = useState<Progress>({
    sent: sentCount,
    failed: failedCount,
    remaining: Math.max(recipientCount - sentCount - failedCount, 0),
  });
  const [pending, startTransition] = useTransition();
  const stopRequested = useRef(false);

  const freeze = () => {
    setMessage(null);
    startTransition(async () => {
      const result = await sendCampaign({ id: campaignId });
      if (!result.ok) {
        setMessage(result.error.message);
        return;
      }
      setProgress({ sent: 0, failed: 0, remaining: result.data.queued });
      setMessage(
        result.data.queued === 0
          ? "No one matches this audience right now, so nothing was queued."
          : `${result.data.queued} recipient${result.data.queued === 1 ? "" : "s"} queued. Nothing has been sent yet.`,
      );
      router.refresh();
    });
  };

  const drain = () => {
    setMessage(null);
    stopRequested.current = false;
    startTransition(async () => {
      let sent = progress.sent;
      let failed = progress.failed;
      for (;;) {
        if (stopRequested.current) {
          setMessage("Stopped. Click Send again to continue where it left off.");
          break;
        }
        const result = await drainCampaign({ id: campaignId });
        if (!result.ok) {
          setMessage(result.error.message);
          break;
        }
        sent += result.data.sent;
        failed += result.data.failed;
        setProgress({ sent, failed, remaining: result.data.remaining });
        if (result.data.halted === "throttled") {
          setMessage(
            "The mail account's sending limit was reached. What is left stays queued — click Send again later (Gmail resets daily) and it resumes without re-sending anyone.",
          );
          break;
        }
        if (result.data.halted === "misconfigured") {
          setMessage(
            "The mail transport is not configured. Nothing was sent; the Technical Admin sets the mail credentials in the environment (runbook 03).",
          );
          break;
        }
        if (result.data.remaining === 0) {
          setMessage(
            failed === 0
              ? `Done — ${sent} sent.`
              : `Done — ${sent} sent, ${failed} failed. The report below names each failure.`,
          );
          break;
        }
      }
      router.refresh();
    });
  };

  const total = progress.sent + progress.failed + progress.remaining;
  const done = total === 0 ? 0 : Math.round(((progress.sent + progress.failed) / total) * 100);

  return (
    <div className="space-y-4">
      {status === "draft" ? (
        <>
          <p className="text-sm">
            This is a draft. Freezing the recipient list resolves the audience once and writes it
            down; the send is a second step.
          </p>
          <Button type="button" onClick={freeze} disabled={pending} data-testid="freeze-recipients">
            Freeze the recipient list
          </Button>
        </>
      ) : null}

      {status === "queued" || status === "sending" ? (
        <>
          <div className="space-y-1">
            <div
              className="bg-muted h-2 w-full overflow-hidden rounded"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={done}
            >
              <div className="bg-primary h-full transition-[width]" style={{ width: `${done}%` }} />
            </div>
            <p className="text-muted-foreground text-xs" data-testid="send-progress">
              {progress.sent} sent · {progress.failed} failed · {progress.remaining} to go
            </p>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button type="button" onClick={drain} disabled={pending} data-testid="send-campaign">
              {pending ? "Sending…" : status === "sending" ? "Resume sending" : "Send now"}
            </Button>
            {pending ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  stopRequested.current = true;
                }}
              >
                Stop after this chunk
              </Button>
            ) : null}
          </div>
          <p className="text-muted-foreground text-xs">
            Sends through <code>{transportName}</code>, 25 messages per step, and keeps going until
            the queue is empty. Leave this page open; if it is closed mid-way, Send again later
            resumes without re-sending anyone.
          </p>
        </>
      ) : null}

      {status === "sent" || status === "failed" ? (
        <p className="text-sm" data-testid="send-summary">
          {status === "sent" ? "Sent" : "Failed"} — {sentCount} delivered to the mail server,{" "}
          {failedCount} failed, of {recipientCount}.
        </p>
      ) : null}

      {message === null ? null : (
        <p role="alert" className="text-sm" data-testid="send-message">
          {message}
        </p>
      )}
    </div>
  );
}
