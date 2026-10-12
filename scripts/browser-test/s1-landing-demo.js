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
check("S1 히어로 파일 칩", s1Body.includes("생활비 카드.xlsx") && s1Body.includes("온라인 쇼핑 카드.csv"), "");
check("S1 히어로 떠 있는 칩", s1Body.includes("중복 결제 의심 · 9월 18일 32,000원 × 2"), "");

// 쇼케이스 줄마다 그림 안에도 아이콘·선이 있으므로, 제목 위 첫 아이콘만 본다.
const featureRows = section("파일 하나로 시작해요").locator("article");
const rowIcons = await featureRows.evaluateAll((els) => els.map((el) => {
  const icon = el.querySelector("h3")?.previousElementSibling;
  return `${el.querySelector("h3")?.textContent} ${icon?.tagName.toLowerCase()} ${icon?.getAttribute("width")}`;
}));
check("S1 기능 쇼케이스 3줄·제목 위 24px 아이콘", same(rowIcons, ["한 화면에 모든 카드 svg 24", "확인이 필요한 지출 svg 24", "연동 없이, 언제든 삭제 svg 24"]), JSON.stringify(rowIcons));
const showcase = norm(await section("파일 하나로 시작해요").innerText());
check(
  "S1 기능 쇼케이스 그림",
  ["9월 총지출 1,517,200원 · 거래 26건", "6월~9월 매달 결제", "9월 18일 · 32,000원", "9월 23일 예시 별숲 가구실 920,000원", "정상 지출일 수 있어요", "카드사 비밀번호"]
    .every((t) => showcase.includes(t)),
  showcase.slice(0, 300),
);

// 미니 그림 글자(XLSX·카드 라벨)도 li 안에 있으므로 번호·제목만 따로 본다.
const steps = await page.locator('ol[aria-label="시작하는 순서"] > li').evaluateAll((els) =>
  els.map((el) => `${el.querySelector("p.font-mono")?.textContent} ${el.querySelector("h3")?.textContent}`));
check("S1 시작 단계 3개", same(steps, ["01 카드사에서 이용내역 받기", "02 파일마다 카드 고르기", "03 올리고 확인하기"]), JSON.stringify(steps));

const summaryTitle = "숫자는 코드가 계산하고, 요약은 문장으로 정리해요";
const bandTops = await page.evaluate((titles) =>
  titles.map((title) =>
    [...document.querySelectorAll("h2")].find((h) => h.textContent === title)?.getBoundingClientRect().top ?? -1),
["파일 하나로 시작해요", summaryTitle, "이렇게 시작해요", "요금"]);
check("S1 밴드 순서 기능 → 요약 → 시작 단계 → 요금", bandTops.every((t) => t >= 0) && bandTops.every((t, i) => i === 0 || bandTops[i - 1] < t), JSON.stringify(bandTops));

const summaryBand = norm(await section(summaryTitle).innerText());
check("S1 요약 밴드 예시 요약·출처", summaryBand.includes("이번 달 요약") && summaryBand.includes("예시 요약이에요. 가입하면 AI가 내 가맹점명과 집계로 요약해요."), summaryBand.slice(0, 200));
const evidence = await texts(page.locator('ol[aria-label="요약의 근거"] > li'));
check(
  "S1 요약 근거 3칸 순서",
  evidence.length === 3 &&
    evidence[0].includes("고액 결제") && evidence[0].includes("9월 23일 예시 별숲 가구실") && evidence[0].endsWith("920,000원") &&
    evidence[1].includes("정기결제로 보여요") && evidence[1].includes("예시 구름선 통신 · 예시 달무늬 음악") && evidence[1].endsWith("2건 · 69,900원") &&
    evidence[2].includes("중복 결제 의심") && evidence[2].includes("9월 18일 예시 둥근잎 공방") && evidence[2].endsWith("32,000원 × 2"),
  JSON.stringify(evidence),
);
check("S1 요약 밴드 추세·전월 대비", (await page.locator('[role="img"][aria-label="월별 지출 추세 막대(예시)"]').count()) === 1 && summaryBand.includes("8월보다 +909,200원 늘었어요"), "");

check("S1 요금 안내", s1Body.includes("Free로 시작하고, 상세가 필요할 때 Pro로 바꿔요."), "");
// 미리보기 상세도 li라서 기능 목록(article 바로 아래 ul)만 센다.
const priceIcons = await section("요금").locator("article > ul > li").evaluateAll((els) => els.map((el) => el.querySelectorAll("svg").length));
check("S1 요금 기능 8줄·체크 아이콘", priceIcons.length === 8 && priceIcons.every((n) => n === 1), JSON.stringify(priceIcons));
const previews = await section("요금").locator("article").evaluateAll((els) =>
  els.map((el) => [...el.querySelectorAll("p, li")].map((n) => n.textContent.replace(/\s+/g, " ").trim())));
check(
  "S1 요금 미리보기 Free 건수·합계만 / Pro 상세 2줄",
  previews.length === 2 &&
    previews[0].includes("확인이 필요한 지출 4건 · 후보 합계 1,053,900원") && !previews[0].some((t) => t.includes("예시 ")) &&
    previews[1].includes("확인이 필요한 지출 4건 · 후보 합계 1,053,900원") &&
    previews[1].includes("고액 결제 · 예시 별숲 가구실920,000원") && previews[1].includes("중복 결제 의심 · 예시 둥근잎 공방64,000원"),
  JSON.stringify(previews.map((p) => p.filter((t) => t.includes("·")))),
);
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
