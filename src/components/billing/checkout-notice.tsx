import type { Plan } from "@/types/dashboard";

export function CheckoutNotice({ plan }: { plan: Plan }): React.JSX.Element {
  return (
    <div role="status" aria-live="polite" className="mb-6 rounded-3xl bg-primary-soft p-6 text-primary-active">
      {plan === "pro" ? <p>Pro가 활성화됐어요</p> : (
        <>
          <p>결제 반영 중…</p>
          <p className="mt-2 text-sm">잠시 후 새로고침해 주세요</p>
          <a href="/dashboard?checkout=success" className="mt-3 inline-block rounded-lg font-semibold text-primary hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:text-primary-active">새로고침</a>
        </>
      )}
    </div>
  );
}
