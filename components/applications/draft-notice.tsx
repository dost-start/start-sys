"use client";

// PR D — the visible half of draft autosave.
//
// Two states, both deliberately quiet: a line saying the form saves as you go, and — when
// a draft was actually restored — a line saying so with the control to clear it. The clear
// control is NOT hidden behind a menu: this feature puts a birthdate and an address in
// localStorage on what may be a shared campus PC, so "get it off this device" has to be
// one obvious click.
//
// Presentational only. The storage rules live in `lib/applications/draft-storage`.
import { Button } from "@/components/ui/button";

export function DraftNotice({ restored, onClear }: { restored: boolean; onClear: () => void }) {
  return (
    <div className="border-border bg-brand-field/60 flex flex-col gap-2 rounded-lg border border-dashed px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-brand-body text-xs leading-relaxed">
        {restored
          ? "We restored what you had already filled in on this device."
          : "Your answers are saved on this device as you type, so you can come back later."}{" "}
        <span className="text-brand-label">
          Your uploaded files are never saved — you will pick those again.
        </span>
      </p>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        onClick={onClear}
        className="shrink-0 self-start sm:self-auto"
      >
        Clear the saved draft
      </Button>
    </div>
  );
}
