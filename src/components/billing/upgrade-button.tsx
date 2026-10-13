"use client";

import { useState } from "react";
import { buttonClass } from "@/components/button-styles";
import type { UpgradeSource } from "@/types/billing";
import type { Teaser } from "@/types/dashboard";
import { UpgradeDialog } from "./upgrade-dialog";

export function UpgradeButton({ source, label, variant = "primary", teaser }: {
  source: UpgradeSource;
  label: string;
  variant?: "primary" | "secondary" | "text";
  teaser?: Teaser | null;
}): React.JSX.Element {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  const className = variant === "text"
    ? "rounded-lg font-semibold text-primary hover:underline active:text-primary-active focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
    : buttonClass(variant);
  return (
    <>
      <button type="button" onClick={(event) => setOpener(event.currentTarget)} className={className}>{label}</button>
      {opener && <UpgradeDialog source={source} teaser={teaser} opener={opener} onClose={() => setOpener(null)} />}
    </>
  );
}
