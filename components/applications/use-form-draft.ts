"use client";

// PR D — the react-hook-form half of draft autosave. The storage rules, and every
// decision about what is deliberately NOT saved, live in `lib/applications/draft-storage`.
//
// Two effects and nothing else:
//   1. restore once on mount, BEFORE the applicant starts typing;
//   2. save on every change, debounced, so a long form is not writing to disk per keystroke.
//
// Restoring uses `form.reset()` rather than a loop of `setValue()`: reset applies the whole
// object in one render and leaves the form UNDIRTIED, which matters because "dirty" is what
// tells the rest of the app the applicant has touched something.
//
// Only keys the form ALREADY declares are restored. A stale draft from an older build can
// therefore never inject a field the current schema does not have — `.strict()` would refuse
// the submission and the applicant would see an error on a field they cannot see.

import { useEffect, useRef, useState } from "react";
import type { FieldValues, UseFormReturn } from "react-hook-form";

import {
  clearDraft,
  loadDraft,
  saveDraft,
  type DraftFormKind,
} from "@/lib/applications/draft-storage";

/** Long enough that typing a sentence is one write; short enough to survive a fast reload. */
const SAVE_DEBOUNCE_MS = 600;

export type FormDraft = {
  /** True when a saved draft was found and applied on mount. Drives the notice. */
  restored: boolean;
  /** Remove the draft and stop advertising it. Bound to the "clear" control. */
  clear: () => void;
};

export function useFormDraft<TIn extends FieldValues, TOut extends FieldValues>(
  kind: DraftFormKind,
  form: UseFormReturn<TIn, unknown, TOut>,
): FormDraft {
  const [restored, setRestored] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Written by the clear control; read by the debounced save so a clear cannot be undone
  // half a second later by an in-flight timer.
  const suspendedRef = useRef(false);

  useEffect(() => {
    const draft = loadDraft(kind);
    if (draft === null) return;

    const current = form.getValues();
    const merged: Record<string, unknown> = { ...current };
    let applied = 0;
    for (const [key, value] of Object.entries(draft)) {
      if (!(key in current)) continue; // an older build's field; ignore rather than inject
      merged[key] = value;
      applied += 1;
    }
    if (applied === 0) return;

    form.reset(merged as unknown as TIn, { keepDefaultValues: true });
    setRestored(true);
    // MOUNT ONLY, and the empty dependency list is the point: re-running this after the
    // applicant has started typing would overwrite their input with the saved copy. `form`
    // and `kind` are both stable for the life of the component, so nothing here goes
    // stale. (No `exhaustive-deps` disable comment — this repo's eslint config does not
    // enable the React Hooks plugin, and a disable for a rule that is not configured is
    // itself an error.)
  }, []);

  useEffect(() => {
    const subscription = form.watch((values) => {
      if (suspendedRef.current) return;
      if (timerRef.current !== null) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        saveDraft(kind, values as Record<string, unknown>);
      }, SAVE_DEBOUNCE_MS);
    });
    return () => {
      subscription.unsubscribe();
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    };
  }, [form, kind]);

  function clear() {
    suspendedRef.current = true;
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    clearDraft(kind);
    setRestored(false);
    // Typing again should start saving again — the control clears what is stored, it does
    // not turn the feature off for the rest of the session.
    setTimeout(() => {
      suspendedRef.current = false;
    }, SAVE_DEBOUNCE_MS + 100);
  }

  return { restored, clear };
}
