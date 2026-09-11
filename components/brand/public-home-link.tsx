// "← Back to home" for the public pages — /apply, /renew and /privacy (Officer feedback
// 2026-09-11: none of them linked back to the splash page at `/`, which middleware lets
// an anonymous visitor reach). A server component: plain markup, no state, no data.
import Link from "next/link";

import { cn } from "@/lib/utils";

export function PublicHomeLink({ className }: { className?: string }) {
  return (
    <Link
      href="/"
      className={cn(
        "text-brand-link inline-flex items-center gap-1.5 self-start text-sm font-medium underline-offset-4 hover:underline",
        className,
      )}
    >
      <span aria-hidden="true">←</span>
      Back to home
    </Link>
  );
}
