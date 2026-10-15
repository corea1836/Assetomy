export const meta = {
  name: 'review-code',
  description: '/review-code 스킬이 수집한 diff를 차원별로 병렬 리뷰하고, 지적마다 skeptic 3명의 2/3 다수결로 거짓 양성을 걸러 낸다',
  whenToUse: '직접 실행하지 않는다. /review-code 스킬이 diff·문서를 수집한 뒤 args로 호출한다',
  phases: [{ title: '리뷰' }, { title: '검증' }],
}

// 스킬을 거치지 않고 workflow 명령이 직접 실행되면 diff가 없다.
if (!args || typeof args !== 'object' || !args.diffPath) {
  return '/review-code 스킬로 실행하세요. 스킬이 diff·문서를 먼저 수집해 args로 넘깁니다.'
}

// 심각도 정의(Harness 기준)는 여기 한 곳에만 둔다. 스킬의 판정·집계도 이 네 단계를 쓴다.
const SEVERITIES = ['critical', 'major', 'minor', 'nit']
const SEVERITY = `심각도:
- critical: CLAUDE.md CRITICAL 규칙 위반, 권한 우회·남의 데이터 접근, 사용자에게 보이는 틀린 금액·날짜·합계, 데이터 손실
- major: 특정 조건에서 잘못 동작, CRITICAL이 아닌 아키텍처 규칙 위반, 빠진 에러 경로
- minor: 지금은 맞지만 다음 변경에서 깨지기 쉬움, 영향이 작은 경계값
- nit: 동작에 영향 없음(위치, 중복 코드)`

// 서브에이전트가 쓴 문장은 사용자에게 그대로 보이므로 출력 언어를 여기 한 곳에서 정한다.
const LANGUAGE = '문장(제목·요약·이유·잘된 점)은 한국어로 쓴다. 코드·식별자·경로는 원문 그대로 둔다.'

// 차원을 늘릴 때는 여기에 한 줄, .claude/agents/review-<차원>.md 하나를 추가한다.
const DIMENSIONS = ['correctness', 'security', 'architecture']

// skeptic 3명은 같은 지적을 서로 다른 관점에서 반박한다. 이유: 같은 이유로 함께 틀리지 않게.
const SKEPTIC_ANGLES = [
  '규칙: 근거로 든 규칙이 문서에 실제로 있고, 이 코드에 적용되는가',
  '도달: 실패 시나리오가 실제 호출 경로에서 일어나는가(호출부, 앞단의 검증·가드)',
  '의도: 다른 곳에서 이미 막고 있거나, ADR·step 문서가 의도한 동작인가',
]

const FINDINGS_SCHEMA = {
  type: 'object',
  required: ['findings', 'strengths'],
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        required: ['severity', 'file', 'line', 'title', 'tldr', 'good', 'fix', 'rule', 'scenario'],
        properties: {
          severity: { type: 'string', enum: SEVERITIES },
          file: { type: 'string', description: '저장소 기준 경로' },
          line: { type: 'integer', minimum: 1, description: '새 파일 쪽 줄 번호' },
          title: { type: 'string', description: '한 줄 제목' },
          tldr: { type: 'string', description: '무엇이 어떻게 잘못되는가, 한 문장' },
          good: { type: 'string', description: '지켜야 할 올바른 모습(기준), 한 문장' },
          fix: { type: 'string', description: '고친 코드만' },
          rule: { type: 'string', description: '근거 문서 위치(예: CLAUDE.md "아키텍처 규칙", ADR-008)' },
          scenario: { type: 'string', description: '구체적인 입력·상태 → 잘못된 결과' },
        },
      },
    },
    strengths: {
      type: 'array',
      items: { type: 'object', required: ['text'], properties: { text: { type: 'string' }, file: { type: 'string' } } },
    },
  },
}

const VOTE_SCHEMA = {
  type: 'object',
  required: ['vote', 'evidence', 'reason'],
  properties: {
    vote: { type: 'string', enum: ['refuted', 'upheld', 'unsure'] },
    evidence: { type: 'array', items: { type: 'string' }, description: '판단 근거 file:line' },
    reason: { type: 'string', description: '한두 문장' },
    severity: { type: 'string', enum: SEVERITIES, description: 'upheld일 때 심각도가 맞지 않으면' },
    fix: { type: 'string', description: 'upheld일 때 Fix 코드가 틀렸으면 고친 코드' },
  },
}

const list = (items) => (items && items.length ? items.map((item) => `- ${item}`).join('\n') : '없음')

const context = `diff: ${args.diffPath}
변경 파일(name-status):
${list(args.files)}
미추적 새 파일(diff에 없으니 파일 전체를 읽어라):
${list(args.untracked)}
의도한 동작(step 문서):
${list(args.docs)}`

function reviewPrompt(dimension) {
  return `assetomy 변경분을 ${dimension} 관점으로 리뷰하라. 리뷰 범위: ${args.range}

${context}

규칙:
- 너의 차원만 본다. 다른 차원의 문제는 보고하지 않는다.
- 변경된 줄과, 그 변경이 영향을 주는 코드(호출부·호출 대상)만 본다. 변경과 무관한 기존 문제는 보고하지 않는다.
- 코드를 읽고 구체적인 실패 시나리오를 쓸 수 있을 때만 보고한다. "~일 수 있다" 같은 추측은 쓰지 않는다.
- strengths에는 이 차원에서 잘된 점을 0~2개 적는다.
- 파일을 고치지 않는다.
- ${LANGUAGE}

${SEVERITY}`
}

function skepticPrompt(finding, angle) {
  return `리뷰어가 낸 지적 하나를 검증하라. 너의 관점: ${angle}

지적:
- 위치: ${finding.file}:${finding.line}
- 심각도: ${finding.severity}
- 제목: ${finding.title}
- 근거 규칙: ${finding.rule}
- 실패 시나리오: ${finding.scenario}
- 제안한 Fix:
${finding.fix}

${context}

${LANGUAGE}

${SEVERITY}`
}

const rank = (severity) => SEVERITIES.indexOf(severity)
const higher = (a, b) => (rank(a) <= rank(b) ? a : b)

// 근거를 인용하지 않은 표와 실패한 표(null)는 unsure로 센다.
function tally(finding, dimension, votes) {
  const counted = votes.map((v) => (v && v.vote !== 'unsure' && v.evidence.length ? v.vote : 'unsure'))
  const upheld = votes.filter((v, i) => counted[i] === 'upheld')
  const base = {
    ...finding,
    dimensions: [dimension],
    votes: votes.map((v, i) => ({ vote: counted[i], reason: v ? v.reason : '표 실패' })),
  }
  if (counted.filter((v) => v === 'refuted').length >= 2) return { ...base, status: 'rejected' }
  if (upheld.length < 2) return { ...base, status: 'unsure' }
  const severity = upheld.map((v) => v.severity || finding.severity).reduce(higher)
  const fixed = upheld.find((v) => v.fix)
  return { ...base, status: 'confirmed', severity, fix: fixed ? fixed.fix : finding.fix }
}

async function verify(finding, dimension) {
  if (finding.severity === 'nit') return { ...finding, dimensions: [dimension], status: 'unverified' }
  const votes = await parallel(SKEPTIC_ANGLES.map((angle, i) => () =>
    agent(skepticPrompt(finding, angle), {
      agentType: 'review-skeptic', schema: VOTE_SCHEMA, phase: '검증', label: `${finding.file}:${finding.line} #${i + 1}`,
    })))
  return tally(finding, dimension, votes)
}

// 차원 하나의 리뷰가 끝나면 다른 차원을 기다리지 않고 바로 검증으로 넘어간다(pipeline, barrier 없음).
const results = await pipeline(
  DIMENSIONS,
  (dimension) => agent(reviewPrompt(dimension), {
    agentType: `review-${dimension}`, schema: FINDINGS_SCHEMA, phase: '리뷰', label: dimension,
  }),
  async (review, dimension) => ({
    dimension,
    strengths: review.strengths.map((s) => ({ ...s, dimension })),
    findings: (await parallel(review.findings.map((f) => () => verify(f, dimension)))).filter(Boolean),
  }),
)

// 같은 file:line 지적은 한 건으로 합친다. 상태가 좋은 쪽(confirmed 우선)과 높은 심각도를 따르고 차원을 함께 적는다.
const STATUS_ORDER = ['confirmed', 'unverified', 'unsure', 'rejected']
const merged = new Map()
for (const f of results.filter(Boolean).flatMap((r) => r.findings)) {
  const key = `${f.file}:${f.line}`
  const prev = merged.get(key)
  if (!prev) { merged.set(key, f); continue }
  const keep = STATUS_ORDER.indexOf(f.status) < STATUS_ORDER.indexOf(prev.status) ? f : prev
  merged.set(key, {
    ...keep,
    severity: f.status === prev.status ? higher(f.severity, prev.severity) : keep.severity,
    dimensions: [...new Set([...prev.dimensions, ...f.dimensions])],
  })
}
const all = [...merged.values()].sort((a, b) => rank(a.severity) - rank(b.severity))
const pick = (status) => all.filter((f) => f.status === status)

return {
  confirmed: pick('confirmed'),
  unverified: pick('unverified'),
  unsure: pick('unsure'),
  rejected: pick('rejected'),
  strengths: results.filter(Boolean).flatMap((r) => r.strengths),
  failedDimensions: DIMENSIONS.filter((d, i) => !results[i]),
}
