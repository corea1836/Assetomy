"use client";

import { useState } from "react";
import { buttonClass } from "@/components/button-styles";
import type { UpgradeSource } from "@/types/billing";
import type { Teaser } from "@/types/dashboard";
import { UpgradeDialog } from "./upgrade-dialog";

export function UpgradeButton({ source, label, variant = "primary", teaser }: {
  source: UpgradeSource;
  label: string;
  variant?: "primary" | "secondary";
  teaser?: Teaser | null;
}): React.JSX.Element {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" onClick={(event) => setOpener(event.currentTarget)} className={buttonClass(variant)}>{label}</button>
      {opener && <UpgradeDialog source={source} teaser={teaser} opener={opener} onClose={() => setOpener(null)} />}
    </>
  );
}
