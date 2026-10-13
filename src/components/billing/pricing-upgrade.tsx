"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Teaser } from "@/types/dashboard";
import { UpgradeDialog } from "./upgrade-dialog";

export function PricingUpgrade({ teaser }: { teaser?: Teaser | null }): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <>
      {open && <UpgradeDialog source="pricing" teaser={teaser} opener={null} onClose={() => {
        setOpen(false);
        router.replace("/dashboard");
      }} />}
    </>
  );
}
