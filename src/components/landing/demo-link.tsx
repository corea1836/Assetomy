"use client";

import { track } from "@vercel/analytics";
import Link from "next/link";

export function DemoLink({
  className,
  children,
}: {
  className?: string;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <Link href="/demo" className={className} onClick={() => track("demo_click")}>
      {children}
    </Link>
  );
}
