import Link from "next/link";
import { buttonClass } from "@/components/button-styles";
import { Wordmark } from "@/components/wordmark";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "대시보드 · assetomy" };

export default async function DashboardPage(): Promise<React.JSX.Element> {
  await requireUser("/dashboard");

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Link
          href="/"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Wordmark />
        </Link>
        <form method="post" action="/auth/logout">
          <button type="submit" className={buttonClass("secondary", "sm")}>
            로그아웃
          </button>
        </form>
      </header>

      <main className="pt-6">
        <h1 className="text-title-lg text-ink">아직 올린 이용내역이 없어요</h1>
        <p className="mt-3 text-base text-body">
          카드 이용내역 올리기를 준비하고 있어요.
        </p>
      </main>
    </div>
  );
}
