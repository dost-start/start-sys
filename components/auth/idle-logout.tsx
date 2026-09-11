"use client";

// ─────────────────────────────────────────────────────────────────────────────
// The browser half of idle logout (Officer feedback 2026-09-11: auto logout).
// Rendered once by `AppShell`, so it runs on every admin, officer and regional-rep
// screen. Takes no props and reads no session data.
//
// Input writes the shared activity cookie (at most every 15 s). A timer reads it back,
// so activity in another tab counts too. From one minute before the hour a "Still
// there?" dialog counts down; at the hour this browser is signed out.
//
// UX, not enforcement: `middleware.ts` makes the same decision on the next request, so
// a closed tab, a sleeping laptop or disabled JavaScript cannot skip the logout.
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useEffect, useRef, useState } from "react";

import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { signOutIdle } from "@/lib/auth/actions";
import {
  IDLE_LOGOUT_URL,
  IDLE_TIMEOUT_MS,
  idlePhase,
  LAST_ACTIVITY_COOKIE,
  parseLastActivity,
  readCookie,
  serializeLastActivityCookie,
} from "@/lib/auth/idle";

/** Input rewrites the cookie at most this often — which is also what keeps pointermove cheap. */
const WRITE_THROTTLE_MS = 15 * 1000;
/** How often the cookie is re-read while the dialog is closed. */
const CHECK_INTERVAL_MS = 5 * 1000;
/** While the dialog is open: once a second, for the countdown. */
const COUNTDOWN_INTERVAL_MS = 1000;
/** If signing out has not left the page by then, leave it anyway. */
const LEAVE_FALLBACK_MS = 10 * 1000;

const ACTIVITY_EVENTS = [
  "pointerdown",
  "pointermove",
  "keydown",
  "wheel",
  "touchstart",
  "scroll",
] as const;
// Capture, so a scroll inside any element reaches the window listener.
const LISTENER_OPTIONS = { capture: true, passive: true } as const;

function readActivityCookie(): string | undefined {
  return readCookie(document.cookie, LAST_ACTIVITY_COOKIE);
}

function leaveToLogin(): void {
  window.location.assign(IDLE_LOGOUT_URL);
}

export function IdleLogout() {
  const [open, setOpen] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [ending, setEnding] = useState(false);

  // Mirrors of state for the listeners and timers, which must not re-attach on each render.
  const openRef = useRef(false);
  const endingRef = useRef(false);
  /** Set once this tab has seen the cookie; if it then disappears, the session ended elsewhere. */
  const seenCookieRef = useRef(false);
  const lastWriteRef = useRef(0);
  const leaveTimerRef = useRef<number | null>(null);
  const stayButtonRef = useRef<HTMLButtonElement>(null);

  const showDialog = useCallback((show: boolean) => {
    openRef.current = show;
    setOpen(show);
  }, []);

  const writeActivity = useCallback((now: number) => {
    document.cookie = serializeLastActivityCookie(now, window.location.protocol === "https:");
    lastWriteRef.current = now;
    seenCookieRef.current = true;
  }, []);

  const endSession = useCallback(() => {
    if (endingRef.current) return;
    endingRef.current = true;
    setEnding(true);
    showDialog(true);
    // The action's redirect navigates away, unmounting this component and clearing the
    // timer. A response that does not navigate still leaves the screen.
    leaveTimerRef.current = window.setTimeout(leaveToLogin, LEAVE_FALLBACK_MS);
    signOutIdle().catch(() => {
      // The call failed (network). Leave the screen now; middleware still ends a
      // timed-out session on the next protected request.
      leaveToLogin();
    });
  }, [showDialog]);

  const check = useCallback(() => {
    if (endingRef.current) return;
    const now = Date.now();
    const raw = readActivityCookie();

    if (raw === undefined) {
      // Seen before and now gone: the session was ended in another tab or by middleware.
      if (seenCookieRef.current) endSession();
      return;
    }

    const lastActivity = parseLastActivity(raw, now);
    // Unreadable, or ahead of this clock: leave the decision to middleware.
    if (lastActivity === null) return;
    seenCookieRef.current = true;

    const phase = idlePhase(lastActivity, now);
    if (phase === "expired") {
      endSession();
    } else if (phase === "warning") {
      setSecondsLeft(Math.ceil((lastActivity + IDLE_TIMEOUT_MS - now) / 1000));
      if (!openRef.current) showDialog(true);
    } else if (openRef.current) {
      // A newer value, written by activity in another tab.
      showDialog(false);
    }
  }, [endSession, showDialog]);

  const onActivity = useCallback(() => {
    // While the dialog is open only its buttons count: a mouse drifting across the
    // screen is not someone choosing to stay.
    if (openRef.current || endingRef.current) return;
    const now = Date.now();
    if (now - lastWriteRef.current < WRITE_THROTTLE_MS) return;

    // Decide before writing. Back from sleep, the first touch must not silently extend a
    // session that is already in its last minute, or over.
    const raw = readActivityCookie();
    const lastActivity = raw === undefined ? null : parseLastActivity(raw, now);
    const endedElsewhere = raw === undefined && seenCookieRef.current;
    if (endedElsewhere || (lastActivity !== null && idlePhase(lastActivity, now) !== "active")) {
      check();
      return;
    }
    writeActivity(now);
  }, [check, writeActivity]);

  function stayLoggedIn() {
    writeActivity(Date.now());
    showDialog(false);
  }

  useEffect(() => {
    // Middleware set the cookie on the response that rendered this page.
    if (readActivityCookie() !== undefined) seenCookieRef.current = true;

    const onVisible = () => {
      if (document.visibilityState === "visible") check();
    };
    for (const type of ACTIVITY_EVENTS) {
      window.addEventListener(type, onActivity, LISTENER_OPTIONS);
    }
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("pageshow", check);
    return () => {
      for (const type of ACTIVITY_EVENTS) {
        window.removeEventListener(type, onActivity, LISTENER_OPTIONS);
      }
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("pageshow", check);
    };
  }, [check, onActivity]);

  useEffect(() => {
    const id = window.setInterval(check, open ? COUNTDOWN_INTERVAL_MS : CHECK_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [check, open]);

  useEffect(
    () => () => {
      if (leaveTimerRef.current !== null) window.clearTimeout(leaveTimerRef.current);
    },
    [],
  );

  return (
    <AlertDialog open={open}>
      <AlertDialogContent
        // Escape does not dismiss it: only the two buttons decide.
        onEscapeKeyDown={(event) => event.preventDefault()}
        // Focus "Stay logged in". Radix would otherwise look for an AlertDialogCancel.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          stayButtonRef.current?.focus();
        }}
      >
        <AlertDialogHeader>
          <AlertDialogTitle>{ending ? "Logging you out" : "Still there?"}</AlertDialogTitle>
          <AlertDialogDescription>
            {ending
              ? "Taking you to the login page…"
              : `You'll be logged out in ${secondsLeft} ${secondsLeft === 1 ? "second" : "seconds"} because of inactivity.`}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <Button type="button" variant="outline" onClick={endSession} disabled={ending}>
            Log out now
          </Button>
          <Button ref={stayButtonRef} type="button" onClick={stayLoggedIn} disabled={ending}>
            Stay logged in
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
