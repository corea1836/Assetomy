import { render } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DarkBackdrop } from "./dark-backdrop";

describe("DarkBackdrop", () => {
  it.each(["right", "center"] as const)(
    "renders one dot layer and one %s light behind the band",
    (light) => {
      const { container } = render(<DarkBackdrop light={light} />);
      const backdrop = container.firstElementChild;

      expect(backdrop).toHaveAttribute("aria-hidden", "true");
      expect(backdrop).toHaveClass("pointer-events-none", "absolute", "inset-0", "-z-10");
      expect(backdrop?.children).toHaveLength(2);
      const dots = container.querySelectorAll(".landing-dots");
      const lights = container.querySelectorAll(".landing-light");
      expect(dots).toHaveLength(1);
      expect(lights).toHaveLength(1);
      expect(dots[0]).toHaveClass("absolute", "inset-0");
      expect(lights[0]).toHaveClass("absolute");
      if (light === "right") {
        expect(lights[0]).toHaveClass("inset-y-0", "left-1/2", "right-0");
      } else {
        expect(lights[0]).toHaveClass("inset-0");
      }
      expect(container.querySelector("[style], a, button, [tabindex]")).toBeNull();
    },
  );

  it("renders its decorative layers on the server", () => {
    const markup = renderToStaticMarkup(<DarkBackdrop light="center" />);

    expect(markup).toContain('aria-hidden="true"');
    expect(markup).toContain("landing-dots");
    expect(markup).toContain("landing-light");
  });
});
