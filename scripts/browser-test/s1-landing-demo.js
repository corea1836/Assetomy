// S1. 처음 온 사용자: 랜딩 → 데모 (UC 01)

const landing = await go("/");
check("S1 랜딩 200", landing.status() === 200, landing.status());
let s1Body = await bodyText();
check("S1 mock 배너", s1Body.includes("테스트 모드: AI 분석과 결제는 모의로 동작합니다"), "");

const landingTitle = "assetomy · 계좌 연동 없이 카드 지출 확인";
const ogTitle = await page.locator('meta[property="og:title"]').getAttribute("content");
check("S1 탭 제목·og:title", (await page.title()) === landingTitle && ogTitle === landingTitle, `${await page.title()} / ${ogTitle}`);
check("S1 히어로", s1Body.includes("계좌 연동 없이,") && s1Body.includes("카드 이용내역 파일만으로"), "");
check("S1 목업 총지출", s1Body.includes("2026년 9월 총지출") && s1Body.includes("1,517,200원"), "");

const mockCategories = page.locator('ul[aria-label="예시 상위 카테고리"] li');
const mockCategoryTexts = await texts(mockCategories);
check("S1 목업 상위 카테고리", same(mockCategoryTexts, ["쇼핑 989,000원", "마트·생활 150,000원", "문화·여가 99,000원"]), JSON.stringify(mockCategoryTexts));
const barColors = await page.locator('ul[aria-label="예시 상위 카테고리"] [class*="bg-primary-on-dark"]')
  .evaluateAll((els) => els.map((el) => getComputedStyle(el).backgroundColor));
check("S1 목업 막대 3개 primary-on-dark", barColors.length === 3 && barColors.every((c) => c === "rgb(61, 214, 163)"), JSON.stringify(barColors));
const candidate = norm(await page.locator("p.text-amber-200").first().innerText());
check("S1 목업 후보 문구(text-amber-200)", candidate === "확인이 필요한 지출 4건 · 후보 합계 1,053,900원", candidate);
check("S1 예시 데이터 표기", s1Body.includes("예시 데이터"), "");

const featureCards = section("파일 하나로 시작해요").locator("article");
const iconCounts = await featureCards.evaluateAll((els) => els.map((el) => el.querySelectorAll('svg[aria-hidden="true"]').length));
check("S1 기능 카드 3장·아이콘 1개씩", same(iconCounts, [1, 1, 1]), JSON.stringify(iconCounts));

const steps = await texts(page.locator('ol[aria-label="시작하는 순서"] > li'));
check(
  "S1 시작 단계 3개",
  steps.length === 3 &&
    steps[0].startsWith("01 카드사에서 이용내역 받기") &&
    steps[1].startsWith("02 파일마다 카드 고르기") &&
    steps[2].startsWith("03 올리고 확인하기"),
  JSON.stringify(steps),
);
const bandTops = await page.evaluate(() =>
  ["파일 하나로 시작해요", "이렇게 시작해요", "요금"].map((title) =>
    [...document.querySelectorAll("h2")].find((h) => h.textContent === title)?.getBoundingClientRect().top ?? -1),
);
check("S1 밴드 순서 기능 → 시작 단계 → 요금", bandTops.every((t) => t >= 0) && bandTops[0] < bandTops[1] && bandTops[1] < bandTops[2], JSON.stringify(bandTops));

check("S1 요금 안내", s1Body.includes("Free로 시작하고, 상세가 필요할 때 Pro로 바꿔요."), "");
const priceIcons = await section("요금").locator("article li").evaluateAll((els) => els.map((el) => el.querySelectorAll("svg").length));
check("S1 요금 기능 8줄·체크 아이콘", priceIcons.length === 8 && priceIcons.every((n) => n === 1), JSON.stringify(priceIcons));
check("S1 마지막 밴드 안내", s1Body.includes("구글 계정으로 시작해요. 카드번호는 받지 않아요."), "");
checkNoLogs("S1 랜딩 콘솔·네트워크 오류 없음");

await page.getByRole("link", { name: "데모 보기" }).click();
await page.waitForURL(`${BASE}/demo`);
await settle();
await page.waitForFunction(() => document.title !== "");
check("S1 데모 URL·탭 제목", path() === "/demo" && (await page.title()) === "데모 · assetomy", `${path()} / ${await page.title()}`);
check("S1 데모 h1", (await page.locator("h1").innerText()) === "2026년 9월 지출", await page.locator("h1").innerText());
s1Body = await bodyText();
check("S1 랜딩 목업과 같은 숫자", s1Body.includes("1,517,200원") && s1Body.includes("1,053,900원"), "");
checkNoLogs("S1 데모 콘솔·네트워크 오류 없음");
