# assetomy MVP 계획 (설계 검토 반영: 2026-10-10)

> 이 문서는 프로젝트 루트의 `plan.md`에 저장되어 있다. 이번 수정은 계획 검토 결과를 반영한다. docs 작성, 설정 수정, phase 생성과 앱 구현은 이후 지시에 따라 진행한다.

## Context
한국 사용자가 **카드사 이용내역 파일**(CSV/xlsx, 신용카드만 지원)을 올리면, 코드로 읽고 Claude API로 분류·요약해 소비 현황과 **확인이 필요한 지출 후보**를 보여주는 핀테크 SaaS를 만든다. 한 파일은 한 카드의 내역이어야 하며 카드별로 구분해 합산한다. MVP는 **랜딩 → 데모 → 로그인 → 대시보드 → 결제 → 배포**까지 한 사이클을 완주하고, 핵심 가설을 검증할 지표를 확보하는 것이 목표다. 실제 절감액 계산과 카드 추천은 배포 후 다시 기획한다.

## MVP 단순화 검수 결과
원칙: **"없으면 돈 계산이 틀리거나, 데이터가 유실되거나, 남의 데이터가 보이는가?"** 이 질문에 아니라고 답할 수 있으면 뺀다.

### 검수 후 결정 (20개)
| # | 검토 항목 | 적용 결정 | 근거 |
|---|---|---|---|
| 1 | 범용 `events` 테이블 | Vercel Analytics + `user_metrics` · `upload_attempts`의 최소 이력 | 첫 시도·성공·결제 연결과 삭제 전 결과는 DB에 남겨야 지표의 분모가 보존된다 |
| 2 | `file_hash`와 거래 fingerprint | 서버 계산 `file_hash`를 사용자 전체 카드에서 검사. 거래는 카드와 거래별 식별자를 포함하며, 식별자를 제공하는 형식만 지원 | 파일 내 순번으로는 서로 다른 파일의 동일 거래를 판정할 수 없다. 같은 파일을 다른 카드로 올려도 이중 집계하지 않는다 |
| 3 | 실패 상태·재시도·오래된 처리 | `pending/processing/done/no_new/failed`, 처리 lease. 만료된 처리는 failed로 종료하고 재업로드 | RPC 결과가 불확실하면 보존한다. 확정 실패와 lease 만료만 failed로 종료하며 자동 재claim은 하지 않는다 |
| 4 | 월 전체 커버리지 판정 | 월별 **"거래일 범위 9/15~9/30" 표시**, 진행 중인 달 전월 대비 숨김. 연도 없는 파일의 다운로드 기간은 입력으로 받음 | 최소·최대 거래일이 월 전체 커버리지를 보장하지 않음을 명시하며 날짜 연도를 추측하지 않는다 |
| 5 | SkipBreakdown 6종 | `skipped: number` 하나 | 결과 카드에 "제외 n건"이면 충분하다 |
| 6 | 에러 코드 19개 | 업로드 코드 5개 + HTTP 상태 | 사용자 메시지가 같은 코드들을 통합했다 |
| 7 | LLM 컬럼 매핑 | 없음. 지원 형식은 코드 규칙으로 읽음 | 지원 형식은 코드로 판정하고 검증 안 된 형식은 어차피 거절한다. 매핑 단계 실패와 외부 전송 범위가 줄어든다 |
| 8 | Origin 검사, JSON content-type 강제 | 세션을 사용하는 POST/DELETE에서 허용 Origin 검사, JSON POST의 content-type 강제 | 업로드와 결제 요청도 상태를 변경하고 비용을 발생시킨다. 웹훅은 별도 서명 검증 |
| 9 | 결제 동기화 순서 방지 | 현재 상태 재조회 + 조회 시작 시각 조건부 저장 | 먼저 시작한 조회가 늦게 도착해도 최신 상태를 덮어쓰지 않는다. lease와 세대 번호는 필요 없다 |
| 10 | 남용 상한 | 서버에서 사용자당 동시 처리 2개, 최근 24시간 업로드 시도 30개 + 전역 지출 한도 | 전역 한도만으로는 한 사용자가 다른 사용자의 분석 예산까지 소진하는 것을 막지 못한다 |
| 11 | `/api/summary` 라우트 | 대시보드 서버 컴포넌트에서 직접 생성(Suspense, B1의 쓰기 예외) | 라우트와 클라이언트 fetch가 필요 없다. 동시 요청의 중복 생성은 비용만 조금 늘고 저장은 하나로 수렴하므로 허용한다 |
| 12 | 처리 중 업로드 삭제 | DB 행 잠금 아래 업로드 행과 거래를 즉시 삭제 | 늦게 도착한 ingest 커밋은 업로드 행이 없어 거절된다 |
| 13 | 전체 삭제 시 Storage 폴더 페이지네이션 | 즉시 삭제 시도 + 정기 고아 파일 정리 하나 | 업로드 행은 URL 발급 전에 커밋되므로 행이 없는 파일은 언제 지워도 안전하다. 늦게 도착한 파일과 Storage 삭제 실패를 같은 정리로 처리한다 |
| 14 | 드문 인코딩·개별 에러 코드 | UTF-16 지원은 제외, 오류 코드는 통합. 셀·파일명 입력 길이 제한은 유지 | 이스케이프는 XSS를 막지만 메모리·LLM 입력 비용 상한을 대신하지 못한다 |
| 15 | Preview 환경 | **Preview = mock 환경(step마다 자동 배포), Production = 실제** (B13) | 키 없이도 step마다 화면을 확인하고, Production은 구조적으로 mock이 될 수 없게 한다 |
| 16 | step 13개(dashboard-model 별도) | **15개**(dashboard-model은 흡수, 큰 step 3개는 레이어별로 분할) | 게이팅은 analytics(순수), 로더는 dashboard-view로 흡수. 한 step은 한 레이어만 다룬다 |
| 17 | `documentType` 3값 | 코드의 청구서 판별(boolean) | 필요한 판단은 청구서인지 아닌지 하나뿐이다 |
| 18 | 데이터 없는 월은 가장 가까운 월로 리다이렉트 | 기본 월(최근 데이터 월)로 대체 | |
| 19 | "이 달에 반영된 파일 n개" | 제거 | 거래일 범위와 일부 카드/기간 비교 주의 안내로 단순화 |
| 20 | Storage 정책 테스트 | 사용자 Storage 정책 없음 + 실제 Storage 통합 테스트 | 직접 Storage 호출 거부와, 삭제 후 signed URL로 늦게 전송된 파일의 정리까지 확인해야 한다 |

### 복잡해 보여도 남긴 것
| 항목 | 빼면 생기는 일 |
|---|---|
| Storage signed URL 직접 업로드 | Vercel 4.5MB 본문 제한에 걸려 큰 파일이 실패한다(대안 없음) |
| `ingest_upload` RPC(거래 insert와 상태 갱신을 한 트랜잭션으로) | 둘 사이에서 실패한 뒤 재처리하면 "0건 → 업로드 삭제"가 실행돼 **거래가 cascade로 유실**된다 |
| 원자적 claim(`pending → processing` 조건부 update) | 동시 이중 처리에서도 같은 이유로 유실된다 |
| plan별 DTO 유니온 | Server→Client props는 RSC payload로 그대로 노출돼 Free에 상세가 새어 나간다 |
| `.range()` 페이지네이션 | 1000행을 넘으면 잘려도 에러가 없어 **집계가 조용히 틀린다** |
| 카드 식별자·취소 형식별 규칙·파일 해시 | 여러 카드, 월을 넘긴 환불, 상태가 바뀐 재다운로드에서 금액이 틀릴 수 있다 |
| success 페이지에서 Polar 직접 조회 | 웹훅이 실패하면 결제한 사용자가 Free로 남는다 |
| 보호 페이지·핸들러에서 `getClaims()` 재확인 | proxy만 믿으면 권한 검사가 우회될 수 있다 |
| 커밋 결과 조회·고아 파일 정리 | 응답 유실을 실패로 오인해 완료 거래를 지우거나, 삭제 후 늦게 도착한 파일을 놓칠 수 있다 |
| 탐지 임계값(교통 제외, 1만 원 이상, 표본 20건) | 오탐이 신뢰를 깎고 Pro 전환 메시지를 망친다 |

---

# Part A. 제품 · 사용자 여정

## A1. 포지셔닝 · 페르소나
> **"계좌 연동 없이, 카드 이용내역 파일만으로 확인할 지출을 찾아준다."**

| | P1. 월말 현타형 직장인 | P2. 구독 정리형 |
|---|---|---|
| 상황 | 카드 2~3장, "이번 달 왜 이렇게 많이 썼지?" | "뭐가 매달 빠져나가는지 모르겠다" |
| 원하는 것 | 흩어진 카드 지출을 한 화면에서 | 잊고 있던 정기결제를 찾아 끊기 |
| 역할 | Free 활성화 | Pro 전환의 핵심 타깃 |

## A2. 가설 · 지표
| ID | 가설 | 분자 / 분모 · 관찰 기간 | 측정 | 초기 목표 |
|---|---|---|---|---|
| H1 가치 | "연동 없이 파일만으로"에 반응한다 | 랜딩의 데모 클릭 방문자 / 랜딩 방문자, 동일 일자 기준 주간 집계 | 페이지뷰 + `demo_click`. 로그인 진입도 별도 집계 | 방문자 100명 이상에서 데모 클릭률 20% 이상 |
| H2 마찰 | 첫 업로드가 활성화의 주요 마찰이다 | 첫 서버 업로드 시도 후 24시간 내 거래 저장에 성공한 사용자 / 첫 시도 사용자 | `user_metrics`의 첫 시도·첫 성공, `upload_attempts`의 단계·결과·코드 | 관찰 완료 사용자 30명 이상에서 성공률 80% 이상 |
| H3 전환 | 후보 지출 티저와 추세가 결제 동기다 | 첫 업그레이드 클릭 후 7일 내 첫 실결제 사용자 / 첫 클릭 사용자, source별 집계. 티저 노출→클릭률도 별도 측정 | `user_metrics`의 노출·첫 클릭·source·첫 결제. Polar production의 active Pro 첫 확인(B8) | 관찰 완료 클릭 사용자 100명 이상에서 전환율 5% 이상 |
| H4 습관 | 명세서 주기에 맞춰 재방문한다 | 첫 성공 후 30~45일에 기존 최종 거래일보다 뒤의 거래를 추가한 사용자 / 첫 성공 후 45일이 지난 사용자 | 삭제와 독립적인 `upload_attempts` 완료 이력과 `extends_period` | 관찰 완료 사용자 30명 이상에서 20% 이상 |
| H5 신뢰 | 해석이 정확해야 계속 쓴다 | 성공 24시간 내 사용자 삭제 업로드 / 24시간 관찰 완료 성공 업로드. UNREADABLE / 파싱 단계에 도달한 업로드 | `upload_attempts`의 완료·삭제 시각·실패 단계 | 각 분모 30건 이상에서 두 비율 각각 10% 이하 |

- 목표치는 초기 운영 가설이다. 관찰 기간과 최소 표본이 채워지기 전에는 성공·실패를 단정하지 않고, 변경 시 적용일과 이유를 남긴다.
- Vercel의 페이지뷰·커스텀 이벤트는 탐색용 집계로 사용한다. 기본 방문자 식별이 24시간 후 폐기되므로 여러 날에 걸친 사용자 전환·재방문은 DB 이력으로 측정한다. [Vercel 공식 문서](https://vercel.com/docs/analytics/privacy-policy)
- `user_metrics`는 첫 시도·첫 성공·티저 노출·첫 업그레이드 클릭과 source·첫 실결제만 저장한다. source는 `teaser/trend/summary/pricing/settings` 허용목록이며 **첫 클릭 기준 귀속**으로 고정한다. 첫 클릭이 없으면 `direct`로 기록한다. H3의 클릭 분모는 클릭 당시 Free 사용자이고, 결제 시각은 해당 클릭 이후여야 한다.
- `upload_attempts`는 업로드 생성부터 URL 발급·파일 전송·파싱·저장·사용자 삭제 결과를 남긴다. 재처리는 같은 attempt를 갱신하고 새 로컬 재업로드는 새 attempt이다. no_new는 첫 활성화 성공으로 세지 않는다.
- 거래·파일명·가맹점·카드번호를 Analytics나 측정 이력에 넣지 않는다. 전체 데이터 삭제 시 사용자별 측정 이력도 삭제하며 삭제 이전 관찰은 DB 코호트에서 제외한다. 이후 새로 업로드하면 새 데이터 세대의 코호트로 관찰한다.

## A3. 유스케이스
| UC | 시나리오 | 성공 조건 |
|---|---|---|
| 01 데모 | 랜딩 → 데모(Pro 포함 공개) | 로그인 없이 가치 이해 |
| 02 가입 | 구글 로그인 | 1클릭, `next` 복귀 |
| 03 첫 업로드 | 카드 2장 × 3개월 xlsx 6개 선택, 파일별 카드 지정 | 두 카드의 같은 날·가맹점·금액 거래도 각각 보존, 합계 일치 |
| 04 파일 구하기 | 카드사별 "이용내역 엑셀 다운로드" 가이드 | 경로를 찾음 |
| 05 실패 복구 | 파일 문제 → 안내 / 처리 결과 불명확 → 같은 업로드 상태 확인 / 확정 실패 → 재업로드 | 완료 거래를 지우지 않고 다음 행동이 명확 |
| 06 중복 업로드 | 같은 파일, 겹치는 기간, 같은 파일을 다른 카드로 | 같은 파일은 "이미 올린 내역", 겹치는 거래는 거래 식별자로 중복 제외. 다른 카드로 올린 같은 파일은 기존 카드를 안내하고 이중 집계하지 않음 |
| 07 잘못 올림 취소 | 결과 카드에서 "틀렸어요" | 해당 업로드가 최초 저장한 거래를 삭제, 겹침 파일에 미치는 영향과 재업로드 복구 안내 |
| 08 월별 스냅샷 | 월 선택 → 총지출·카테고리·Top N·일별 + 반영 기간 | 원본 합계와 일치 |
| 09 후보 지출 티저 → 전환 | 티저 → Pro 결제 → 상세 | 결제 확인 직후 해제, 후보 금액을 절감 보장액으로 표시하지 않음 |
| 10 여러 달 추세(Pro) | 월별 추이, 카테고리 변화 | 2개월 이상에서 표시 |
| 11 월간 재방문 | 다음 달 파일 추가 | 새 거래만 반영 |
| 12 구독 해지 | Polar 포털 | 기간 종료 후 Free |
| 13 전체 삭제 | 설정에서 전체 삭제 | DB의 소비 데이터는 즉시 삭제. 원본은 즉시 삭제하고, 남은 파일과 늦게 도착한 파일은 정기 정리로 비워짐 |

## A4. 여정 맵
| 단계 | 사용자 생각 | 화면 | 설계 포인트 | 이탈 위험 |
|---|---|---|---|---|
| 인지 | "내 금융정보 넘겨도 되나" | `/` | 연동 없음, 언제든 삭제, 데모 1클릭 | 신뢰 |
| 데모 | "내 데이터로 보면?" | `/demo` | 실제와 같은 화면 | 와닿지 않음 |
| 가입 | "귀찮은 건 싫다" | `/login` | 구글 1클릭 | - |
| 활성화 | "어디서 받지? 제대로 읽히나?" | 빈 대시보드 | 가이드, 멀티 업로드, 결과 카드 | 파일 못 구함 |
| aha | "어떤 지출을 확인해야 하지?" | `/dashboard` | 합계 일치, 후보 지출 티저 | 숫자 불신 |
| 전환 | "상세 내역을 보고 정리할까?" | 모달 → Polar | 확인 가능한 상세 예시와 $4.99/월 | USD 거부감 |
| 습관 | "이번 달은 줄었나?" | `/dashboard` | 반영 기간, 전월 대비 | 잊음 |

## A5. 기능 노출 매트릭스
| 기능 | 데모 | Free | Pro |
|---|---|---|---|
| 월별 스냅샷(월 선택, 총지출·카테고리·Top N·일별, 반영 기간) | ✓ | ✓ | ✓ |
| 전월 대비 총액(진행 중인 달 제외) | ✓ | ✓ | ✓ |
| 정기결제 · 중복결제 · 고액결제 탐지 | 상세 | **건수 · 합계만** | 상세 |
| 여러 달 누적 추세 | ✓ | 잠금 카드 | ✓ |
| AI 월간 요약 | 고정 텍스트 | 잠금 카드 | ✓ |
| 업로드 · 원본 보관 · 삭제 | ✗ | ✓ | ✓ |

잠금 카드는 blur 없이 설명과 정적 예시로 만든다. 탐지가 0건이면 "이번 규칙으로 확인할 지출 후보가 발견되지 않았어요"를 보여준다. 정기결제·중복 의심·고액 결제는 정상 지출일 수 있으며 실제 절감액을 뜻하지 않는다.

- 티저는 종류별 건수·금액과 후보 거래를 한 번씩만 센 `candidateTotal`을 표시한다. 동일 거래가 여러 탐지에 걸려도 통합 금액에는 중복 합산하지 않는다. 정기결제 금액은 선택 월의 결제액으로 표시한다.
- 분석 결과에는 "확인이 필요한 지출" · "중복 결제 의심" 등의 표현을 사용한다. 월 요약도 절감 보장이나 부정 결제 확정 표현을 쓰지 않는다.
- 공통 운영 한도는 최근 24시간 업로드 시도 30개, 사용자당 동시 처리 2개다. 선택 화면에 안내하며 서버에서도 강제한다. 원본은 삭제 요청까지 보관한다.

## A6. User Flow

### ① 진입 · 인증 · 분기
```
(검색 · SNS · 지인 공유)
  │
  ▼
[랜딩 /]
  ├─▶ "데모 보기"
  │     └─▶ [데모 대시보드 /demo]  · 정적 fixture, DB·LLM 호출 없음
  │           └─▶ "내 명세서로 해보기" ─▶ (A)
  ├─▶ "무료로 시작하기" ─▶ (A)
  └─▶ 가격 섹션 "Pro 시작하기" ─▶ (A) ─▶ ③

(A) 인증 게이트
  <로그인 되어 있나?>
  ├─ 예 ─▶ (B)
  └─ 아니오
        └─▶ [/login] ─▶ 구글 OAuth ─▶ [/auth/callback] ─▶ (B)
              · next는 내부 경로만 허용("/"로 시작, "//"와 "\" 금지)
              · 동의 취소 · 교환 실패 ─▶ /login?error + 안내

(B) 대시보드 진입
  <저장된 거래가 있나?>
  ├─ 없음 ─▶ [빈 대시보드: 온보딩] ─▶ ②
  └─ 있음 ─▶ [/dashboard?month=최근 데이터 월] ─▶ ④
```

### ② 첫 업로드 → aha
```
[빈 대시보드: 온보딩]
  · "최근 3개월치 카드 이용내역을 올리면 정기결제와 확인할 지출을 찾아드려요"
  · 카드사별 가이드: "청구서 말고 신용카드 이용내역(승인내역) 엑셀"
  · 고지: "분석을 위해 가맹점명과 집계 결과가 AI 서비스로 전송됩니다"
  │
  ▼
[파일 선택] 여러 개 · .csv/.xlsx · 파일당 10MB · 파일마다 카드 선택/등록
  · 카드 전체 번호 입력 없음. "신한 생활비" 등 사용자 라벨로 같은 카드를 계속 선택
  · 여러 카드가 섞인 파일은 카드별로 다시 다운로드하도록 안내
  · 연도 없는 날짜는 파일의 다운로드 기간 확인/입력 안내(12→1월 포함)
  │
  ▼
<브라우저 검사: 확장자 · 용량>  (UX용, 실제 제한은 버킷 정책)
  ├─ 불통과 ─▶ 해당 파일만 제외
  └─ 통과
        │
        ▼
     [파일별 처리] 동시 2개 · 파일마다 상태 표시
        URL 발급 ─▶ Storage 직접 업로드 ─▶ 처리 요청
        │
        ▼
     <파일별 결과>
        ├─ 성공 ─▶ [결과 요약 카드]
        │            "신한카드_9월.xlsx · 42건 · 9/1~9/30 · 지출 1,234,000원 · 중복 3건 · 제외 2건"
        │            └─▶ "틀렸어요" ─▶ 이 업로드만 삭제
        ├─ 같은 파일·모든 거래가 검증된 중복 ─▶ "이미 올린 내역이에요" (다른 카드였다면 기존 카드 안내)
        ├─ 처리 결과 불명확 ─▶ "처리 상태를 확인하고 있어요" + 동일 uploadId 상태 조회
        ├─ 확정된 일시 장애 ─▶ "잠시 후 다시 시도해 주세요" + [다시 시도] (같은 파일로 새 업로드)
        └─ 파일 문제 ─▶ 원인별 안내 + 가이드 링크
                          · BILLING_STATEMENT ─▶ "청구서 대신 이용내역을 받아 주세요"
                          · UNSUPPORTED_FILE · UNREADABLE ─▶ 원본·지원 형식·취소 해석 문제에 맞는 다음 행동
                          · FILE_TOO_LARGE ─▶ "기간을 나눠서 받아 주세요"

(모든 파일 처리 완료)
  │
  ▼
[대시보드: 최근 데이터 월 스냅샷]  ◀ aha
  · 총지출 · 카테고리 · Top N · 일별 · 반영 기간 · 전월 대비(진행 중인 달 제외)
  · 후보 지출 티저(Free) ─▶ ③   · 추세 잠금 카드(2개월 이상) ─▶ ③
  · 2개월 미만: "한 달치만 더 올리면 정기결제를 찾아드려요"
```

### ③ Pro 전환
```
진입점 (upgrade_click.source): teaser · trend · summary · pricing · settings
  │
  ▼
[업그레이드 모달] 확인할 지출 후보와 상세 예시 + $4.99/월
  │ "결제하기"
  ▼
[POST /api/checkout] JSON { source } · Origin 검사
  ├─ 이미 Pro ─▶ 포털로 리다이렉트
  └─ Free ─▶ external_customer_id = 세션 user.id
        │
        ▼
     [Polar Checkout]
        ├─ 취소 ─▶ 원래 화면
        └─ 결제 완료 ─▶ [/dashboard?checkout=success]
              · syncFromPolar(user.id): 조회 시작 시각 기록 → Polar 상태 조회 → 더 늦게 시작한 조회 결과가 없을 때만 subscriptions 갱신
              ├─ Pro 확인 ─▶ "Pro가 활성화됐어요"
              └─ 미반영 ─▶ "결제 반영 중…" + 새로고침 안내

(병렬) Polar ─ customer.state_changed ─▶ /api/webhooks/polar ─▶ 서명 검증 ─▶ syncFromPolar(external_id)
```

### ④ 월간 재방문
```
[/dashboard] "2026년 9월까지 반영됨" · 월 선택기(월마다 반영 기간 표시)
  │
  ▼
"새 명세서 추가" ─▶ ②의 [파일별 처리]
  │
  ▼
[갱신]
  ├─ 전월 대비 · (Pro) 추세에 새 달 반영
  ├─ (Free) 티저 갱신 ─▶ ③
  └─ (Pro) AI 요약: 그 달의 입력 해시가 바뀌었을 때만 재생성
```

### ⑤ 설정 · 데이터 관리
```
[/settings]
  ├─ 플랜
  │     ├─ Free ─▶ "업그레이드" ─▶ ③
  │     └─ Pro ─▶ "구독 관리" ─▶ Polar 포털 (해지 예약 시 "YYYY-MM-DD까지 Pro")
  ├─ 업로드 내역(done만)
  │     └─ "삭제" ─▶ 확인(최초 저장한 거래와 겹침 파일의 영향 고지)
  │                   └─▶ 업로드·거래 즉시 삭제 ─▶ 원본 삭제 시도 ─▶ "삭제 완료"
  └─ "내 데이터 전체 삭제" ─▶ 확인 문구 입력
        └─▶ 데이터 세대 증가·거래·요약·업로드·카드·사용자 측정 이력을 한 트랜잭션으로 삭제
              └─▶ 원본 삭제 시도 ─▶ "삭제 완료"
                    (남은 파일과 늦게 도착한 파일은 5분 주기 정기 정리가 삭제)
```

---

# Part B. 아키텍처

## B1. 핵심 설계 결정
| 결정 | 이유 | 트레이드오프 |
|---|---|---|
| 신용카드 이용내역만 받는다(체크카드·은행·청구서 제외) | 은행과 섞으면 이중 집계되고, 청구서는 할부 회차가 정기결제로 오탐된다. 체크카드는 MVP에서 지원하지 않는다 | 지원 범위가 좁다 |
| 파싱은 코드만(검증된 카드사 프로필 규칙), LLM은 가맹점 분류와 요약만 | 지원 형식은 코드로 판정하고 검증 안 된 형식은 거절한다. 금액 환각이 없고 외부로 보내는 데이터가 가맹점명과 집계뿐이다 | 새 카드사 형식마다 프로필 코드와 fixture가 필요하다 |
| 원본 파일과 정규화 거래를 모두 저장 | 재방문, 누적, 고도화 기반 | 민감 데이터 보관 책임 |
| 카드 지정 + 거래별 식별자 + 파일 해시 | 카드 간 충돌을 막고 실제 동일 거래만 중복 제거. 같은 파일은 카드와 관계없이 한 번만 반영 | 거래별 식별자를 제공하지 않는 카드사 형식은 지원하지 않는다 |
| 브라우저 → Storage 직접 업로드 | Vercel 4.5MB 제한 | 요청이 3번 오간다 |
| 읽기는 Server Component, 쓰기는 Route Handler | 병렬 업로드, 웹훅과 패턴 통일, 테스트 용이 | 예외 2개: 대시보드 렌더 중 AI 요약 생성·저장, 오래된 결제 상태 보완 동기화. 둘 다 서버 저장소 함수로 쓰며 동시 요청의 중복 호출은 허용한다 |
| 게이팅은 `buildDashboard`의 DTO 유니온 한 곳에서 | RSC payload 노출 방지 | - |
| Polar 상태 재조회 + 조회 시작 시각 조건부 저장 | 웹훅 재전송과 success 페이지 경합에서도 먼저 시작한 조회가 최신 상태를 덮어쓰지 않음 | 늦게 시작한 조회가 더 최신이라고 간주한다 |
| 탐지는 규칙 기반 코드, LLM은 요약만 | 결정적이고 테스트 가능 | 정교함이 제한적이다 |
| 사용자 읽기는 RLS, 쓰기는 검증된 서버 저장소 함수 | 직접 DB·Storage 쓰기로 업로드 상태와 삭제 정리를 우회하지 못하게 함 | service-role 사용 범위가 서버 쓰기까지 확대되므로 각 함수의 소유권 검증과 테스트가 필수다 |
| DB는 즉시 삭제, 원본은 즉시 삭제 시도 + 정기 고아 정리 | 삭제 후 signed URL로 늦게 도착한 파일과 Storage 장애를 같은 정리로 처리 | 남은 원본은 다음 정리(5분 주기)까지 Storage에 있다 |

## B2. 테크 스펙
| 영역 | 선택 |
|---|---|
| 런타임 · 호스팅 | Node.js LTS(24.x), Vercel(mock·Preview 단계는 Hobby, **실결제 공개 시점부터 Pro**: 결제 사이트는 Hobby 불가), 함수 리전 `icn1`, Vercel CLI 배포(B13) |
| 프레임워크 | Next.js 16.x, 호환 React 19.x, TS strict, `proxy.ts`, `eslint .`. 개발 시 최신 안정 버전·lockfile 고정, 공개 배포 전 보안 패치 재확인 |
| 스타일 · 차트 | Tailwind CSS v4(라이트 고정), Recharts |
| 인증 · DB · 파일 | Supabase(**Seoul 리전**), `@supabase/supabase-js`, `@supabase/ssr`(`getClaims()`, publishable/secret 키), CLI(로컬은 Docker) |
| LLM | `@anthropic-ai/sdk`, `claude-opus-5-5`(가맹점 분류·월 요약), structured outputs + `zodOutputFormat()`, timeout 60s |
| 결제 | `@polar-sh/nextjs`, `@polar-sh/sdk`(sandbox로 시작) |
| 파싱 | `papaparse`, SheetJS(**CDN tarball**: npm 버전은 CVE 미패치, `sheetRows` 상한), `TextDecoder`(UTF-8 → EUC-KR) |
| 검증 · 테스트 · 측정 | zod / Vitest(단위 `npm test`, 로컬 Supabase 통합 `npm run test:db`), Testing Library, pgTAP / `@vercel/analytics`(페이지뷰와 커스텀 이벤트) |
| 정기 작업 | Vercel Cron → 서버 인증된 내부 핸들러. 만료 pending·processing의 failed 종료와 Storage 고아 파일 정리, 실행당 처리 상한 적용 |

2026-10-10 기준 Next.js의 2026-10-14 보안 업데이트는 **예정** 상태다. 개발 시작과 공개 배포 조건을 구분한다. 패치 공개 후 영향 버전과 권고를 확인하고, 적용한 정확한 Next.js·React 버전과 lockfile을 배포 기록에 남긴다. [Next.js 공식 공지](https://nextjs.org/blog/upcoming-nextjs-security-update-october-2026)

지원 카드사/다운로드 형식은 익명화한 실제 fixture로 검증된 신용카드 이용내역 2종부터 시작한다. 모든 거래 행에 승인번호 등 거래별 식별자가 있는 형식만 고른다. 프로필로 판정되지 않거나 취소 의미·거래 식별자를 검증하지 못한 형식은 UNREADABLE(`unsupported_profile`)로 거절한다. 확장자·MIME·시그니처 규칙은 확보한 실제 파일의 형식(.xls 여부 포함)을 확인한 뒤 확정한다.

## B3. 시스템 구성
```
[Browser]
  ├─ 페이지 · API ──────────────▶ [Next.js @ Vercel icn1]
  ├─ 파일 PUT(signed URL) ──────▶ [Supabase Storage: statements (private, Seoul)]
  └─ 결제 ──────────────────────▶ [Polar Checkout]

[Next.js]
  ├─ proxy.ts: 세션 갱신만 (권한 판단은 각 페이지·핸들러에서 getClaims로 다시)
  ├─ Server Components ─▶ lib/queries · lib/analytics ─▶ [Postgres] (사용자 세션 + RLS)
  ├─ app/api/* ─▶ lib/ingest ─▶ services/llm ─▶ [Anthropic, 국외]
  ├─ app/api/checkout · portal ─▶ services/polar ─▶ [Polar, 국외]
  ├─ /api/webhooks/polar ◀── [Polar] (서명 검증 → 결제 동기화)
  └─ /api/internal/maintenance ◀── [Vercel Cron] (CRON_SECRET 검증)
       · service-role은 server-only 저장소 함수 안에서 쓰기·signed URL 발급·정리에만 사용
```

## B4. 레이어 규칙
```
app/          보호 경로 requireUser(getClaims) → Origin/입력 검증 → lib 호출 → HTTP 매핑
  ▼
lib/          parsing · analytics(순수) / ingest · billing · queries(I/O, 의존성 주입)
  ▼
services/     llm · polar ('server-only')      lib/supabase  server · browser · admin
  ▼
types/        도메인 타입 · 에러 코드
```
- 순수 레이어는 I/O·`Date.now()`·env를 쓰지 않는다. 기준일은 `today` 인자로 받는다.
- `components/`는 DTO만 받는다.
- 사용자 ID는 세션에서만 가져온다. 서버 저장소 함수는 소유자·카드·업로드 상태·lease와 데이터 세대를 검증한다. 외부 입력의 user_id·storage_path를 DB 쓰기에 전달하지 않는다.
- 공개 랜딩·데모·약관에는 requireUser를 적용하지 않는다. 웹훅과 내부 정기 작업은 각각 서명과 CRON_SECRET으로 인증한다.
- 전체 삭제는 사용자별 작업 행 잠금 아래 한 트랜잭션으로 처리하고 data_generation을 올린다. 삭제 전에 시작된 ingest·attempt·측정·요약 쓰기는 세대가 달라 저장하지 않는다.
- 요약은 같은 달·같은 input_hash가 이미 저장돼 있으면 다시 만들지 않는다. 입력이 바뀐 뒤 늦게 저장된 이전 요약은 다음 조회에서 input_hash 불일치로 다시 만든다.

## B5. 인터페이스 (시그니처 수준)
```ts
// types
type ISODate = string;     // 'YYYY-MM-DD', Date 객체로 파싱 금지
type YearMonth = string;   // 'YYYY-MM'
type Won = number;         // 안전한 정수 KRW. 집계는 0·음수 허용
type TxAmount = Won;      // 개별 거래는 0 금지. 지출 = 양수, 환불·취소 역분개 = 음수
type Category = 'food' | 'cafe' | 'transport' | 'shopping' | 'living' | 'housing_telecom' | 'medical'
              | 'leisure' | 'education' | 'subscription' | 'finance' | 'etc';
type Plan = 'free' | 'pro';
type UploadErrorCode = 'FILE_TOO_LARGE' | 'UNSUPPORTED_FILE' | 'BILLING_STATEMENT' | 'UNREADABLE' | 'TEMPORARY_FAILURE';

interface ColumnMapping {   // 프로필 코드가 헤더에서 찾은 컬럼 인덱스. LLM을 쓰지 않음
  headerRowIndex: number;
  date: number;        // 이용일 > 승인일 > 매입일 (결제일 금지)
  merchant: number;
  amount: number;      // 원화 금액 컬럼(해외 현지금액 금지)
  eventId: number;     // 거래별 고유성이 검증된 승인/환불 식별 컬럼(필수)
  originalEventId?: number;
  cancelFlag?: { column: number; values: string[] };
}
type EventKind = 'purchase' | 'refund' | 'reversal';
interface StatementProfile {
  id: string;
  eventMode: 'ledger' | 'approval_status';
  // 헤더 판별·컬럼 위치·청구서 판별·취소/금액 의미·거래 식별 범위·부분 취소 지원은 실제 fixture로 검증한 코드 규칙
}
interface ParsedTx {
  cardId: string; profileId: string; eventKind: EventKind;
  sourceEventKey: string; originalEventKey?: string;  // 원 식별자는 서버에서 해시, LLM에 전송하지 않음
  occurredOn: ISODate; merchantRaw: string; merchantNormalized: string;
  amount: TxAmount; fingerprint: string;
}
interface Tx extends ParsedTx { category: Category }
```
```ts
// lib/parsing (순수)
readRows(bytes: Uint8Array, ext: 'csv' | 'xlsx'): { rows: string[][]; profile: StatementProfile; mapping: ColumnMapping }
  // xlsx: ZIP 시그니처, 지원 프로필의 시트 선택 규칙, sheetRows 5,001
  // header: 1로 원 행 인덱스 유지. !fullref와 실제 읽힌 행 수를 확인하여 상한 초과를 잘린 성공으로 처리하지 않음
  // csv: fatal UTF-8 디코딩 → 실패하면 EUC-KR. UTF-16은 지원하지 않음
  // 5,000행은 제목·헤더를 포함한 입력 행 상한. 셀 1,000자 초과는 절단하지 않고 UNREADABLE
  // 읽기 실패는 UNSUPPORTED_FILE, 행 상한 초과는 FILE_TOO_LARGE
  // 청구서(제목·헤더의 '청구'·'결제예정' 등 프로필 규칙)는 BILLING_STATEMENT, 지원 프로필이 아니면 UNREADABLE(unsupported_profile)
applyMapping(rows, m, { today, cardId, profile, fileHash, declaredPeriod? }):
  { txs: ParsedTx[]; skipped: number; period: { start: ISODate; end: ISODate } }
  // 지원 프로필·매핑 인덱스·한 카드 파일인지 검증. 메타/합계 행 제외 후 거래 후보 해석률 90% 미만이면 UNREADABLE
  // 숫자는 안전한 정수로 검증. 날짜: YYYY.MM.DD / YYYY-MM-DD / YYYYMMDD / 엑셀 시리얼
  // 연도 없는 날짜는 파일의 검증된 기간 메타데이터 또는 사용자 지정 다운로드 기간으로 해석(12→1월 지원)
  // 기간 안에서 연도가 하나로 정해지지 않거나 기간 정보가 없으면 year_required 안내, 오늘 기준 연도 추측 금지
  // 금액: "1,234원", "-1,234", "(1,234)". 소수·0원·원화 빈칸·미래 날짜는 skip
  // 유효 거래 0건은 UNREADABLE. no_new는 DB에서 모든 유효 거래가 중복임을 확인한 경우만
  // ledger: 독립 환불/부분 환불 행을 음수로 기록. 같은 파일이나 DB에 원거래가 없어도 환불을 제외하지 않음
  // approval_status: 정상 승인은 양수. 전액 취소는 원 승인 양수 + 같은 이용일의 취소 역분개 음수
  // 월 귀속: ledger 환불은 환불 행의 날짜, approval_status 역분개는 원 승인 이용일(형식별 차이는 B7 안내)
  // 기존 승인 행과 역분개는 안정적인 원 식별자로 연결하여 취소 재다운로드 때 각각 한 번만 반영
  // 상태형 부분 취소는 누적 취소액을 추가 차감으로 오인하지 않도록 프로필에서 지원을 검증한 경우만 허용
  // 거래 식별자가 빈 행이 있거나 취소 의미·원금이 부족하면 전체 파일 UNREADABLE, 추측 매칭/조용한 skip 금지
  // fingerprint: sha256(cardId|profileIdentityScope|sourceEventKey|eventKind)
```
```ts
// services/llm ('server-only'). 요약 외부 호출 실패는 TEMPORARY_FAILURE, 분류 실패는 etc로 계속
interface LlmClient {
  classifyMerchants(names: string[]): Promise<Category[]>;   // 최대 200개. 인덱스 정렬 배열. 실패·누락은 'etc'(업로드는 계속)
  summarizeMonth(input: SummaryInput): Promise<string>;      // 집계만 입력
}
// lib/ingest
processUpload(deps: { db; storage; llm; today }, input: { userId; uploadId }): Promise<UploadResult>
type UploadResult =
  | { status: 'done'; inserted: number; duplicates: number; skipped: number; period; spendTotal: Won }
  | { status: 'no_new'; duplicates: number; existingCardId?: string }  // 다른 카드에 올린 같은 파일이면 existingCardId
  | { status: 'processing'; uploadId: string }  // RPC 결과 불명확 또는 다른 실행이 처리 중, 같은 ID로 상태 조회
  | { status: 'failed'; code: UploadErrorCode; reason?: string };
// done·no_new·failed는 stored result를 반환하여 같은 업로드 재요청도 멱등. processing은 삭제하거나 새 업로드로 바꾸지 않음
// RPC 호출 전 확정 실패만 failed로 기록. RPC 오류/timeout 후에는 먼저 동일 uploadId 결과를 조회
// 상태 조회도 실패하면 보존(processing). lease가 만료되면 정기 작업이 failed로 종료하며 재claim하지 않음
// no_new·failed의 원본은 정기 고아 정리가 삭제
// 커밋 후 track·응답 생성 오류는 거래 정리의 트리거가 아님
```
```ts
// lib/analytics (순수)
monthSnapshot(txs, month): MonthSnapshot           // 총지출, 카테고리, Top N, 일별, 거래일 범위(그 달의 최소·최대 거래일)
momChange(txs, month, today): Won | null           // month가 today의 달이거나 전월 거래가 없으면 null. 상쇄로 0원인 전월은 비교
monthlyTrend(txs): MonthlyTrend
detectRecurring(txs)    // 양수 구매 거래, 서로 다른 달 2개 이상, 간격 28~35일, 금액 ±10%
detectDuplicates(txs)   // 중복 저장이 아닌 별개의 결제 의심. 같은 날·가맹점·금액, 교통 제외, 10,000원 이상
                       // 식별자로 연결된 환불·역분개가 있는 결제는 의심 그룹에서 제외
detectOutliers(txs)     // 환불/역분개 연결을 반영한 양수 구매 20건 이상, 중앙값 × k 초과 (임계값은 상수)
buildDashboard(txs, month, plan, today): DashboardDTO
// free → { snapshot, mom, teaser: { recurring|duplicates|outliers: { count, total }, candidateTotal } }
// pro  → { snapshot, mom, findings, trend }
// 후보 금액은 선택 월 거래 ID를 기준으로 통합하며 중복 합산 금지. snapshot Top N 가맹점은 Free에도 허용

// lib/billing
getUserPlan(db, userId): Promise<Plan>          // Pro 상품의 status = 'active' && current_period_end > now
syncFromPolar(adminDb, userId): Promise<void>   // 조회 시작 시각 기록 → 상태 조회 → synced_from < 시작 시각일 때만 갱신
// lib/queries
fetchTransactions(db, userId, from: ISODate, to: ISODate): Promise<Tx[]>   // occurred_on·id 정렬, .range() 페이지네이션
```

### API (모두 Route Handler)
| 경로 | 동작 | 규칙 |
|---|---|---|
| `POST /api/cards` | 카드 라벨 등록 | 전체 카드번호 수집 없음. 본인 카드만 |
| `POST /api/uploads` | uploads(pending)와 attempt 생성 + signed upload URL 발급 | cardId 소유권·ext·파일명 255자·선택 입력 declaredPeriod·한도 검사. path = `${uid}/${uploadId}.${ext}`. 행을 커밋한 뒤 URL 발급 |
| `POST /api/uploads/[id]/process` | 처리 또는 저장 결과 반환 | pending만 원자적 claim(만료 processing은 재claim하지 않음). done/no_new/failed면 저장 결과. 처리 중/결과 불명확이면 202. `maxDuration = 300` |
| `GET /api/uploads/[id]` | 상태와 저장 결과 조회 | 처리 중 상태 포함. 본인 것이 아니거나 삭제됐으면 404 |
| `DELETE /api/uploads/[id]` | 업로드 행·거래 즉시 삭제 → 원본 삭제 시도 | 200. 이미 삭제됐거나 본인 것이 아니면 404. 남은 원본은 정기 정리 |
| `DELETE /api/me/data` | 소비 데이터 전체 삭제 | 200. UI 확인. DB는 한 트랜잭션으로 삭제, 원본은 삭제 시도 후 정기 정리. 계정·유료 구독·한도 기록은 유지 |
| `POST /api/checkout` · `POST /api/portal` | Polar URL 반환 | checkout source 허용목록. 이미 Pro면 포털 URL. external id는 세션 값 |
| `POST /api/metrics` | 티저 노출·업그레이드 클릭·파일 전송 실패 기록 | 허용된 종류와 source만. 전송 실패는 본인 pending 업로드만 failed로 종료 가능 |
| `POST /api/webhooks/polar` | 서명 검증 → `syncFromPolar` | external id가 없으면 200으로 무시 |
| `GET /api/internal/maintenance` | 만료 pending·processing의 failed 종료, 고아 파일 정리 | CRON_SECRET Bearer 검증, 실행당 처리 상한, 중복 실행 안전 |
| `GET /auth/callback` | 코드 교환 → 302 | next 검증, 에러면 `/login?error` |

200은 done/no_new와 삭제 완료, 202는 processing이다. lib의 failed 결과는 HTTP 422/503의 `{ error: { code, reason? }, uploadId? }`로 변환한다. reason은 `unsupported_profile/ambiguous_cancellation/year_required` 등 허용된 세부 사유이며 원문은 노출하지 않는다.

HTTP: 400 잘못된 입력 · 401 미인증 · 403 Origin/서명/권한 · 404 없음/타인 소유 · 409 작업 충돌 · 422 파일 문제 · 429 사용자 한도(Retry-After) · 503 확정된 일시 장애 · 500(메시지 노출 안 함). 사용자 메시지는 `lib/errors/messages.ts` 한 곳에서 매핑한다.

## B6. DB 스키마
```sql
create type tx_category as enum ('food','cafe','transport','shopping','living','housing_telecom',
  'medical','leisure','education','subscription','finance','etc');
create type upload_status as enum ('pending','processing','done','no_new','failed');

cards (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  label text not null,
  profile_id text,  -- 첫 성공 이후 같은 취소/거래 식별 의미의 다운로드 형식으로 유지
  unique (user_id, id)
)

user_operations (
  user_id uuid pk references auth.users on delete cascade,
  data_generation bigint not null default 0,
  upload_attempt_times timestamptz[] not null default '{}'  -- 최근 24시간, 최대 30개. 소비 데이터 삭제로 초기화하지 않음
)  -- 사용자당 한 행. 생성/claim/전체 삭제 시 행 잠금으로 한도와 작업 배타성 보장

uploads (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  card_id uuid not null,
  storage_path text not null unique check (storage_path like user_id::text || '/%'),
  file_name text not null,
  status upload_status not null default 'pending',
  file_hash text, profile_id text,
  declared_period_start date, declared_period_end date,
  data_generation bigint not null,
  processing_expires_at timestamptz,
  result_code text, result_reason text, existing_card_id uuid, spend_total bigint,
  inserted_count int, duplicate_count int, skipped_count int,
  period_start date, period_end date,
  created_at timestamptz not null default now(), completed_at timestamptz,
  foreign key (user_id, card_id) references cards (user_id, id),
  unique (user_id, card_id, id)
)  -- index (user_id, created_at desc), (user_id, file_hash)

transactions (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  card_id uuid not null, upload_id uuid not null,
  profile_id text not null,
  event_kind text not null, source_event_key text not null, original_event_key text,
  occurred_on date not null,
  merchant_raw text not null, merchant_normalized text not null,
  amount bigint not null check (amount <> 0),
  category tx_category not null,
  fingerprint text not null,
  unique (user_id, fingerprint),
  foreign key (user_id, card_id, upload_id)
    references uploads (user_id, card_id, id) on delete cascade
)  -- index (user_id, occurred_on)

subscriptions (user_id uuid pk references auth.users on delete cascade,
               status text not null, current_period_end timestamptz,
               cancel_at_period_end boolean not null default false, updated_at timestamptz not null,
               synced_from timestamptz)  -- 저장된 상태를 만든 조회의 시작 시각

ai_summaries (user_id uuid references auth.users on delete cascade, month date,
              input_hash text not null, content text not null, created_at timestamptz not null default now(),
              primary key (user_id, month))

user_metrics (user_id uuid pk references auth.users on delete cascade,
              first_upload_attempted_at timestamptz, first_upload_succeeded_at timestamptz,
              teaser_first_seen_at timestamptz,
              first_upgrade_clicked_at timestamptz, first_upgrade_source text,
              first_converted_at timestamptz, conversion_source text)

upload_attempts (
  id uuid pk default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  upload_id uuid unique,  -- FK 없음: upload 행 물리 삭제 후에도 측정 결과 유지
  created_at timestamptz not null default now(),
  stage text not null, outcome text, failure_code text,
  completed_at timestamptz, deleted_at timestamptz,
  period_start date, period_end date, extends_period boolean,
  inserted_count int, duplicate_count int,
  llm_usage jsonb not null default '{}'  -- 호출 종류별 입력/출력 토큰과 추정 비용, 거래 내용 없음
)  -- index (user_id, created_at). stage/outcome에 허용값 check 제약, source 제약은 user_metrics에 적용

-- 서버 전용 RPC, 아래 표의 실행 권한 제한과 소유권 검증 적용
create function ingest_upload(p_user_id uuid, p_upload_id uuid,
                             p_data_generation bigint,
                             p_rows jsonb, p_meta jsonb)
  returns table (inserted int, duplicates int)
  language plpgsql security invoker set search_path = ''
  -- user_operations → cards → uploads 순서로 행 잠금
  -- 업로드/카드가 p_user_id 소유이고 processing이며 data_generation과 lease가 유효한지 확인
  -- p_rows의 user_id/card_id/upload_id는 사용하지 않고 검증된 행에서 가져옴
  -- 카드 프로필과 사용자 전체 카드의 완료 file_hash를 검사한 후 insert
  -- insert … on conflict (user_id, fingerprint) do nothing
  -- counts·period·spend_total·stored result, attempt·첫 성공을 같은 트랜잭션에서 갱신
  -- inserted > 0: done. 같은 파일이거나 모든 유효 거래가 중복: no_new(원본은 정기 정리)
```
| 테이블 | 사용자 권한(RLS: `user_id = auth.uid()`) | 서버 쓰기 규칙 |
|---|---|---|
| cards, uploads, transactions, ai_summaries | select 본인 | authenticated/anon에 직접 insert·update·delete 없음. 상태/소유권 검증한 서버 저장소 함수만 쓰기 |
| subscriptions, user_operations | select 본인 | 상태 전환·동기화 RPC는 service-role 전용 |
| user_metrics, upload_attempts | 직접 읽기·쓰기 없음 | 인증된 서버에서 집계·허용된 결과만 기록 |
| storage `statements` | 정책 없음(select 포함) | 서버가 signed URL 발급·다운로드·삭제. private, `file_size_limit` 10MB, MIME에 xlsx·`text/csv`·`application/vnd.ms-excel`·`text/plain` |

- 모든 public 테이블은 RLS on. 서버 mutation RPC는 PUBLIC/anon/authenticated의 EXECUTE를 revoke하고 service_role에만 부여한다. security invoker 함수의 호출자가 service_role인 만큼 auth.uid()에 의존하지 않고 서버 세션에서 얻은 p_user_id와 행 소유권을 검증한다.
- ai_summaries도 본인 select만 허용한다. Free로 내려간 사용자가 직접 조회로 이전 요약을 보는 것은 수용한다(본인 데이터의 파생물이고 거래는 Free도 직접 읽을 수 있다). 화면 게이팅은 `buildDashboard`에서만 한다.
- 권한 제거는 마이그레이션과 pgTAP으로 단언한다. security definer 함수나 사용자 직접 table grant를 섞어 RPC 경유 규칙을 우회하지 않는다.
- 거래 식별자·file_hash는 서버에서 계산하며 클라이언트가 보내는 값으로 동일 파일 성공을 판정하지 않는다. 카드/파일 해석 결과를 신뢰하기 전에 원화·정수·취소 규칙을 코드로 검증한다.
- 직접 데이터 삭제는 FK cascade 대신 명시적 삭제 RPC를 사용한다. 단일 업로드는 최초 저장한 거래를 소유하므로 해당 업로드 삭제 시 다른 파일에서 중복 제외된 거래도 함께 사라질 수 있다. 영향을 고지하고 남은 원본을 다시 올리는 복구 경로를 안내한다.

## B7. 업로드 시퀀스 · 상태
```
Browser ─(1) POST /api/uploads {cardId, ...} ─▶ API
           ├─ 사용자 작업 행 잠금, 최근 24시간 30개 검사
           ├─ pending 업로드·attempt·최초 시도 기록 후 커밋
           └─ signed URL 발급(upsert=false)
        ◀──── {uploadId, path, token}
Browser ─(2) uploadToSignedUrl(file) ─────────────────────────────────────────▶ Storage
Browser ─(3) POST /api/uploads/:id/process ─▶ API
           ├─ done/no_new/failed 결과가 이미 있으면 stored result 반환
           ├─ 사용자별 동시 2개 한도 + pending 원자적 claim
           ├─ download → 서버 file_hash → 사용자 전체 카드의 완료 파일 해시 검사
           ├─ 프로필 판정(청구서·미지원 형식 거절) → 코드 매핑·검증·취소 정규화
           ├─ 기존 거래에 없는 가맹점만 → Claude 분류(200개씩, 동시 3개, 실패한 묶음만 etc)
           └─ ingest_upload(소유권·세대·lease·카드 잠금, 중복 검사, 저장과 결과 atomic)
                 ├─ 신규 있음 → done + stored result
                 ├─ 같은 파일·모두 검증된 중복 → no_new 결과(원본은 정기 정리)
                 └─ RPC 응답 불명확 → 상태 재조회
                       ├─ 완료 확인 → stored result 복구
                       └─ 확인 불가/실행 중 → 202 processing, 행·원본 보존
Browser ─ GET /api/uploads/:id ─▶ 완료 결과 또는 처리 진행 상태
```
```
[pending] ──claim──▶ [processing] ──신규 거래 커밋──▶ [done] ──사용자 삭제──▶ (행·거래 즉시 삭제)
    │                     │
    │                     ├─ 결과 불명확: 보존·상태 조회
    │                     ├─ 같은 파일·검증된 중복 ──▶ [no_new]
    │                     └─ 확정 실패·lease 만료 ───▶ [failed]
    └─ 전송 실패 보고·URL 만료 ────────────────────▶ [failed]

삭제된 업로드와 no_new·failed 업로드의 원본은 정기 고아 정리가 지운다
```

- 처리 lease는 6분, 핸들러 maxDuration은 300초라 정상 실행은 lease 안에서 끝난다. ingest_upload는 커밋 시점에 lease가 유효한지 확인한다. lease가 만료된 processing은 정기 작업이 행 잠금 아래 failed(TEMPORARY_FAILURE)로 종료하고, 사용자는 새 업로드로 다시 시도한다. 커밋이 끝난 업로드는 이미 done이라 정기 작업이 건드리지 않고, 만료 뒤 늦게 도착한 커밋은 lease 검사로 거절된다. DB 확인이 불가능하면 정리하지 않고 보존한다.
- 중복 검사와 insert는 사용자 작업 행·카드 행 잠금 아래 수행한다. 같은 file_hash가 사용자의 어느 카드에든 완료돼 있으면 먼저 no_new로 처리한다. 다른 카드였다면 결과 카드에 기존 카드 라벨과 "카드를 잘못 지정했다면 기존 업로드를 삭제하고 다시 올려 주세요"를 안내한다.
- 안정적인 식별자라도 저장된 금액·이용일·카드가 달라지면 단순 중복으로 무시하지 않고 형식/정정 내역 검증 실패로 처리한다. 취소 상태 변화는 프로필의 별도 역분개로 반영한다.
- pending에서 파일 전송이 실패하거나 사용자가 떠난 경우도 attempt를 기록한다. 정기 작업은 URL 만료 후 남은 pending과 lease가 만료된 processing을 failed로 종료한다.
- 총지출은 저장된 거래의 합계다. 업로드 결과는 **이번에 신규 반영한 금액**이며 중복 제외분은 포함하지 않는다. 반영 기간은 다운로드의 전체 기간이나 카드 전체 커버리지가 아니라 저장된 거래의 최소·최대 이용일이라고 화면에 설명한다.
- 취소·환불의 월 귀속은 파일의 날짜를 따른다. ledger 형식의 환불은 환불 행의 날짜(환불한 달)에, approval_status 형식의 역분개는 원 승인 이용일(승인한 달)에 반영된다. 같은 환불이 카드사 형식에 따라 다른 달 합계에 들어갈 수 있으므로 반영 기간 안내 옆에 "취소·환불은 카드사 파일의 날짜 기준으로 반영돼요"를 표시한다.

### 삭제와 고아 파일 정리
- 업로드 삭제는 사용자 작업 행과 업로드 행을 잠그고, 그 업로드가 최초 저장한 거래·관련 요약과 업로드 행을 한 트랜잭션으로 지운다. 커밋 후 원본 삭제를 한 번 시도한다. 처리 중이던 업로드의 늦은 ingest 커밋은 행이 없어 거절된다.
- 전체 삭제는 같은 잠금 아래 한 트랜잭션으로 data_generation을 올리고 거래·요약·업로드·카드·user_metrics·upload_attempts를 지운다. 커밋 후 사용자 폴더의 원본 삭제를 시도한다. "삭제 중" 구간이 없으므로 새 업로드를 따로 막지 않는다. 계정·구독·한도용 운영 상태는 유지한다.
- 업로드 행은 signed URL을 발급하기 전에 커밋되므로, 대응하는 행이 없는 객체는 삭제된 업로드의 것이고 언제 지워도 안전하다. signed URL은 추가 인증 없이 2시간 유효해 삭제 후에도 늦은 전송이 생길 수 있지만 같은 정리로 지운다. [Supabase 공식 문서](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl)
- 5분 주기 정기 작업은 만료 pending·processing을 failed로 종료하고, 행이 없거나 no_new·failed인 업로드의 객체를 지운다. 고아 판정은 storage.objects와 uploads를 대조하는 서버 전용 조회로 하고, 삭제는 Storage API로 한다. DB 조회가 실패하면 고아 여부를 추측해 삭제하지 않는다.
- 정기 작업은 실행당 처리 상한을 두고 함수 제한 안에서 끝낸다. 지운 객체는 다음 조회에 나오지 않으므로 커서 없이 이어서 처리된다. 중복 실행돼도 이미 지운 객체를 다시 지우려는 것 외에 부작용이 없다. 실패는 내용 없는 코드·id로 기록한다.

## B8. 결제 동기화
```
Browser ─ POST /api/checkout ─▶ getUserPlan = pro? ─▶ yes: portal URL
                                                 └─▶ no: Polar checkout(external_customer_id = session uid)
Browser ─ pay ─▶ /dashboard?checkout=success ─▶ syncFromPolar(session uid)
Polar   ─ customer.state_changed ─▶ webhook(verify) ─▶ syncFromPolar(external_id)
```

동기화 규칙:
- 동기화는 Polar 조회 직전 시각을 기록하고, 조회 결과를 `synced_from`이 비어 있거나 그 시각보다 이전일 때만 저장한다(조건부 update 한 번). 늦게 시작한 조회의 결과만 남으므로 먼저 시작한 조회가 늦게 도착해도 최신 상태를 덮어쓰지 않는다. 동시 실행은 막지 않는다. 웹훅은 조회가 실패했을 때만 재시도 가능한 응답(5xx)을 반환하고, success 화면은 아직 Pro가 아니면 "반영 중"으로 안내한다.
- 조회 실패는 기존 상태를 유지하며 Free로 덮어쓰지 않는다. 성공한 조회에서 Pro 상품 ID의 유효 구독만 권한으로 반영한다. 중복 구독 방지 설정을 확인하고, 중복 checkout 요청의 이중 결제 방지 동작을 검증한다.
- MVP는 쿠폰·무료 구독을 운영하지 않으므로, production에서 Pro 상품의 active 구독을 처음 확인한 시각을 첫 **실결제**로 본다. 이때 user_metrics.first_converted_at과 첫 클릭 source를 한 번만 기록한다. sandbox·mock은 H3 전환에서 제외한다. 쿠폰이나 무료 구독을 도입하면 결제 완료 주문 확인으로 바꾼다.
- 웹훅 누락은 success 복구뿐 아니라 대시보드에서 상태가 1시간 이상 오래되었거나 기간 만료에 도달했을 때 동일 동기화 함수로 보완한다(B1의 쓰기 예외). 환불·즉시 취소·기간 말 해지는 Polar 권한 상태에 따라 갱신한다.

## B9. 환경 변수 (환경별 값은 B13 표)
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SITE_URL`(public) / `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY`, `POLAR_ACCESS_TOKEN`, `POLAR_WEBHOOK_SECRET`, `POLAR_PRO_PRODUCT_ID`, `POLAR_ENV`, `CRON_SECRET`(server). `lib/env.ts`에서 zod로 **lazy 검증**한다(빌드 시점에 throw 금지). `.env.example`을 제공한다. 로컬 live 검증은 Polar sandbox, 공개 유료 서비스는 production의 별도 상품·키·웹훅을 설정한다.

## B10. 보안 체크리스트
| 항목 | 조치 |
|---|---|
| 테넌트 격리 | 사용자 읽기는 RLS, 서버 쓰기는 행 소유권·세대 검증. 카드·업로드·거래 복합 FK. 타인 리소스 404. 직접 table/Storage 쓰기와 RPC 실행 권한 차단을 테스트 |
| 인증 | 보호 페이지·핸들러에서 `requireUser()`(`getClaims`). 공개 경로/웹훅/정기 작업은 B4의 인증 분리. next 검증. Supabase Redirect URL 허용목록 |
| CSRF | 세션 기반 POST/DELETE는 환경별 허용 사이트 Origin과 정확히 일치하는 요청만 허용. JSON POST는 application/json 필수. 쿠키 SameSite 확인. 웹훅은 원문 서명 검증으로 별도 처리 |
| XSS | `react/no-danger` lint 규칙. 가맹점명·파일명·AI 요약은 텍스트로만 렌더링(세션 쿠키를 JS에서 읽을 수 있어 XSS가 곧 탈취) |
| 헤더 | `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin` (`next.config`) |
| 파일 | private 버킷, 확장자 화이트리스트, xlsx ZIP 시그니처, 패치된 SheetJS + `sheetRows` 상한 |
| LLM | 파일 원본·행 샘플은 보내지 않는다. 분류에는 가맹점명만, 요약에는 집계만. structured outputs와 코드 검증 |
| 결제 | 웹훅 서명 검증(어댑터). 상태 재조회와 조회 시작 시각 조건부 저장. external id는 세션 값. 이미 Pro면 포털. production active Pro 첫 확인으로 전환 측정 |
| 비밀 | `.gitignore`에 `.env*`. `import 'server-only'`. service-role은 소유권을 검증하는 서버 저장소 함수와 인증된 정기 작업에 한정 |
| 로그 | 코드와 id만. Supabase `error.details`·`message`, LLM 응답 본문은 기록 금지 |
| 비용 | 서버에서 최근 24시간 30개 시도·동시 처리 2개 원자적 제한, 셀 길이·파일 크기·행 수 상한. Anthropic 월 지출 한도, Vercel spend management, 삭제로 한도 우회 불가 |
| 개인정보 | 원본 삭제를 즉시 시도하고, 남은 파일과 늦게 도착한 파일은 5분 주기 고아 정리로 삭제. 확정 실패·no_new 원본도 같은 정리 대상. 전체 삭제 시 측정 이력 포함. 처리방침 국외 이전(Anthropic·Polar) 범위와 필요한 동의, 회원 탈퇴 요청 경로는 배포 전 법률 확인 |

단순 요청을 허용하는 JSON API는 preflight만으로 CSRF를 막을 수 없다. Origin과 content-type 검사는 상태 변경 요청의 공통 규칙이다. [OWASP 공식 가이드](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html)

## B11. 테스트 범위
- 단위 테스트는 `npm test`(Docker 불필요), DB·Storage를 쓰는 테스트는 `npm run test:db`(로컬 Supabase 실행 필요)로 나눈다. Stop hook은 단위 테스트만 실행한다.
- **parsing**(실제 fixture): 지원 형식 2종의 프로필 판정·컬럼 위치, EUC-KR CSV, 제목·합계 행, 명시 연도/12→1월/연도 누락 안내, 엑셀 시리얼·YYYYMMDD. 월을 넘긴 독립 환불과 형식별 월 귀속, 원거래 없는 환불, 전액 취소 상태 재다운로드, 부분 환불·부분 취소 지원/거절. 원화 빈칸·소수·0원·미래 날짜·빈 파일·혼합 카드 파일. 청구서·미지원 형식·거래 식별자가 빈 행·비ZIP xlsx·5,001행 거절. **카드별·월별·전체 기대 합계와 정확히 일치**해야 한다.
- **ingest**: 같은 uploadId 재요청 → stored result. 새 업로드로 같은 파일 → no_new. 같은 파일을 다른 카드로 → no_new·기존 카드 안내, 거래 이중 저장 없음. 겹치는 기간은 거래 식별자로 중복 제외. 두 카드의 같은 날짜·가맹점·금액과, 같은 파일 안의 같은 날·가맹점·금액인 별개 승인은 각각 저장. 사용자·카드 단위 동시 업로드 직렬화와 lease 검사. 기존 가맹점 카테고리 재사용, 분류 묶음 일부 실패 시 그 묶음만 etc.
- **복구**: DB 커밋 성공 후 RPC 응답 유실 → done 복구, RPC/상태 조회 모두 실패 → 보존. 강제 종료·lease 만료 후 정기 작업의 failed 종료, 만료 뒤 늦은 커밋 거절, done 업로드는 정기 작업이 건드리지 않음. RPC 호출 전 확정 실패 기록과 분류 실패 'etc' 성공.
- **삭제/Storage 통합**: 삭제 후 signed URL로 늦게 전송된 파일의 고아 정리, Storage 삭제 실패 후 다음 정리에서 삭제, pending/processing/done 삭제와 처리 중 업로드의 늦은 커밋 거절, 전체 삭제 전에 시작된 ingest·요약 쓰기 거절, no_new·failed 원본 정리, 처리 상한을 넘는 고아 파일을 다음 실행에서 이어서 정리, DB 조회 실패 시 삭제 안 함. 직접 Storage 읽기·쓰기·삭제 거부.
- **analytics**: 진행 중인 달·전월 거래가 없는 달의 전월 대비 null. 환불만 있는 달·상쇄로 0원인 달(전월 대비 비교 대상). 탐지 경계·취소 연결·후보 중복 합산 방지. Free snapshot의 Top N 가맹점은 허용하되 findings 상세·거래 ID·잠금 추세·요약은 RSC 직렬화 결과에 없음.
- **billing**: 멱등, success/webhook 동시 호출에서 먼저 시작한 조회가 늦게 도착해도 최신 상태를 덮지 않음, API 실패 시 기존 상태 유지와 웹훅 재시도 응답. Pro 상품 필터·중복 checkout·웹훅 서명 오류 403·이미 Pro면 포털·기간 말 해지·즉시 취소·production active Pro 첫 확인만 H3 전환으로 기록.
- **auth**: next 검증(`//x`, `/\x`, `https://`), 타인 uploadId → 404
- **CSRF/한도**: Origin 불일치/누락·text/plain POST 거부, 정상 JSON 허용, 웹훅·Cron 별도 인증. 여러 브라우저의 동시 요청에도 30개/24시간·동시 2개 제한, 전체 삭제 후 한도 유지.
- **RLS/권한(pgTAP)**: 모든 테이블 RLS on, 교차 사용자 읽기 거부, 직접 table 쓰기와 서버 mutation RPC EXECUTE 거부. service-role 경로도 다른 사용자의 card/upload와 거래를 연결하면 복합 FK·검증으로 실패.
- **측정**: URL 발급/전송/파싱/저장 각 단계 실패 이력, no_new 분리, 최초 시도·성공 멱등 기록, 업로드 물리 삭제 후 결과 보존, 사용자 삭제 시각, 30~45일/7일/24시간 경계와 최소 표본, sandbox/mock 제외, 전체 삭제 시 측정 이력 제거.
- **모드**: Production에서 APP_MODE=mock을 지정해도 live, Preview의 mock 결제가 production DB·실제 결제·실사용자 지표에 영향 없음. mock 성공 외에 로컬 live+sandbox와 production 검증을 별도로 수행.

## B12. 하네스·설정 수정
- `.gitignore`에 `.env*`, `!.env.example`, `supabase/.temp/`, `coverage/`
- Stop hook 앞에 `[ -f package.json ] || exit 0 ;` 가드
- `CLAUDE.md` 명령어를 `eslint .`, `vitest run`으로 하고 DB 통합 테스트 `npm run test:db`를 추가


## B13. 배포 · mock 모드
- **자동 배포**: `python3 scripts/execute.py 0-mvp --deploy`로 실행하면 step이 completed될 때마다 커밋 전에 `vercel deploy --yes`(Preview)를 실행하고, 결과를 `index.json`의 `deploy_url` 또는 `deploy_error`에 기록한다. 로컬 AC가 이미 통과했으므로 배포 실패는 step을 실패시키지 않는다. Production 배포는 step 14에서 `vercel deploy --prod`로만 한다.
- **모드 결정**(`lib/mode.ts`, step 0). Production은 구조적으로 mock이 될 수 없다.
```ts
type AppMode = 'mock' | 'live';
getMode(env = process.env): AppMode
// VERCEL_ENV === 'production' → 'live' (항상)
// VERCEL_ENV === 'preview'    → 'mock' (항상)
// 로컬                        → APP_MODE === 'live' ? 'live' : 'mock'
```
| 대상 | mock 동작 |
|---|---|
| Anthropic | `createMockLlmClient`(step 4)가 `LlmClient`를 그대로 구현한다. 분류는 가맹점 키워드 사전을 쓰고 없으면 'etc'. 요약은 집계 숫자로 만든 고정 템플릿. 테스트 fake로도 재사용한다 |
| Polar | checkout은 subscriptions를 즉시 active(30일)로 쓰고 success로 리다이렉트한다. portal은 즉시 해지한다. webhook은 쓰지 않고, `syncFromPolar`는 no-op |
| Analytics `track` | no-op (Preview 데이터가 지표에 섞이지 않게) |
| Supabase | **실제** (Preview는 dev 프로젝트) |

| Vercel 환경 | Supabase | Anthropic · Polar 키 | 모드 |
|---|---|---|---|
| Preview | dev 프로젝트(Seoul) | 넣지 않음 | mock |
| Production | prod 프로젝트(Seoul) | 실제 키 | live |
| 로컬 | Docker | `.env.local`(선택) | `APP_MODE` |

- mock 모드에서는 상단에 "테스트 모드: AI 분석과 결제는 모의로 동작합니다" 배너를 띄운다.
- Preview URL은 배포마다 달라진다. 서버의 사이트 Origin은 Preview에서 `https://`를 붙인 `VERCEL_URL`, Production에서 고정 `NEXT_PUBLIC_SITE_URL`, 로컬에서 설정한 localhost Origin을 사용한다. Origin 검사와 OAuth 복귀 URL 생성에 같은 함수를 쓴다. Supabase dev Redirect에는 프로젝트 전용 Preview 패턴을 등록하고 prod에는 고정 사이트 주소만 등록한다. Preview는 `index.json`의 `deploy_url`(= `VERCEL_URL`)로만 접속한다. 다른 별칭 주소로 열면 Origin이 달라 POST가 403이 된다.
- Preview 접근은 Vercel Deployment Protection(Vercel 로그인 필요)으로 막아 외부에 공개하지 않는다. 프로젝트 설정에서 켜져 있는지 확인한다.
- dev 프로젝트의 마이그레이션은 마이그레이션이 바뀐 step 이후 `supabase link` → `supabase db push`로 **수동** 반영한다. DB 비밀번호가 필요하고 비대화식 동작이 문서로 확인되지 않아 자동화하지 않는다. execute.py는 멈추지 않고 다음 step으로 넘어가므로, push 전까지 Preview는 배포가 성공해도 테이블이 없는 DB를 봐서 화면이 동작하지 않는다. 마이그레이션은 step 1~2(db-schema·db-rpc)에서 만들어지므로 그 뒤 한 번 push하고, 이후 step이 마이그레이션을 바꾸면 다시 push한다.
- 새 Vercel 프로젝트의 첫 배포는 `--prod`가 없어도 Production이 된다. 그래서 step 0의 뼈대 화면이 Production URL에 한 번 올라가지만, 키를 쓰는 기능이 없는 시점이라 문제없다.
- `.vercelignore`로 `.env*`, `phases/`, `scripts/`는 업로드하지 않는다.
- mock 서비스도 정상 인증·Origin·소유권·세대·한도 검사를 거쳐 같은 서버 저장소 함수로 쓰며 production 저장소에 연결하지 않는다. mock 구독은 H3의 실결제 기록을 생성하지 않는다.
- Vercel Cron은 production 배포 URL을 호출한다. Preview/dev와 로컬 정리 검증은 동일 maintenance 함수를 인증된 수동 요청/로컬 실행으로 돌리고, 공개 배포에서는 Pro의 5분 주기 Cron을 설정한다. Preview 자동 배포만으로 정기 정리가 실행된다고 가정하지 않는다. [Vercel 공식 문서](https://vercel.com/docs/cron-jobs)

---

# Part C. 실행

## C1. 순서
1. **완료**: 설계 검토를 반영한 이 문서를 `plan.md`로 저장
2. (사용자) 익명화한 실제 신용카드 이용내역 2종과 기대 합계 확보 → 거래별 식별자 유무·취소 표시 방식·확장자(.xls 여부)를 확인해 지원 형식과 B2·B5·B10의 파일 규칙 확정
3. **완료**: `CLAUDE.md` · `docs/*`(USER_FLOW 신규) 작성, B12 설정 수정. docs는 구조와 불변 규칙만 담고, 상세 설계(인터페이스·스키마·RPC·테스트 시나리오)는 이 문서 Part B를 기준으로 step 파일에 넣는다. 2번 결과로 docs의 [확정 필요] 2곳을 갱신한다
4. (지시가 있을 때) `phases/0-mvp` 생성 → `python3 scripts/execute.py 0-mvp --deploy` (step마다 Preview 자동 배포)

## C2. `phases/0-mvp` step 초안 (15개)
| # | name | 내용 | UC |
|---|---|---|---|
| 0 | project-setup | Next 16, TS, Tailwind v4, Vitest(`test`·`test:db` 분리), ESLint(`react/no-danger`), `lib/env.ts`, `types` · `lib/errors`, 보안 헤더 3종, `vercel.json`(`icn1`), `lib/mode.ts` + mock 배너 | - |
| 1 | db-schema | B6 테이블·enum·인덱스, 카드·업로드·거래 복합 FK, 읽기 RLS와 직접 쓰기 차단, private 버킷(사용자 정책 없음), pgTAP(RLS·권한), gen types | 06·07·13 |
| 2 | db-rpc | claim·ingest_upload·업로드 삭제·전체 삭제·결제 조건부 저장·정기 정리용 RPC와 EXECUTE 권한 제한, pgTAP(소유권·lease·세대·중복), 서버 저장소 함수와 `lib/queries`(`.range()` 페이지네이션) | 03·06·07·13 |
| 3 | file-parsing | 실제 지원 형식 2종의 프로필·fixture, 컬럼 판정·청구서 판별, 환불/취소·월 귀속·거래 식별자·연도 규칙. **합계 검증 통과가 후속 통합의 전제** | 03·05·06 |
| 4 | llm-service | `services/llm`(가맹점 분류·월 요약, 에러 정규화), `createMockLlmClient` | 03·05 |
| 5 | analytics | 스냅샷, 전월 대비(전월 없음 null), 추세, 탐지 3종, 후보 금액 중복 합산 방지, Free/Pro DTO | 08·09·10 |
| 6 | auth-flow | `proxy.ts`, 로그인, 콜백, `requireUser()`, 환경별 Origin/JSON 검사 | 02 |
| 7 | ingest-core | `lib/ingest` processUpload: 다운로드·파일 해시·파싱·분류 묶음 호출·ingest RPC·결과 조회 복구. fake db/storage/llm으로 단위 테스트 | 03·05·06 |
| 8 | ingest-api | 카드·업로드 생성/처리/조회/삭제·전체 삭제 Route Handler, quota, metrics API, maintenance Cron(만료 종료·고아 정리), Storage 통합 테스트 | 03·05·06·07·13 |
| 9 | billing | POST checkout/portal, webhook, 조회 시작 시각 조건부 저장, 실결제 전환 기록, mock checkout/portal | 09·12 |
| 10 | upload-ui | 카드 선택·등록, 연도 안내, 지원 형식 가이드, 멀티 업로드(동시 2개)·상태 조회·확정 실패 재시도, 결과 카드·"틀렸어요" | 03~07 |
| 11 | dashboard-view | 로더, 월 선택·반영 기간·월 귀속 안내, 차트, 후보 티저·잠금 카드, 요약(Suspense+캐시), 오래된 결제 상태 보완 | 08~11 |
| 12 | settings-ui | 플랜·포털, 업로드 내역(done)과 삭제, 전체 삭제와 완료 안내, 계정·구독 유지 안내 | 07·12·13 |
| 13 | landing-demo | 랜딩, `/demo`, `/privacy`, `/terms`, Analytics | 01 |
| 14 | deploy | 보안 권고·패치 버전 고정, Vercel Pro, production env/DB/Polar 상품·키·웹훅, Cron, Redirect 허용목록, live E2E·실결제/해지 확인, `npm audit`, `vercel deploy --prod` | 전체 |

AC는 각 step에서 `npm run lint && npm run build && npm test`를 기본으로 한다. 로컬 Supabase를 켠 상태에서 1번은 `supabase db reset && supabase test db`를, DB·Storage를 쓰는 2·8·9·11번은 여기에 `npm run test:db`를 더한다. 14번은 사용자 개입이 필요해 blocked가 예상된다.

기본 명령 통과 외에 step별로 B11의 해당 시나리오를 AC에 명시한다. 3번은 카드별·월별 기대 합계와 취소 형식·월 귀속 검증, 7번은 응답 유실 복구, 8번은 삭제 후 늦은 전송의 고아 정리, 9번은 동기화 순서 경합, 11번은 실제 fixture 업로드→대시보드 합계 일치를 완료 조건으로 둔다. Preview/mock 성공을 live 검증으로 대체하지 않는다.

## C3. 사전 준비 (사용자)
- Supabase(Seoul) **dev·prod 프로젝트 2개**(dev는 Preview용), Docker와 CLI
- Google OAuth 클라이언트
- Anthropic API 키와 월 지출 한도 설정
- Polar sandbox와 Pro 상품($4.99/월), 공개 전 production의 별도 상품·키·웹훅 및 정산 계좌. 쿠폰·무료 구독은 만들지 않는다(B8의 H3 측정 전제)
- Vercel 계정과 CLI 로그인(`vercel login`) · 프로젝트 연결(`vercel link`). mock 단계는 Hobby, 실결제 공개 시 **Vercel Pro**
- 익명화한 실제 신용카드 이용내역 2종(모든 거래 행에 거래별 식별자가 있는 형식), 동일 카드의 겹침·재다운로드·월간 환불·부분 취소·청구서 샘플과 기대 합계. **docs 작성 전에** 확보한다(C1)
- 운영 한도와 삭제 지연 안내, Cron 인증/실행 설정
- 국외 이전 고지 범위와 회원 탈퇴 요청 경로(처리방침에 요청 방법 기재)에 대한 법률 확인

## C4. 리스크 (수용 · 측정 대상)
- 일부 카드/기간만 올린 달은 비교가 왜곡될 수 있다(거래일 범위 표시와 부분 데이터 안내로 완화)
- 거래별 식별자가 없는 카드사 형식과 체크카드는 지원하지 않는다(지원 범위 제한)
- 취소·환불의 월 귀속이 카드사 형식마다 다르다(화면 안내로 완화)
- 단일 업로드 삭제 시 다른 파일에서 중복 제외된 거래는 자동 복원되지 않는다(영향 고지와 재업로드 안내)
- 삭제 후 signed URL로 늦게 도착한 원본은 다음 정기 정리(5분 주기)까지 Storage에 남는다
- 가이드 메뉴 경로는 직접 확인이 필요하다
- USD 결제 거부감(H3), 수수료·무료 사용자 분석 비용을 포함한 C6 단가 검증
- 재방문 알림 없음(H4)
- 지원 형식 밖 파일 비율(H2): 높으면 카드사 프로필을 추가한다

## C5. 검증 (E2E)
1. 각 step의 AC가 통과하는지 확인한다(Stop hook은 lint·build·단위 테스트만 자동 실행).
2. UC 01~13을 순서대로 수행한다. 특히 확인할 것:
   - 4.5MB가 넘는 파일 업로드 성공
   - 같은 파일 재업로드 시 "이미 올린 내역", 같은 uploadId 재요청 시 기존 성공 결과
   - 두 카드의 같은 날짜·가맹점·금액 거래가 모두 보존되는지, 같은 파일을 다른 카드로 올려도 이중 집계되지 않는지
   - 월을 넘긴 환불·부분 환불·취소 상태 재다운로드의 카드별/월별 합계
   - 지원하지 않는 형식이 안내와 함께 거절되는지
   - 청구서 거절
   - 로컬 live에서 API 키 오류 시 분류가 etc로 계속되는지, DB 커밋 후 응답 유실의 동일 ID 복구
   - 결제 후 웹훅 없이도 Pro 반영, success/webhook 경합에도 상태가 과거로 돌아가지 않는지
   - sandbox 검증 후 production 실결제·기간 말 해지·즉시 취소/환불의 권한 동작
   - 전체 삭제 직후 소비 DB·사용자 측정 이력이 비고, 정기 정리 후 Storage도 비는지
   - 삭제 요청 직후 signed URL로 늦은 파일을 전송해도 정기 작업이 다시 정리하는지
3. 보안을 확인한다.
   - 타인 uploadId → 404
   - `next=//evil.com` 거부
   - Free 계정 RSC payload에 탐지 상세가 없는지
   - 웹훅 서명 위조 → 403
   - Origin 불일치·text/plain POST 거부, 직접 DB 쓰기·Storage 접근과 mutation RPC 실행 거부
   - 서버 쓰기에서 타인 cardId/uploadId 연결 거부, 30개/24시간·동시 2개 한도 유지
   - 응답 헤더 3종 확인
   - Vercel 로그에 거래 문자열이 없는지
4. 측정·환경을 확인한다.
   - 단계별 실패, 첫 시도/성공, 사용자 삭제, 첫 클릭 source와 production 실결제가 DB에 정확히 연결되는지
   - mock/sandbox 결과는 실사용자 전환 지표에서 제외되는지
   - Preview는 dev Supabase·mock, Production은 prod Supabase·live·Polar production인지
   - 보안 패치 적용 버전·정기 정리 실행·계약/고지 확인을 공개 배포 기록에 남겼는지

## C6. 단가 · 운영 검증
- 가격은 $4.99/월로 시작하되 수수료·무료 사용자 비용을 포함해 검증한다. 2026-10-10 공식 가격 기준 신규 Polar Starter는 5%+$0.50, 해외 카드 추가 1.5%다. 해당 조건의 $4.99 결제에서는 약 $0.82가 수수료로 빠져 약 $4.17가 남는다(세금·정산비 제외). 기존 Early Member 조직은 별도 요율이므로 실제 조직 플랜으로 다시 계산한다. [Polar 공식 가격](https://polar.sh/resources/pricing)
- Opus 5.5의 분류·요약별 입력/출력 토큰, 평균 파일 처리 비용, 무료 활성 사용자당 월 비용, 원본 저장량과 호스팅 비용을 측정한다. 토큰/비용 수치만 attempt에 저장하고 거래 내용은 기록하지 않는다.
- 순기여액 = 실수령 구독료 − 유료 사용자 분석 비용 − 무료 사용자 분석 비용의 배분 − 저장/호스팅 비용의 배분. 최소 표본 관찰 후 가격·한도·모델 사용량을 조정하며, 적자가 전역 지출 한도에 의해 서비스 중단으로 나타나기 전에 확인한다.

## 참고 문서
[Vercel Limits](https://vercel.com/docs/functions/limitations) · [Vercel Fair Use](https://vercel.com/docs/limits/fair-use-guidelines) · [Vercel Custom Events](https://vercel.com/docs/analytics/custom-events) · [Next.js Blog](https://nextjs.org/blog) · [Supabase SSR](https://supabase.com/docs/guides/auth/server-side/nextjs) · [Supabase Signed Upload](https://supabase.com/docs/reference/javascript/storage-from-createsigneduploadurl) · [Supabase 1000행](https://github.com/orgs/supabase/discussions/3765) · [Polar Next.js](https://polar.sh/docs/integrate/sdk/adapters/nextjs) · [Polar Customer State](https://polar.sh/docs/integrate/customer-state) · [Polar Multiple Subscriptions](https://polar.sh/docs/guides/allow-multiple-subscriptions-per-customer) · [Claude Structured Outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs) · [SheetJS CVE-2023-30533](https://cdn.sheetjs.com/advisories/CVE-2023-30533)
