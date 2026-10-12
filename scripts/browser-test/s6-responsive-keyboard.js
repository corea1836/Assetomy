// S6. 반응형 · 키보드 · 콘솔

const layout = async (to, width) => {
  await page.setViewportSize({ width, height: 900 });
  await go(to);
  return page.evaluate(() => {
    const columns = (el) => (el ? getComputedStyle(el).gridTemplateColumns.split(" ").length : null);
    const gridUnder = (title) =>
      [...document.querySelectorAll("h2")].find((h) => h.textContent === title)?.closest("section")?.querySelector(".grid");
    return {
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
      features: columns(gridUnder("파일 하나로 시작해요")),
      steps: columns(document.querySelector('ol[aria-label="시작하는 순서"]')),
      prices: columns(gridUnder("요금")),
      demo: columns(document.querySelector("main .grid.gap-6")),
    };
  });
};

const landing375 = await layout("/", 375);
check("S6 랜딩 375 가로 스크롤 없음·1열", landing375.scroll <= landing375.client && landing375.features === 1 && landing375.steps === 1 && landing375.prices === 1, JSON.stringify(landing375));
const hero = await page.evaluate(() => {
  const range = document.createRange();
  range.selectNodeContents(document.querySelector("h1"));
  return {
    wordBreak: getComputedStyle(document.body).wordBreak,
    lines: new Set([...range.getClientRects()].map((r) => Math.round(r.top))).size,
  };
});
check("S6 한글 줄바꿈 keep-all·375 히어로 3줄", hero.wordBreak === "keep-all" && hero.lines === 3, JSON.stringify(hero));
// 등장 모션: 화면보다 긴 구역도 위쪽이 화면에 들어와 읽히는 위치(top 120px)에서는 다 보여야 한다.
const tallRow = await page.evaluate(async () => {
  const rows = [...document.querySelectorAll("article.reveal")];
  const row = rows.reduce((a, b) => (b.offsetHeight > a.offsetHeight ? b : a));
  scrollTo(0, row.getBoundingClientRect().top + scrollY - 120);
  await new Promise((r) => setTimeout(r, 400));
  return { height: row.offsetHeight, viewport: innerHeight, opacity: getComputedStyle(row).opacity };
});
check("S6 375 긴 구역 등장 모션 끝까지", tallRow.height > tallRow.viewport && tallRow.opacity === "1", JSON.stringify(tallRow));
const landing1280 = await layout("/", 1280);
check("S6 랜딩 1280 쇼케이스 글·그림 2열·시작 단계 3열·가격 2열", landing1280.features === 2 && landing1280.steps === 3 && landing1280.prices === 2, JSON.stringify(landing1280));

// 버튼 hover: Primary는 primary-hover, Secondary는 hairline, 화살표 CTA는 화살표가 4px 이동(transition 끝까지 기다린다).
const hovered = async (name, nth = 0) => {
  const link = page.getByRole("link", { name, exact: true }).nth(nth);
  await link.scrollIntoViewIfNeeded();
  await link.hover();
  await page.waitForTimeout(400);
  const result = await link.evaluate((el) => ({
    background: getComputedStyle(el).backgroundColor,
    arrow: el.querySelector("svg") ? getComputedStyle(el.querySelector("svg")).translate : null,
  }));
  await page.mouse.move(0, 0);
  return result;
};
const demoHover = await hovered("데모 보기");
check("S6 hover Primary 색·화살표 이동", demoHover.background === "rgb(9, 109, 84)" && String(demoHover.arrow).startsWith("4px"), JSON.stringify(demoHover));
const freeHover = await hovered("무료로 시작하기", 0);
check("S6 hover Secondary 색", freeHover.background === "rgb(222, 225, 230)", JSON.stringify(freeHover));
const demo375 = await layout("/demo", 375);
check("S6 데모 375 가로 스크롤 없음·1열", demo375.scroll <= demo375.client && demo375.demo === 1, JSON.stringify(demo375));
const demo1280 = await layout("/demo", 1280);
check("S6 데모 1280 2열", demo1280.demo === 2, JSON.stringify(demo1280));

// dev 서버면 Next.js 개발 도구(nextjs-portal)가 Tab 순서에 끼어들어 건너뛴다.
const tabOrder = async (count) => {
  const order = [];
  while (order.length < count) {
    await page.keyboard.press("Tab");
    const f = await focused();
    if (f.tag !== "nextjs-portal") order.push(f);
  }
  return order;
};

await go("/");
const landingTabs = await tabOrder(5);
check(
  "S6 랜딩 Tab 순서·포커스 표시",
  same(landingTabs.map((f) => f.text), ["로그인", "데모 보기", "무료로 시작하기", "Pro 시작하기", "무료로 시작하기"]) && landingTabs.every((f) => f.visible),
  JSON.stringify(landingTabs),
);
await go("/");
await tabOrder(2);
await page.keyboard.press("Enter");
await page.waitForURL(`${BASE}/demo`);
check("S6 Tab 2번 + Enter → /demo", path() === "/demo", path());

await go("/demo");
const demoTabs = await tabOrder(5);
check(
  "S6 데모 Tab 순서·포커스 표시",
  same(demoTabs.map((f) => f.text), ["assetomy", "내 이용내역으로 해보기", "월 선택", "나머지 5개 카테고리 보기", "내 이용내역으로 해보기"]) && demoTabs.every((f) => f.visible),
  JSON.stringify(demoTabs),
);

const chartFocus = await page.evaluate(() =>
  [...document.querySelectorAll('[role="img"][aria-label$="막대 차트"]')].map((img) => img.querySelectorAll('[tabindex="0"], [role="application"]').length),
);
check("S6 차트 안 포커스 요소 없음", same(chartFocus, [0, 0]), JSON.stringify(chartFocus));
const chartTree = (await page.locator("main").ariaSnapshot()).split("\n").filter((l) => /막대 차트|application/.test(l)).map(norm);
check("S6 접근성 트리에 차트 이미지 2개만", same(chartTree, ['- img "일별 지출 막대 차트":', '- img "월별 지출 추세 막대 차트":']), JSON.stringify(chartTree));

logs.length = 0;
for (const to of ["/", "/demo", "/demo?month=2026-06"]) await go(to);
await go("/");
await page.getByRole("link", { name: "데모 보기" }).click();
await page.waitForURL(`${BASE}/demo`);
await settle();
checkNoLogs("S6 콘솔·네트워크 오류 없음");
