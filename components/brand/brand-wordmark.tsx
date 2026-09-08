// The "START-SYS" wordmark: real text in Poppins 800 with the yellow→blue gradient and
// ink outline from the Figma frames (`text-brand-gradient` in globals.css). Renders a
// <span>; wrap it in an <h1> where the page's heading is the wordmark (landing, login —
// e2e/smoke.spec.ts pins `heading "START-SYS"`).
import { ORG_SYSTEM_NAME } from "@/lib/brand/org";
import { cn } from "@/lib/utils";

export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "text-brand-gradient inline-block leading-none font-extrabold tracking-tight",
        className,
      )}
    >
      {ORG_SYSTEM_NAME}
    </span>
  );
}
