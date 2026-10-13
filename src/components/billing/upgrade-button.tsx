"use client";

import { useState } from "react";
import { buttonClass } from "@/components/button-styles";
import type { UpgradeSource } from "@/types/billing";
import { UpgradeDialog } from "./upgrade-dialog";

export function UpgradeButton({ source, label, variant = "primary" }: {
  source: UpgradeSource;
  label: string;
  variant?: "primary" | "secondary";
}): React.JSX.Element {
  const [opener, setOpener] = useState<HTMLElement | null>(null);
  return (
    <>
      <button type="button" onClick={(event) => setOpener(event.currentTarget)} className={buttonClass(variant)}>{label}</button>
      {opener && <UpgradeDialog source={source} opener={opener} onClose={() => setOpener(null)} />}
    </>
  );
}
