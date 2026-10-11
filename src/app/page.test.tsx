import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import Page from "@/app/page";

it("renders the placeholder with the src alias and DOM matchers", () => {
  render(<Page />);

  expect(screen.getByText("assetomy")).toBeInTheDocument();
});
