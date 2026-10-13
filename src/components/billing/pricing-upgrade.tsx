"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { UpgradeDialog } from "./upgrade-dialog";

export function PricingUpgrade(): React.JSX.Element {
  const router = useRouter();
  const [open, setOpen] = useState(true);
  return (
    <>
      {open && <UpgradeDialog source="pricing" opener={null} onClose={() => {
        setOpen(false);
        router.replace("/dashboard");
      }} />}
    </>
  );
}
