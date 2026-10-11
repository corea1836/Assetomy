import { describe, expect, it } from "vitest";
import { buttonClass } from "./button-styles";

const classes = (value: string) => value.split(" ");

describe("buttonClass", () => {
  it("builds the shared pill with focus ring and press feedback", () => {
    expect(classes(buttonClass("primary"))).toEqual(expect.arrayContaining([
      "inline-flex", "items-center", "justify-center", "gap-2", "rounded-full", "font-semibold",
      "duration-120", "ease-standard", "active:scale-[.98]",
      "focus-visible:outline-2", "focus-visible:outline-offset-2", "focus-visible:outline-primary",
      "disabled:cursor-not-allowed", "disabled:active:scale-100",
    ]));
  });

  it.each([
    ["primary", ["bg-primary", "text-white", "active:bg-primary-active", "disabled:bg-primary-disabled"]],
    ["secondary", ["bg-surface-strong", "text-ink", "active:bg-hairline", "disabled:text-muted-soft"]],
  ] as const)("applies the %s colors", (variant, expected) => {
    expect(classes(buttonClass(variant))).toEqual(expect.arrayContaining([...expected]));
  });

  it("uses the 44px size by default and the small size on request", () => {
    expect(classes(buttonClass("primary"))).toEqual(
      expect.arrayContaining(["h-11", "px-5", "text-base"]),
    );
    const small = classes(buttonClass("primary", "sm"));
    expect(small).toEqual(expect.arrayContaining(["h-9", "px-4", "text-sm"]));
    expect(small).not.toContain("h-11");
  });
});
