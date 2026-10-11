import { Analytics } from "@vercel/analytics/next";
import type { Metadata } from "next";
import { JetBrains_Mono } from "next/font/google";
import type { ReactNode } from "react";
import { MockBanner } from "@/components/mock-banner";
import { getMode } from "@/lib/mode";
import "pretendard/dist/web/variable/pretendardvariable-dynamic-subset.css";
import "./globals.css";

const jetbrainsMono = JetBrains_Mono({
  weight: "500",
  variable: "--font-jetbrains-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "assetomy",
  description: "계좌 연동 없이, 카드 이용내역 파일만으로 확인할 지출을 찾아줘요.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  const mode = getMode();

  return (
    <html lang="ko" className={jetbrainsMono.variable}>
      <body className="bg-canvas text-ink font-sans antialiased">
        {mode === "mock" && <MockBanner />}
        {children}
        {mode === "live" && <Analytics />}
      </body>
    </html>
  );
}
