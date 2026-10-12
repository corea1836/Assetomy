// S2. 데모 9월 숫자 (UC 08 · 09 · 10)

await go("/demo");
const s2Body = await bodyText();

const total = norm(await section("총지출").innerText());
const totalOrder = ["1,517,200원", "8월보다 +909,200원 늘었어요", "거래 26건 · 반영 기간 9/1~9/30"].map((t) => total.indexOf(t));
check("S2 총지출·전월 대비·건수 순서", totalOrder.every((i) => i >= 0) && totalOrder[0] < totalOrder[1] && totalOrder[1] < totalOrder[2], total);
check("S2 증가 색(text-increase)", (await section("총지출").locator(".text-increase").count()) > 0, "");
check("S2 진행 중 문구 없음", !total.includes("진행 중인 달이에요"), total);
check("S2 반영 기간 줄", s2Body.includes("2026년 9월까지 반영됨"), "");

const categories = section("카테고리");
const shownCategories = await texts(categories.locator(":scope > ul > li"));
check("S2 카테고리 5개 표시", shownCategories.length === 5 && shownCategories[0] === "쇼핑 989,000원 65%" && shownCategories[4].startsWith("주거·통신"), JSON.stringify(shownCategories));
const fold = categories.locator("details");
check("S2 나머지 카테고리 접힘", norm(await fold.locator("summary").innerText()) === "나머지 5개 카테고리 보기" && (await fold.getAttribute("open")) === null, "");
await fold.locator("summary").click();
const allCategories = await texts(categories.locator("li"));
check("S2 펼치면 10개·마지막 교통", allCategories.length === 10 && allCategories[9] === "교통 9,300원 1%", JSON.stringify(allCategories.slice(-1)));

const merchants = await texts(section("가장 많이 쓴 곳").locator("li"));
const expectedMerchants = [
  ["예시 별숲 가구실", "920,000원"],
  ["예시 바람결 장터", "150,000원"],
  ["예시 은잎 밥상", "93,000원"],
  ["예시 종이달 상점", "69,000원"],
  ["예시 둥근잎 공방", "64,000원"],
];
check("S2 가장 많이 쓴 곳 5개", merchants.length === 5 && expectedMerchants.every(([name, amount], i) => merchants[i].includes(name) && merchants[i].endsWith(amount)), JSON.stringify(merchants));

const kinds = await texts(page.locator('ul[aria-label="탐지 종류별 요약"] li'));
check("S2 탐지 요약", same(kinds, ["정기결제로 보여요 2건 · 69,900원", "중복 결제 의심 1건 · 64,000원", "고액 결제 1건 · 920,000원"]), JSON.stringify(kinds));
check("S2 후보 합계·안내", s2Body.includes("후보 합계 1,053,900원") && s2Body.includes("같은 거래는 한 번만 셌어요. 정상 지출일 수 있어요."), "");

const items = await texts(page.locator('ul[aria-label="확인할 지출 상세"] > li'));
const workshop = items.find((t) => t.includes("예시 둥근잎 공방")) ?? "";
check(
  "S2 상세 4건",
  items.length === 4 &&
    items.some((t) => t.includes("예시 구름선 통신") && t.includes("55,000원") && t.includes("6월 · 7월 · 8월 · 9월 결제")) &&
    items.some((t) => t.includes("예시 달무늬 음악") && t.includes("14,900원") && t.includes("6월 · 7월 · 8월 · 9월 결제")) &&
    workshop.includes("64,000원") && workshop.split("9월 18일 · 온라인 쇼핑 카드 32,000원").length - 1 === 2 &&
    items.some((t) => t.includes("예시 별숲 가구실") && t.includes("920,000원")),
  JSON.stringify(items),
);
check("S2 자주 가는 카페는 탐지에 없음", !norm(await section("확인이 필요한 지출").innerText()).includes("예시 모래별 카페"), "");

const proTops = await page.evaluate(() => {
  const top = (el) => el?.getBoundingClientRect().top ?? -1;
  const heading = (title) => [...document.querySelectorAll("h2")].find((h) => h.textContent === title);
  const note = [...document.querySelectorAll("p")].find((p) => p.textContent === "여기부터 Pro 화면이에요. Free에서는 확인할 지출의 건수와 합계만 보여요.");
  return [top(heading("일별 지출")), top(note), top(heading("확인이 필요한 지출"))];
});
check("S2 Pro 구분선 위치", proTops.every((t) => t >= 0) && proTops[0] < proTops[1] && proTops[1] < proTops[2], JSON.stringify(proTops));

const trendBars = page.locator('[aria-label="월별 지출 추세 막대 차트"] .recharts-bar-rectangle');
check("S2 추세 막대 4개", (await trendBars.count()) === 4, await trendBars.count());
const trendList = (await page.locator('ul[aria-label="월별 지출 합계"] li').allTextContents()).map(norm);
check("S2 추세 목록", same(trendList, ["2026년 6월 590,200원", "2026년 7월 699,200원", "2026년 8월 608,000원", "2026년 9월 1,517,200원"]), JSON.stringify(trendList));
await trendBars.nth(3).hover();
await page.waitForTimeout(300);
const tooltip = norm(await section("월별 추세").locator(".recharts-tooltip-wrapper").innerText());
check("S2 9월 막대 툴팁", tooltip.includes("2026년 9월") && tooltip.includes("1,517,200원"), tooltip);
const changes = await texts(section("월별 추세").locator("h3 + ul > li"));
check("S2 달라진 카테고리", same(changes, ["쇼핑 +872,000원 늘었어요", "문화·여가 +64,000원 늘었어요", "식비 −22,000원 줄었어요", "카페·간식 −4,800원 줄었어요"]), JSON.stringify(changes));

const summary = norm(await section("이번 달 요약").innerText()).replace("이번 달 요약", "").trim();
check("S2 요약 문단·숫자 없음", summary.length > 20 && !/[0-9]/.test(summary), summary);
check("S2 금지어 없음", !/절약|낭비|부정 결제|명세서/.test(await bodyText()), "");
checkNoLogs("S2 콘솔·네트워크 오류 없음");
