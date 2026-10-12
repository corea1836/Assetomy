import type { PdfRow, PdfTextItem } from "@/types/parsing";

export const ROW_Y_TOLERANCE = 4;

export function groupPdfRows(items: PdfTextItem[]): PdfRow[] {
  const sorted = items
    .map((item) => ({ ...item, str: item.str.replace(/[\uE000-\uF8FF]/g, "") }))
    .filter((item) => item.str !== "")
    .sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);

  const rows: PdfRow[] = [];
  for (const { page, x, y, str } of sorted) {
    const row = rows[rows.length - 1];
    // 줄의 첫 조각 y를 유지해 가까운 조각들이 연쇄적으로 다른 줄을 합치지 않게 한다.
    if (row && row.page === page && Math.abs(row.y - y) <= ROW_Y_TOLERANCE) {
      row.cells.push({ x, str });
    } else {
      rows.push({ page, y, cells: [{ x, str }], text: "" });
    }
  }

  for (const row of rows) {
    row.cells.sort((a, b) => a.x - b.x);
    row.text = row.cells.map((cell) => cell.str).join("").replace(/\s+/g, " ").trim();
  }

  return rows.filter((row) => row.text !== "");
}
