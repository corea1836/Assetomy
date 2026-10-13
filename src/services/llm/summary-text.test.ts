import "server-only";
import { describe, expect, it } from "vitest";
import type { FreeSummaryInput, ProSummaryInput, SummaryInput } from "@/types/summary";
import { checkSummaryText } from "./summary-text";

function freeInput(overrides: Partial<FreeSummaryInput> = {}): FreeSummaryInput {
  return {
    plan: "free",
    month: "2026-09",
    inProgress: false,
    period: { from: "2026-09-01", to: "2026-09-30" },
    total: 1000,
    transactionCount: 1,
    categories: [],
    topMerchants: [],
    monthOverMonth: null,
    candidates: {
      recurring: { count: 0, amount: 0 },
      duplicate: { count: 0, amount: 0 },
      large: { count: 0, amount: 0 },
      candidateTotal: 0,
    },
    ...overrides,
  };
}

function proInput(overrides: Partial<ProSummaryInput> = {}): ProSummaryInput {
  return {
    ...freeInput(),
    plan: "pro",
    findings: [],
    trend: null,
    ...overrides,
  };
}

describe("checkSummaryText", () => {
  it("trims and returns a number-free plain Korean summary", () => {
    const raw = "  이번 달에는 식비 비중이 가장 크게 나타났어요. 지난달보다 지출 흐름이 줄었고, 여러 카테고리를 함께 살펴보면 소비 변화를 파악하기 쉬워요.  ";
    expect(checkSummaryText(raw, freeInput())).toEqual({ ok: true, text: raw.trim() });
  });

  it.each(["1,820,075원", "3건", "20%", "３"])("rejects numeric text: %s", (numericText) => {
    expect(checkSummaryText(`이번 달 지출 흐름을 보면 ${numericText} 정도가 보여요. 전체 카테고리를 함께 보면 소비 특징을 더 잘 알 수 있어요.`, freeInput()))
      .toEqual({ ok: false, reason: "number" });
  });

  it.each(["9월", "12월", "2026년"])("allows a month or year: %s", (dateText) => {
    expect(checkSummaryText(`이번 ${dateText} 소비는 식비 비중이 가장 크게 보여요. 카테고리별 흐름을 살펴보면 지출의 특징을 파악하기 쉬워요.`, freeInput()))
      .toMatchObject({ ok: true });
  });

  it("rejects a month outside the allowed range", () => {
    expect(checkSummaryText("이번 13월 소비는 식비 비중이 가장 크게 보여요. 카테고리별 흐름을 살펴보면 지출의 특징을 파악하기 쉬워요.", freeInput()))
      .toEqual({ ok: false, reason: "number" });
  });

  it("ignores numbers that occur only inside input merchant names", () => {
    const input = freeInput({
      topMerchants: [{ merchant: "GS25 역삼점", category: "마트·생활", amount: 1000, count: 1 }],
    });
    expect(checkSummaryText("GS25 역삼점은 이번 달 소비 흐름을 보여주는 곳이에요. 카테고리별 지출을 함께 보면 생활 속 소비 특징을 쉽게 파악할 수 있어요.", input))
      .toMatchObject({ ok: true });
  });

  it("ignores numbers in Pro finding merchant names but rejects them elsewhere", () => {
    const input = proInput({
      findings: [{ kind: "large", merchant: "7번가피자", category: "식비", amount: 1000, transactionCount: 1, seriesMonthCount: null }],
    });
    expect(checkSummaryText("7번가피자는 확인이 필요한 지출 후보예요. 정상 지출일 수 있으니 이용내역과 함께 살펴보고, 다른 소비 흐름도 차분히 확인해 주세요.", input))
      .toMatchObject({ ok: true });
    expect(checkSummaryText("7번가피자는 확인이 필요한 지출 후보예요. 2번 더 살펴보고, 다른 소비 흐름도 차분히 확인해 주세요.", input))
      .toEqual({ ok: false, reason: "number" });
  });

  it("removes longer merchant names before names they contain", () => {
    const input = freeInput({
      topMerchants: [
        { merchant: "GS25", category: "마트·생활", amount: 1000, count: 1 },
        { merchant: "GS25 역삼점", category: "마트·생활", amount: 1000, count: 1 },
      ],
    });
    expect(checkSummaryText("GS25 역삼점에서 확인된 소비 흐름은 식비와 생활 지출을 함께 살펴보면 잘 보여요. 이번 달의 여러 카테고리를 차분히 돌아볼 수 있어요.", input))
      .toMatchObject({ ok: true });
  });

  it.each(["**굵은 제목**", "# 제목", "`코드`", "- 목록 항목"]) ("rejects markdown: %s", (markup) => {
    expect(checkSummaryText(`${markup}\n이번 달 소비는 식비 비중이 가장 크게 보여요. 카테고리별 흐름을 함께 살펴보면 지출 특징을 더 잘 알 수 있어요.`, freeInput()))
      .toEqual({ ok: false, reason: "markup" });
  });

  it("does not treat a hash inside a merchant name as markup", () => {
    const input = freeInput({
      topMerchants: [{ merchant: "샵#25", category: "쇼핑", amount: 1000, count: 1 }],
    });
    expect(checkSummaryText("샵#25는 이번 달 소비 흐름에서 눈에 띄는 곳이에요. 카테고리별 지출을 함께 살펴보면 생활 속 소비 특징을 차분히 파악할 수 있어요.", input))
      .toMatchObject({ ok: true });
  });

  it.each(["절감", "절약", "아낄", "부정 결제", "부정결제", "도용"])("rejects forbidden phrase: %s", (phrase) => {
    expect(checkSummaryText(`이번 달에는 ${phrase} 수 있는 소비가 보여요. 식비와 다른 카테고리의 흐름을 함께 살펴보면 지출 특징을 이해하기 쉬워요.`, freeInput()))
      .toEqual({ ok: false, reason: "forbidden_phrase" });
  });

  it("rejects text shorter than 30 and longer than 600 characters", () => {
    expect(checkSummaryText("가나다라마바사가나다라마바사가나다라마", freeInput()))
      .toEqual({ ok: false, reason: "length" });
    expect(checkSummaryText("가".repeat(601), freeInput()))
      .toEqual({ ok: false, reason: "length" });
  });

  it("accepts the SummaryInput union", () => {
    const input: SummaryInput = proInput();
    expect(checkSummaryText("이번 달 소비 흐름은 여러 카테고리에서 고르게 나타났어요. 각 항목의 비중을 살펴보면 생활 속 지출의 방향을 차분히 파악할 수 있어요.", input))
      .toMatchObject({ ok: true });
  });
});
