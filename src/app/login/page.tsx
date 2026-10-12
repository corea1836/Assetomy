import Link from "next/link";
import { redirect } from "next/navigation";
import { GoogleSignInButton } from "@/components/google-sign-in-button";
import { Wordmark } from "@/components/wordmark";
import { getSessionUser, safeNextPath } from "@/lib/auth";
import { LOGIN_ERROR_MESSAGES, parseLoginErrorCode } from "@/lib/errors/messages";

export const metadata = { title: "로그인 · assetomy" };

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[]; error?: string | string[] }>;
}): Promise<React.JSX.Element> {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await getSessionUser()) redirect(next);

  const errorCode = parseLoginErrorCode(params.error);

  return (
    <div className="mx-auto max-w-5xl px-4 pb-12 sm:px-6">
      <header className="flex flex-wrap items-center justify-between gap-4 py-6">
        <Link
          href="/"
          className="rounded-lg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
        >
          <Wordmark />
        </Link>
      </header>

      <main className="mx-auto max-w-sm px-4 pt-16 text-center">
        <h1 className="text-title-lg text-ink">구글 계정으로 시작해요</h1>
        <p className="mt-3 text-base text-body">
          카드번호·계좌·카드사 비밀번호는 받지 않아요
        </p>
        {errorCode && (
          <p
            role="alert"
            className="mt-6 rounded-xl bg-red-50 px-4 py-3 text-left text-sm text-danger"
          >
            {LOGIN_ERROR_MESSAGES[errorCode]}
          </p>
        )}
        <form method="post" action="/auth/login" className="mt-8">
          <input type="hidden" name="next" value={next} />
          <GoogleSignInButton />
        </form>
      </main>
    </div>
  );
}
