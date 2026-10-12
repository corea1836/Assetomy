// S7. 로그인 (UC 02). 실제 구글 로그인(계정 선택·동의)은 자동화하지 않는다.
// 구글 로그인 화면 도착과 PKCE code verifier 쿠키까지만 보고, 나머지는 문서의 수동 확인으로 한다.

const hiddenNext = () => page.locator('form[action="/auth/login"] input[name="next"]').inputValue();
// Next.js의 경로 알림(#__next-route-announcer__)도 role="alert"라서 본문 안만 본다.
const alerts = () => page.locator("main").getByRole("alert");
const googleButton = () => page.getByRole("button", { name: "Google로 계속하기" });

const res = await go("/login");
check("S7 /login 200", res.status() === 200, res.status());
await page.waitForFunction(() => document.title !== "");
check("S7 탭 제목", (await page.title()) === "로그인 · assetomy", await page.title());
const h1 = norm(await page.getByRole("heading", { level: 1 }).innerText());
check("S7 제목", h1 === "구글 계정으로 시작해요", h1);
check("S7 받지 않는 정보", (await bodyText()).includes("카드번호·계좌·카드사 비밀번호는 받지 않아요"), "");
check("S7 구글 버튼 1개", (await googleButton().count()) === 1, await googleButton().count());
const buttonStyle = await googleButton().evaluate((el) => {
  const s = getComputedStyle(el);
  return {
    bg: s.backgroundColor,
    border: s.borderTopColor,
    color: s.color,
    fills: [...el.querySelectorAll("path")].map((p) => p.getAttribute("fill")),
  };
});
check(
  "S7 구글 버튼 모양(흰 바탕·#747775 테두리·#1F1F1F 글자·4색 G)",
  buttonStyle.bg === "rgb(255, 255, 255)" &&
    buttonStyle.border === "rgb(116, 119, 117)" &&
    buttonStyle.color === "rgb(31, 31, 31)" &&
    same(buttonStyle.fills, ["#EA4335", "#4285F4", "#FBBC05", "#34A853"]),
  JSON.stringify(buttonStyle),
);
check("S7 next 기본값 /dashboard", (await hiddenNext()) === "/dashboard", await hiddenNext());
check("S7 에러 안내 없음", (await alerts().count()) === 0, await alerts().count());

await go("/login?next=%2Fdashboard%3Fmonth%3D2026-09");
check("S7 next 쿼리 유지", (await hiddenNext()) === "/dashboard?month=2026-09", await hiddenNext());
for (const bad of ["%2F%2Fevil.com", "https%3A%2F%2Fevil.com", "%2Flogin", "%2Fauth%2Fcallback"]) {
  await go(`/login?next=${bad}`);
  check(`S7 위험한 next 거절 ${bad}`, (await hiddenNext()) === "/dashboard", await hiddenNext());
}

await go("/login?error=cancelled");
const cancelled = norm(await alerts().innerText());
check("S7 취소 안내", cancelled === "구글 로그인을 취소했어요. 계속하려면 다시 시도해 주세요.", cancelled);
await go("/login?error=failed");
const failed = norm(await alerts().innerText());
check("S7 실패 안내", failed === "로그인을 마치지 못했어요. 잠시 후 다시 시도해 주세요.", failed);
await go("/login?error=zzz");
check("S7 모르는 error 무시", (await alerts().count()) === 0, await alerts().count());

await go("/dashboard");
check("S7 비로그인 /dashboard → 로그인", path() === "/login?next=%2Fdashboard", path());
await go("/auth/callback?error=access_denied&error_description=x&next=%2Fdashboard");
check("S7 콜백 동의 취소 → 취소 안내", path() === "/login?next=%2Fdashboard&error=cancelled", path());
await go("/auth/callback?next=%2Fdashboard%3Fmonth%3D2026-09");
check("S7 콜백 code 없음 → 실패 안내(next 유지)", path() === "/login?next=%2Fdashboard%3Fmonth%3D2026-09&error=failed", path());
await go("/auth/callback?code=invalid&next=%2F%2Fevil.com");
check("S7 콜백 교환 실패 → 실패 안내(위험한 next 거절)", path() === "/login?next=%2Fdashboard&error=failed", path());
checkNoLogs("S7 화면 콘솔·네트워크 오류 없음");

// 폼 POST 검사: 다른 Origin(127.0.0.1)에서 제출한 폼, 같은 Origin의 JSON·GET 요청은 거절한다.
const crossOriginSubmit = async (action) => {
  await page.goto(`http://127.0.0.1:3100/login`, { waitUntil: "load" });
  await settle();
  const [response] = await Promise.all([
    page.waitForResponse((r) => r.url() === `${BASE}${action}`),
    page.evaluate((url) => {
      const form = document.createElement("form");
      form.method = "post";
      form.action = url;
      const input = document.createElement("input");
      input.name = "next";
      input.value = "/dashboard";
      form.append(input);
      document.body.append(form);
      form.submit();
    }, `${BASE}${action}`),
  ]);
  await page.waitForURL(`${BASE}${action}`);
  await settle();
  return response.status();
};
const evilLogin = await crossOriginSubmit("/auth/login");
check("S7 다른 Origin 폼 로그인 시작 403", evilLogin === 403, evilLogin);
const evilLogout = await crossOriginSubmit("/auth/logout");
check("S7 다른 Origin 폼 로그아웃 403", evilLogout === 403, evilLogout);
await go("/login");
const sameOrigin = await page.evaluate(async () => ({
  json: (await fetch("/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })).status,
  get: (await fetch("/auth/login", { redirect: "manual" })).status,
}));
check("S7 JSON 로그인 시작 400 · GET 405", sameOrigin.json === 400 && sameOrigin.get === 405, JSON.stringify(sameOrigin));
// 위 거절 응답(403·400·405)은 의도한 결과라 오류 집계에서 뺀다.
logs.length = 0;

// 키보드 · 375px
await go("/login");
const loginTabs = [];
while (loginTabs.length < 2) {
  await page.keyboard.press("Tab");
  const f = await focused();
  if (f.tag !== "nextjs-portal") loginTabs.push(f);
}
check(
  "S7 Tab 순서·포커스 표시",
  same(loginTabs.map((f) => f.text), ["assetomy", "Google로 계속하기"]) && loginTabs.every((f) => f.visible),
  JSON.stringify(loginTabs),
);
await page.setViewportSize({ width: 375, height: 667 });
await go("/login");
const narrow = await page.evaluate(() => ({
  scroll: document.documentElement.scrollWidth,
  client: document.documentElement.clientWidth,
}));
const buttonBox = await googleButton().boundingBox();
check(
  "S7 375 가로 스크롤 없음·버튼이 첫 화면에",
  narrow.scroll <= narrow.client && buttonBox !== null && buttonBox.y + buttonBox.height <= 667,
  JSON.stringify({ ...narrow, buttonBox }),
);
await page.setViewportSize({ width: 1280, height: 900 });

// 구글로 이동: 마지막에 둔다(사이트를 떠난다). 구글 화면의 콘솔은 보지 않는다.
await go("/login?next=%2Fdashboard%3Fmonth%3D2026-09");
checkNoLogs("S7 이동 전 콘솔·네트워크 오류 없음");
await googleButton().click();
await page.waitForURL(/^https:\/\/accounts\.google\.com\//, { timeout: 30000 });
const googleUrl = page.url();
check("S7 구글 로그인 화면 도착", googleUrl.startsWith("https://accounts.google.com/"), googleUrl.slice(0, 40));
check("S7 구글이 Supabase 콜백으로 돌려보냄", googleUrl.includes(".supabase.co"), "");
const cookieNames = (await page.context().cookies(BASE)).map((c) => c.name);
check(
  "S7 PKCE code verifier 쿠키",
  cookieNames.some((name) => /^sb-.+-auth-token-code-verifier$/.test(name)),
  JSON.stringify(cookieNames),
);
logs.length = 0;
