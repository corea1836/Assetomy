// 시나리오 공통 도우미. run.sh가 각 시나리오 파일 앞에 이 파일을 이어 붙여 dev-browser로 보낸다.
// dev-browser 스크립트는 QuickJS 샌드박스에서 돌고(import 불가), page는 Playwright Page다.
// 기준 문서: docs/testing/BROWSER_TESTING.md
// 아래 도우미는 이어 붙는 시나리오 파일이 쓰므로 이 파일만 보면 쓰이지 않는 것처럼 보인다.
/* eslint-disable @typescript-eslint/no-unused-vars */

const BASE = "http://localhost:3100";
const page = await browser.newPage();
page.setDefaultTimeout(5000);
page.setDefaultNavigationTimeout(60000);
await page.setViewportSize({ width: 1280, height: 900 });

// /login은 아직 없어서 프로덕션의 링크 프리페치가 404를 내고 브라우저에서 끝나지 않은 채 남는다.
// 그 요청은 오류 집계와 안정 판정에서 뺀다.
const isLoginPrefetch = (url) => url.includes("/login");
const logs = [];
page.on("console", (m) => {
  if ((m.type() === "error" || m.type() === "warning") && !isLoginPrefetch(m.location().url ?? "")) {
    logs.push(`${m.type()}: ${m.text().slice(0, 160)}`);
  }
});
page.on("pageerror", (e) => logs.push(`pageerror: ${String(e).slice(0, 160)}`));
page.on("response", (r) => {
  if (r.status() >= 400 && !isLoginPrefetch(r.url())) logs.push(`${r.status()} ${r.url()}`);
});

// 프로덕션 서버에서는 Playwright의 networkidle이 오지 않는다(남은 요청이 0건이어도).
// 직접 센 요청이 0.5초 동안 0건이면 안정된 것으로 본다.
const inflight = new Set();
page.on("request", (r) => { if (!isLoginPrefetch(r.url())) inflight.add(r); });
page.on("requestfinished", (r) => inflight.delete(r));
page.on("requestfailed", (r) => inflight.delete(r));
const settle = async () => {
  let quietSince = Date.now();
  for (const deadline = Date.now() + 10000; Date.now() < deadline; ) {
    if (inflight.size > 0) quietSince = Date.now();
    else if (Date.now() - quietSince >= 500) return;
    await page.waitForTimeout(100);
  }
};

const check = (name, ok, got) =>
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : ` — got: ${got}`}`);
const checkNoLogs = (name) => {
  check(name, logs.length === 0, JSON.stringify(logs));
  logs.length = 0;
};
const norm = (t) => t.replace(/\s+/g, " ").trim();
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
// 샌드박스의 new URL(...).pathname은 믿을 수 없어 경로는 문자열로 비교한다.
const path = () => page.url().replace(BASE, "");
const go = async (to) => {
  const res = await page.goto(`${BASE}${to}`, { waitUntil: "load" });
  await settle();
  return res;
};
const bodyText = async () => norm(await page.locator("body").innerText());
const texts = async (locator) => (await locator.allInnerTexts()).map(norm);
const section = (title) =>
  page.locator("section", { has: page.getByRole("heading", { name: title, exact: true }) }).last();
const focused = () =>
  page.evaluate(() => {
    const el = document.activeElement;
    const s = getComputedStyle(el);
    return {
      tag: el.tagName.toLowerCase(),
      text: (el.getAttribute("aria-label") || el.textContent || "").trim().slice(0, 20),
      visible: s.outlineStyle !== "none" || s.boxShadow !== "none",
    };
  });
