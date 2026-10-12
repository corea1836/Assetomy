// S3. 월 선택기로 지난 달 보기 (UC 08 · 10)

await go("/demo");
const monthSelect = page.getByLabel("월 선택");
const totalOf = async () => norm(await section("총지출").innerText());
const pick = async (value, heading) => {
  await monthSelect.selectOption(value);
  await page.waitForURL(`${BASE}/demo?month=${value}`);
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
};

const options = (await monthSelect.locator("option").allTextContents()).map(norm);
check("S3 선택지 순서", same(options, ["2026년 9월", "2026년 8월", "2026년 7월", "2026년 6월"]), JSON.stringify(options));

await pick("2026-07", "2026년 7월 지출");
let s3Total = await totalOf();
check("S3 7월 URL·선택기", path() === "/demo?month=2026-07" && (await monthSelect.inputValue()) === "2026-07", path());
check("S3 7월 총지출·전월 대비·건수", s3Total.includes("699,200원") && s3Total.includes("6월보다 +109,000원 늘었어요") && s3Total.includes("거래 25건 · 반영 기간 7/1~7/30"), s3Total);
check("S3 7월 추세 막대 2개", (await page.locator('[aria-label="월별 지출 추세 막대 차트"] .recharts-bar-rectangle').count()) === 2, "");
const julyChanges = await texts(section("월별 추세").locator("h3 + ul > li"));
check("S3 7월 달라진 카테고리", same(julyChanges, ["마트·생활 +57,000원 늘었어요", "문화·여가 +42,000원 늘었어요", "배달 +19,000원 늘었어요", "식비 −9,000원 줄었어요"]), JSON.stringify(julyChanges));
const julyKinds = await texts(page.locator('ul[aria-label="탐지 종류별 요약"] li'));
check("S3 7월 탐지", same(julyKinds, ["정기결제로 보여요 2건 · 69,900원", "중복 결제 의심 0건 · 0원", "고액 결제 0건 · 0원"]), JSON.stringify(julyKinds));
let s3Body = await bodyText();
check("S3 7월 요약 대체 문구", s3Body.includes("데모 요약은 2026년 9월에만 있어요") && !s3Body.includes("이번 달 요약"), "");
check("S3 7월에도 9월까지 반영됨", s3Body.includes("2026년 9월까지 반영됨"), "");

await pick("2026-08", "2026년 8월 지출");
s3Total = await totalOf();
check("S3 8월 총지출·전월 대비·건수", s3Total.includes("608,000원") && s3Total.includes("7월보다 −91,200원 줄었어요") && s3Total.includes("거래 24건 · 반영 기간 8/1~8/30"), s3Total);
check("S3 8월 감소 색(text-decrease)", (await section("총지출").locator(".text-decrease").count()) > 0, "");

await pick("2026-06", "2026년 6월 지출");
s3Total = await totalOf();
s3Body = await bodyText();
check("S3 6월 총지출·건수·전월 대비 없음", s3Total.includes("590,200원") && s3Total.includes("거래 23건") && !/보다|과 같아요/.test(s3Total), s3Total);
check("S3 6월 추세 없음·9월까지 반영됨", !s3Body.includes("월별 추세") && s3Body.includes("2026년 9월까지 반영됨"), "");

for (const [heading, value, url] of [
  ["2026년 8월 지출", "2026-08", "/demo?month=2026-08"],
  ["2026년 7월 지출", "2026-07", "/demo?month=2026-07"],
  ["2026년 9월 지출", "2026-09", "/demo"],
]) {
  await page.goBack();
  await page.getByRole("heading", { level: 1, name: heading }).waitFor();
  check(`S3 뒤로가기 → ${value}`, path() === url && (await monthSelect.inputValue()) === value, `${path()} / ${await monthSelect.inputValue()}`);
}
checkNoLogs("S3 콘솔·네트워크 오류 없음");
