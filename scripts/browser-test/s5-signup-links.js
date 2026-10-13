// S5. 가입 CTA 동선 (UC 01 → 02 진입점). 랜딩·데모 CTA를 눌러 로그인 화면이 열리는지까지 본다.

const hrefs = (name) =>
  page.getByRole("link", { name, exact: true }).evaluateAll((els) => els.map((el) => el.getAttribute("href")));

await go("/");
const landingLinks = [await hrefs("로그인"), await hrefs("무료로 시작하기"), await hrefs("Pro 시작하기"), await hrefs("데모 보기")];
check("S5 랜딩 CTA href", same(landingLinks, [["/login"], ["/login", "/login"], ["/login?next=%2Fdashboard%3Fupgrade%3Dpricing"], ["/demo"]]), JSON.stringify(landingLinks));
const s5Body = await bodyText();
check("S5 가격", s5Body.includes("월 6,900원") && s5Body.includes("0원") && s5Body.includes("해외에서는 $4.99/월로 결제돼요."), "");
await page.getByRole("link", { name: "무료로 시작하기", exact: true }).first().click();
await page.waitForURL(`${BASE}/login`);
await settle();
check("S5 무료로 시작하기 → 로그인 화면", path() === "/login" && (await page.getByRole("heading", { level: 1 }).innerText()) === "구글 계정으로 시작해요", path());

await go("/demo");
check("S5 데모 CTA 2개 → /login", same(await hrefs("내 이용내역으로 해보기"), ["/login", "/login"]), JSON.stringify(await hrefs("내 이용내역으로 해보기")));
check("S5 하단 CTA 구역", (await section("내 카드로 확인해 보세요").getByRole("link", { name: "내 이용내역으로 해보기" }).count()) === 1, "");
check("S5 데모 안내", (await bodyText()).includes("예시 데이터로 만든 화면이에요. 실제 카드 내역이 아니에요."), "");
await page.getByRole("link", { name: "내 이용내역으로 해보기" }).first().click();
await page.waitForURL(`${BASE}/login`);
await settle();
check("S5 내 이용내역으로 해보기 → 로그인 화면", path() === "/login", path());
await go("/demo");
await page.getByRole("link", { name: "assetomy" }).click();
await page.waitForURL(`${BASE}/`);
check("S5 워드마크 → /", path() === "/", path());
checkNoLogs("S5 콘솔·네트워크 오류 없음");
