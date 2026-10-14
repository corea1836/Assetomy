import Link from "next/link";
import { buttonClass } from "@/components/button-styles";

export function EmptyCard(): React.JSX.Element {
  return (
    <section className="flex flex-col items-center justify-center rounded-3xl bg-surface-soft p-6 text-center sm:p-8">
      <p className="text-base text-body">이 카드로 올린 내역이 아직 없어요</p>
      <Link href="#upload" className={`${buttonClass("secondary")} mt-4`}>새 이용내역 추가</Link>
    </section>
  );
}
