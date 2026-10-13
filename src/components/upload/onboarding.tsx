import { HyundaiGuide } from "./hyundai-guide";

export function Onboarding(): React.JSX.Element {
  return (
    <section>
      <h1 className="text-title-lg text-ink">카드 이용내역을 올려 주세요</h1>
      <p className="mt-3 text-base text-body">
        최근 3개월치 카드 이용내역을 올리면 정기결제와 확인할 지출을 찾아드려요
      </p>
      <ol className="mt-8 space-y-6">
        <li>
          <h2 className="text-lg font-semibold text-ink">① 카드사에서 이용내역 받기</h2>
          <p className="mt-2 text-base text-body">
            <span className="font-semibold">청구서 말고 이용내역(승인내역)</span>을 받아 주세요.
          </p>
          <HyundaiGuide />
          <p className="mt-2 text-sm text-body">다른 카드사 이용내역은 준비 중이에요</p>
        </li>
        <li>
          <h2 className="text-lg font-semibold text-ink">② 파일마다 카드 고르기</h2>
          <p className="mt-2 text-base text-body">
            같은 카드는 같은 이름으로 골라 주세요. 카드번호는 받지 않아요.
          </p>
        </li>
        <li>
          <h2 className="text-lg font-semibold text-ink">③ 올리기</h2>
        </li>
      </ol>
    </section>
  );
}
