import { render, screen, within } from "@testing-library/react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import Page from "@/app/page";
import * as analytics from "@/lib/analytics/dashboard";
import { DEMO_TODAY, DEMO_TRANSACTIONS } from "@/lib/demo/fixture";
import { formatMonth, formatWon } from "@/lib/format";
import { CATEGORY_LABELS } from "@/types/category";

vi.mock("@vercel/analytics", () => ({ track: vi.fn() }));

function demoDashboard() {
  const dashboard = analytics.buildDashboard({
    transactions: DEMO_TRANSACTIONS,
    plan: "pro",
    today: DEMO_TODAY,
  });
  if (dashboard?.plan !== "pro") throw new Error("Expected a Pro demo dashboard");
  return dashboard;
}

afterEach(() => vi.restoreAllMocks());

describe("landing page", () => {
  it("introduces the product with a demo link and a dark wordmark", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { level: 1 }))
      .toHaveTextContent("계좌 연동 없이,카드 이용내역 파일만으로");
    const demoLink = screen.getByRole("link", { name: "데모 보기" });
    expect(demoLink).toHaveAttribute("href", "/demo");
    expect(demoLink).toHaveClass("bg-primary", "h-11");
    expect(screen.getByText("로그인 없이 바로 볼 수 있어요")).toBeInTheDocument();
    expect(screen.getByText("assetomy")).toHaveClass("text-white");
    expect(screen.getByText(
      "흩어진 카드 지출을 한 화면에서 보고, 정기결제와 확인이 필요한 지출을 찾아드려요.",
    )).toBeInTheDocument();
  });

  it("links login and every signup entry to the future login page", () => {
    render(<Page />);

    expect(screen.getByRole("link", { name: "로그인" })).toHaveAttribute("href", "/login");
    expect(screen.getByRole("link", { name: "Pro 시작하기" }))
      .toHaveAttribute("href", "/login");
    const freeLinks = screen.getAllByRole("link", { name: "무료로 시작하기" });
    expect(freeLinks).toHaveLength(2);
    for (const link of freeLinks) expect(link).toHaveAttribute("href", "/login");
  });

  it("contains decorative dots and one light inside each isolated dark band", () => {
    const { container } = render(<Page />);
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    const cta = screen.getByRole("heading", {
      name: "이번 달 카드 지출, 파일 하나로 확인해 보세요",
    }).closest("section")!;

    for (const band of [hero, cta]) {
      expect(band).toHaveClass("relative", "isolate", "overflow-hidden");
      const dots = band.querySelectorAll(".landing-dots");
      const lights = band.querySelectorAll(".landing-light");
      expect(dots).toHaveLength(1);
      expect(lights).toHaveLength(1);
      expect(dots[0].parentElement).toHaveAttribute("aria-hidden", "true");
      expect(dots[0].parentElement).toHaveClass("pointer-events-none", "-z-10");
      expect(lights[0].parentElement).toBe(dots[0].parentElement);
    }
    expect(hero.querySelector(".landing-light")).toHaveClass("left-1/2");
    expect(cta.querySelector(".landing-light")).toHaveClass("inset-0");
    expect(container.querySelectorAll(".landing-dots")).toHaveLength(2);
  });

  it("adds decorative 18px arrows only to the hero and closing CTA links", () => {
    render(<Page />);
    const cta = screen.getByRole("heading", {
      name: "이번 달 카드 지출, 파일 하나로 확인해 보세요",
    }).closest("section")!;
    const demoLink = screen.getByRole("link", { name: "데모 보기" });
    const signupLink = within(cta).getByRole("link", { name: "무료로 시작하기" });

    for (const link of [demoLink, signupLink]) {
      const arrow = link.querySelector('svg[aria-hidden="true"]');
      expect(link).toHaveClass("group");
      expect(arrow).toHaveAttribute("width", "18");
      expect(arrow).toHaveAttribute("height", "18");
      expect(arrow).toHaveClass(
        "transition-transform", "duration-200", "ease-standard", "group-hover:translate-x-1",
      );
    }
    for (const link of screen.getAllByRole("link")) {
      if (link !== demoLink && link !== signupLink) expect(link.querySelector("svg")).toBeNull();
    }
  });

  it("gives the Pro pricing card a floating shadow without backdrop layers", () => {
    render(<Page />);
    const proCard = screen.getByRole("heading", { name: "Pro" }).closest("article")!;

    expect(proCard).toHaveClass("bg-surface-dark", "shadow-float");
    expect(proCard.querySelector(".landing-dots, .landing-light")).toBeNull();
  });

  it("reveals the title and card groups of every band after the hero", () => {
    render(<Page />);
    const hero = screen.getByRole("heading", { level: 1 }).closest("section")!;
    expect(hero.querySelector(".reveal")).toBeNull();
    expect(hero).not.toHaveClass("reveal");

    for (const title of [
      "파일 하나로 시작해요", "이렇게 시작해요", "요금",
      "이번 달 카드 지출, 파일 하나로 확인해 보세요",
    ]) {
      const heading = screen.getByRole("heading", { name: title, level: 2 });
      const band = heading.closest("section")!;
      expect(heading.closest(".reveal")).not.toBeNull();
      expect(band.querySelectorAll(".reveal").length).toBeGreaterThanOrEqual(2);
      const groupContent = band.querySelector("article, ol")
        ?? within(band).getByRole("link", { name: "무료로 시작하기" });
      expect(groupContent.closest(".reveal")).not.toBeNull();
    }
    expect(screen.getAllByRole("link").map((link) => link.textContent?.trim())).toEqual([
      "로그인", "데모 보기", "무료로 시작하기", "Pro 시작하기", "무료로 시작하기",
    ]);
  });

  it("explains the three features with icons and closes with the sign-up CTA", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { name: "파일 하나로 시작해요" }))
      .toBeInTheDocument();
    for (const title of ["한 화면에 모든 카드", "확인이 필요한 지출", "연동 없이, 언제든 삭제"]) {
      const heading = screen.getByRole("heading", { name: title, level: 3 });
      expect(heading.closest("article")?.querySelector('svg[aria-hidden="true"]'))
        .not.toBeNull();
    }
    expect(screen.getByText(
      "정기결제로 보이는 결제, 중복 결제 의심, 평소보다 큰 결제를 찾아드려요. 정상 지출일 수도 있어요.",
    )).toBeInTheDocument();
    expect(screen.getByText(
      "계좌나 카드사에 연동하지 않아요. 원본 파일은 암호화해 보관하고, 원할 때 바로 지울 수 있어요.",
    )).toBeInTheDocument();
    expect(screen.getByRole("heading", {
      name: "이번 달 카드 지출, 파일 하나로 확인해 보세요",
    })).toBeInTheDocument();
    expect(screen.getByText("구글 계정으로 시작해요. 카드번호는 받지 않아요."))
      .toBeInTheDocument();
  });

  it("shows how to start in three steps between the features and the pricing", () => {
    render(<Page />);

    const features = screen.getByRole("heading", { name: "파일 하나로 시작해요" });
    const steps = screen.getByRole("heading", { name: "이렇게 시작해요", level: 2 });
    const pricing = screen.getByRole("heading", { name: "요금" });
    expect(features.compareDocumentPosition(steps)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    expect(steps.compareDocumentPosition(pricing)).toBe(Node.DOCUMENT_POSITION_FOLLOWING);

    const list = screen.getByRole("list", { name: "시작하는 순서" });
    const items = within(list).getAllByRole("listitem");
    expect(items).toHaveLength(3);
    [
      ["01", "카드사에서 이용내역 받기",
        "카드사 홈페이지에서 신용카드 이용내역(승인내역)을 엑셀이나 CSV 파일로 받아요. 청구서가 아니라 이용내역이에요."],
      ["02", "파일마다 카드 고르기",
        "‘생활비 카드’처럼 이름을 붙여 카드별로 나눠 봐요. 카드번호는 받지 않아요."],
      ["03", "올리고 확인하기",
        "최근 3개월치를 올리면 총지출·카테고리와 함께 정기결제까지 찾아드려요."],
    ].forEach(([number, title, description], index) => {
      expect(within(items[index]).getByText(number)).toHaveClass("font-mono", "text-primary");
      expect(within(items[index]).getByRole("heading", { name: title, level: 3 }))
        .toBeInTheDocument();
      expect(within(items[index]).getByText(description)).toBeInTheDocument();
    });
  });

  it("shows both plans, the temporary KRW price, and the overseas currency notice", () => {
    render(<Page />);

    expect(screen.getByRole("heading", { name: "요금" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Free" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Pro" })).toBeInTheDocument();
    for (const price of [screen.getByText("0원"), screen.getByText("월 6,900원")]) {
      expect(price).toHaveClass("text-display-md", "tabular-nums");
      expect(price).not.toHaveClass("font-mono");
    }
    expect(screen.getByText("Free로 시작하고, 상세가 필요할 때 Pro로 바꿔요."))
      .toBeInTheDocument();
    for (const feature of [
      "월별 소비 현황", "전월 대비", "확인할 지출 건수와 합계", "월간 요약",
      "Free의 모든 기능", "확인할 지출 상세", "최대 12개월 추세", "더 자세한 월간 요약",
    ]) {
      const item = screen.getByText(feature).closest("li");
      expect(item?.querySelector('svg[aria-hidden="true"]')).not.toBeNull();
    }
    expect(screen.getByText(
      "해외에서는 $4.99/월로 결제돼요. 결제 통화는 결제 화면에서 정해져요.",
    )).toBeInTheDocument();
    expect(renderToStaticMarkup(<Page />)).toContain("월 6,900원");
  });

  it("uses the demo analytics result for the month, total, top three categories, and candidates", () => {
    const { month, snapshot, findings } = demoDashboard();
    render(<Page />);

    expect(screen.getByText(`${formatMonth(month)} 총지출`)).toBeInTheDocument();
    expect(screen.getByText(formatWon(snapshot.total))).toBeInTheDocument();
    const categories = screen.getByRole("list", { name: "예시 상위 카테고리" });
    const rows = within(categories).getAllByRole("listitem");
    expect(rows).toHaveLength(3);
    snapshot.categories.slice(0, 3).forEach(({ category, amount }, index) => {
      expect(rows[index]).toHaveTextContent(CATEGORY_LABELS[category]);
      expect(rows[index]).toHaveTextContent(formatWon(amount));
      expect(rows[index].querySelector("div.bg-primary-on-dark")).not.toBeNull();
    });
    const count = Object.values(findings.byKind).reduce((sum, kind) => sum + kind.count, 0);
    expect(screen.getByText(
      `확인이 필요한 지출 ${count}건 · 후보 합계 ${formatWon(findings.candidateTotal)}`,
    )).toHaveClass("text-amber-200");
    expect(screen.getByText("예시 데이터")).toBeInTheDocument();
  });

  it("keeps mockup numbers tied to buildDashboard when its result changes", () => {
    const dashboard = demoDashboard();
    const changed = {
      ...dashboard,
      month: "2026-08",
      snapshot: {
        ...dashboard.snapshot,
        total: 123_456,
        categories: [
          { category: "education" as const, amount: 80_000, ratio: 0.8 },
          { category: "travel" as const, amount: 20_000, ratio: 0.2 },
          { category: "etc" as const, amount: 3_456, ratio: 0.03 },
        ],
      },
      findings: {
        ...dashboard.findings,
        candidateTotal: 67_890,
        byKind: {
          recurring: { count: 3, amount: 40_000 },
          duplicate: { count: 2, amount: 20_000 },
          large: { count: 1, amount: 7_890 },
        },
      },
    };
    const buildDashboard = vi.spyOn(analytics, "buildDashboard").mockReturnValue(changed);
    render(<Page />);

    expect(buildDashboard).toHaveBeenCalledWith({
      transactions: DEMO_TRANSACTIONS, plan: "pro", today: DEMO_TODAY,
    });
    expect(screen.getByText("2026년 8월 총지출")).toBeInTheDocument();
    expect(screen.getByText("123,456원")).toBeInTheDocument();
    const categories = screen.getByRole("list", { name: "예시 상위 카테고리" });
    expect(within(categories).getByText("교육")).toBeInTheDocument();
    expect(within(categories).getByText("80,000원")).toBeInTheDocument();
    expect(screen.getByText("확인이 필요한 지출 6건 · 후보 합계 67,890원"))
      .toBeInTheDocument();
  });
});
