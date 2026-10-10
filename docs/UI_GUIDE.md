# UI 디자인 가이드

## 디자인 원칙
1. **숫자가 주인공이다.** 합계·금액이 가장 먼저 보이게 한다. 장식보다 정확한 숫자와 그 숫자의 범위(반영 기간)를 우선한다.
2. **신뢰가 먼저다.** 과장하거나 불안을 부추기지 않는다. 확정되지 않은 것은 "후보·의심"이라고 부르고, 데이터가 어디까지인지 숫자 옆에 밝힌다.
3. **도구처럼 보여야 한다.** 마케팅 페이지가 아니라 매달 쓰는 대시보드다. 랜딩도 같은 톤을 쓰고, 실제 화면(데모)을 가장 좋은 설명으로 쓴다.

## AI 슬롭 안티패턴 — 하지 마라
| 금지 사항 | 이유 |
|-----------|------|
| backdrop-filter: blur() | glass morphism은 AI 템플릿의 가장 흔한 징후 |
| gradient-text (배경 그라데이션 텍스트) | AI가 만든 SaaS 랜딩의 1번 특징 |
| "Powered by AI" 배지 | 기능이 아니라 장식. 사용자에게 가치 없음 |
| box-shadow 글로우 애니메이션 | 네온 글로우 = AI 슬롭 |
| 보라/인디고 브랜드 색상 | "AI = 보라색" 클리셰 |
| 모든 카드에 동일한 rounded-2xl | 균일한 둥근 모서리는 템플릿 느낌 |
| 배경 gradient orb (blur-3xl 원형) | 모든 AI 랜딩 페이지에 있는 장식 |
| 잠금 카드를 blur·모자이크로 가리기 | 무엇을 얻는지 안 보여 전환 동기가 약하다. 정적 예시로 보여준다 |
| 숫자 카운트업·차트 진입 애니메이션 | 금액을 읽는 데 방해가 된다 |
| 이모지 아이콘, 빨간 경고 배너 남발 | 금융 화면의 신뢰를 깎는다 |

## 색상
라이트 모드 고정. 무채색 바탕에 포인트 색은 파랑 하나만 쓴다.

### 배경
| 용도 | 값 |
|------|------|
| 페이지 | `bg-neutral-50` |
| 카드 | `bg-white` + `border-neutral-200` |
| 구분선 | `border-neutral-200` |

### 텍스트
| 용도 | 값 |
|------|------|
| 주 텍스트 | `text-neutral-900` |
| 본문 | `text-neutral-700` |
| 보조 | `text-neutral-500` |
| 비활성 | `text-neutral-400` |

### 포인트
| 용도 | 값 |
|------|------|
| 주요 버튼·링크·선택 상태·차트 막대 | `blue-600`, hover `blue-700` |

### 데이터/시맨틱 색상
| 용도 | 값 |
|------|------|
| 지출 증가(전월 대비 +) | `text-red-600` |
| 지출 감소(전월 대비 −) | `text-blue-600` |
| 환불·취소(음수 금액) | `text-neutral-500` + "−" 부호 |
| 확인이 필요한 지출(티저·탐지) | `bg-amber-50 border-amber-200 text-amber-800` |
| 성공(업로드 완료) | `text-emerald-700` |
| 에러(업로드 실패) | `bg-red-50 text-red-700` |
| 중립/기본 | `text-neutral-500` |

- 증가=빨강, 감소=파랑은 국내 금융 관례를 따른다. 색만으로 구분하지 않고 부호와 "늘었어요/줄었어요" 문구를 함께 쓴다.

## 차트 (Recharts)
- **카테고리**: 금액순 가로 막대 목록(카테고리명 · 금액 · 비율). 막대는 `blue-600` 단색. 원형·도넛 차트를 쓰지 않고, 카테고리별 색 팔레트를 만들지 않는다.
- **일별**: 세로 막대, `blue-600` 단색.
- **추세(Pro)**: 월별 세로 막대. 진행 중인 달은 `neutral-300` + "진행 중" 라벨.
- 축 금액은 "120만"처럼 만 단위로 줄이고, 툴팁은 원 단위 전체 금액을 보여준다.
- 가로 그리드선만 `neutral-100`. 단색이므로 범례를 두지 않는다. `isAnimationActive={false}`.

## 컴포넌트
### 카드
```
rounded-lg border border-neutral-200 bg-white p-5
제목: text-sm font-medium text-neutral-500
큰 숫자: text-3xl font-semibold tabular-nums text-neutral-900
```

### 버튼
```
Primary:     rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:bg-neutral-300
Secondary:   rounded-md border border-neutral-300 bg-white px-4 py-2 text-sm text-neutral-700 hover:bg-neutral-50
Text:        text-sm text-neutral-500 hover:text-neutral-900 hover:underline
Destructive: rounded-md border border-red-200 bg-white px-4 py-2 text-sm text-red-700 hover:bg-red-50  (항상 확인 단계를 거친다)
```

### 입력 필드
```
rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm
focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600
```

### 월 요약 (Free)
- 요약 본문 아래에 보조 문구 "Pro에서는 확인할 지출 상세와 여러 달 추세까지 요약해요"와 Text 버튼 "Pro로 보기"를 둔다(upgrade source `summary`).

### 잠금 카드 (Free의 추세)
```
rounded-lg border border-dashed border-neutral-300 bg-white p-5
```
- 정적 예시(가짜 수치임을 밝힌 작은 예시)와 한 줄 설명, "Pro로 보기" Primary 버튼. 사용자의 실제 데이터를 가리는 방식으로 만들지 않는다.

### 후보 지출 티저 (Free)
- amber 박스에 종류별 건수·금액과 `candidateTotal`. 보조 문구 "정상 지출일 수 있어요. 상세에서 확인해 보세요."

### 업로드 상태 행
- 파일명(말줄임) · 카드 라벨 · 상태 텍스트(대기 / 올리는 중 / 분석 중 / 확인 필요 / 완료 / 실패) · 결과 요약 한 줄. 실패 행에는 원인과 다음 행동 버튼. 확인 필요 행에는 "열 확인하기" Primary 버튼.

### 매핑 확인 (처음 보는 형식)
- 제안된 열(이용일 · 가맹점 · 금액 · 승인번호 · 취소 표시)을 원래 열 이름과 함께 보여준다. 고칠 수는 없다.
- 아래에 매핑을 적용한 처음 5행 미리보기 표(금액 오른쪽 정렬, `tabular-nums`).
- 문구: "처음 보는 형식이에요. 열이 맞는지 확인해 주세요." · Primary "이대로 읽기" · Text "취소".

### 카테고리 수정
- 카테고리 목록·Top N의 가맹점 행에서 카테고리를 select(고정 14개)로 바꾼다. 바꾸면 바로 저장하고 숫자를 다시 그린다.
- 보조 문구 "같은 가맹점의 모든 거래에 적용돼요".

### 모달 (업그레이드·삭제·탈퇴 확인)
```
오버레이: fixed inset-0 bg-black/40   (blur 금지)
패널:     rounded-lg bg-white p-6 max-w-md w-full
```

### mock 배너
```
bg-amber-50 border-b border-amber-200 px-4 py-2 text-sm text-amber-900
"테스트 모드: AI 분석과 결제는 모의로 동작합니다"
```

## 레이아웃
- 전체 너비: `max-w-5xl mx-auto px-4 sm:px-6`
- 정렬: 좌측 정렬 기본(랜딩 포함). 중앙 정렬은 모달과 빈 상태에만 쓴다.
- 모바일 우선: 기본 1열, `md:` 이상에서 KPI·차트를 2열 그리드로.
- 간격: 카드 사이 `gap-4`, 섹션 사이 `space-y-8`.
- 대시보드 상단: 월 선택기 · 반영 기간 · "새 명세서 추가" 버튼을 한 줄에.

## 타이포그래피
- 글꼴은 시스템 글꼴 스택(`-apple-system, BlinkMacSystemFont, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif`)을 쓰고 웹폰트를 추가하지 않는다.
- 금액·날짜·건수에는 `tabular-nums`.

| 용도 | 스타일 |
|------|--------|
| 페이지 제목 | `text-2xl font-semibold text-neutral-900` |
| 섹션 제목 | `text-lg font-semibold text-neutral-900` |
| 카드 제목 | `text-sm font-medium text-neutral-500` |
| 큰 숫자 | `text-3xl font-semibold tabular-nums text-neutral-900` |
| 본문 | `text-sm text-neutral-700 leading-relaxed` |
| 보조 | `text-xs text-neutral-500` |

## 숫자 · 날짜 표기
- 금액: `1,234,000원`(`Intl.NumberFormat('ko-KR')`). 음수는 `−12,000원`. 만 단위 축약은 차트 축에만 쓴다.
- 전월 대비: `+123,000원 늘었어요` / `−45,000원 줄었어요`. 비교할 수 없으면 표시하지 않는다.
- 가격: 랜딩·모달은 `월 N원`(KRW). 결제 화면 통화는 Polar가 고객 위치로 정한다(해외는 `$4.99/월`).
- 날짜: `9월 15일`, 기간 `9/15~9/30`, 월 `2026년 9월`.

## 문구
- 해요체로 짧게 쓴다.
- "확인이 필요한 지출", "중복 결제 의심", "정기결제로 보여요"처럼 쓴다. "절약할 수 있어요", "낭비", "부정 결제", "AI가 분석했어요" 같은 표현은 쓰지 않는다.
- 에러는 원인과 다음 행동을 함께 쓴다(예: "청구서 대신 이용내역을 받아 주세요"). 문구는 `lib/errors/messages.ts`에서 관리한다.
- 빈 상태는 무엇을 하면 되는지 한 문장과 버튼 하나.

## 애니메이션
- 허용: 로딩 스켈레톤 `animate-pulse`(Suspense fallback), 처리 중 작은 스피너 `animate-spin`, hover 색 전환 `transition-colors`.
- 그 외 모든 애니메이션 금지.

## 아이콘
- SVG 인라인, `strokeWidth 1.5`, 16~20px, `currentColor`. 아이콘 라이브러리를 추가하지 않는다.
- 아이콘 컨테이너(둥근 배경 박스)로 감싸지 않는다.

## 접근성
- 색만으로 의미를 전달하지 않는다(부호·문구 병기).
- 버튼·입력에는 보이는 포커스 링을 둔다. 차트 수치는 텍스트로도 제공한다(카테고리 목록이 그 역할을 한다).
