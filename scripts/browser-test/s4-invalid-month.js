// S4. 잘못된 month 파라미터

for (const query of ["month=abc", "month=2025-01", "month=2026-13", "month=2026-07&month=2026-08", "month="]) {
  const res = await go(`/demo?${query}`);
  const heading = await page.locator("h1").innerText();
  const value = await page.getByLabel("월 선택").inputValue();
  check(`S4 ?${query} → 9월`, res.status() === 200 && heading === "2026년 9월 지출" && value === "2026-09", `${res.status()} / ${heading} / ${value}`);
}
checkNoLogs("S4 콘솔·네트워크 오류 없음");
