import { describe, expect, it } from "vitest";

import { cn } from "@/lib/utils";

describe("cn", () => {
  it("joins plain class names", () => {
    expect(cn("px-2", "py-1")).toBe("px-2 py-1");
  });

  it("resolves conflicting tailwind utilities so the last one wins", () => {
    expect(cn("px-2", "px-4")).toBe("px-4");
    expect(cn("text-sm text-red-500", "text-blue-500")).toBe("text-sm text-blue-500");
  });

  it("applies conditional classes and drops falsy values", () => {
    const hidden = false as boolean;
    expect(cn("base", hidden && "hidden", null, undefined, "", "extra")).toBe("base extra");
    expect(cn("base", { active: true, disabled: false })).toBe("base active");
  });

  it("flattens arrays of class values", () => {
    expect(cn(["px-2", ["py-1", "text-sm"]])).toBe("px-2 py-1 text-sm");
  });

  it("returns an empty string when given nothing", () => {
    expect(cn()).toBe("");
  });
});
