import { useState, useRef, useCallback, useEffect } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

type AppState = 'setup' | 'loading' | 'report' | 'error'
type LoadStage = 'crawling' | 'analyzing'

interface MetricsSummary {
  total_posts_analyzed: number
  avg_likes: number
  avg_collects: number
  avg_comments: number
  top_post_likes: number
  engagement_rate_insight: string
}

interface Pattern {
  pattern: string
  frequency: string
  example: string
  why_it_works: string
}

interface ContentInsights {
  winning_title_formulas: string[]
  best_content_formats: string[]
  optimal_length: string
  visual_patterns: string
  key_keywords_used: string[]
}

interface CommentInsights {
  top_pain_points: string[]
  common_questions: string[]
  sentiment: string
  engagement_triggers: string[]
}

interface SuggestedAngle {
  angle: string
  rationale: string
  differentiation: string
}

interface PostSummary {
  title: string
  user: string
  liked_count: number
  collected_count: number
  comment_count: number
  cover_url: string
  type: string
}

interface AnalysisMeta {
  model: string
  completion_tokens: number
  reasoning_tokens: number
  prompt_tokens: number
}

interface AnalysisResult {
  metrics_summary: MetricsSummary
  top_patterns: Pattern[]
  content_insights: ContentInsights
  comment_insights: CommentInsights
  suggested_angles: SuggestedAngle[]
  hook_examples: string[]
  summary: string
  _posts: PostSummary[]
  _meta: AnalysisMeta
}

// ─── Lens Logo ────────────────────────────────────────────────────────────────

function LensLogo({ size = 40, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      style={{
        animation: spinning ? 'spin-slow 3s linear infinite' : undefined,
        flexShrink: 0,
      }}
    >
      {/* Outer ring */}
      <circle cx="20" cy="20" r="18" stroke="#E51A28" strokeWidth="1.5" />
      {/* Aperture blades */}
      {[0, 60, 120, 180, 240, 300].map((angle, i) => (
        <path
          key={i}
          d={`M20 20 L${20 + 14 * Math.cos((angle * Math.PI) / 180)} ${20 + 14 * Math.sin((angle * Math.PI) / 180)} A14 14 0 0 1 ${20 + 14 * Math.cos(((angle + 55) * Math.PI) / 180)} ${20 + 14 * Math.sin(((angle + 55) * Math.PI) / 180)} Z`}
          fill="#E51A28"
          opacity={0.15 + i * 0.05}
        />
      ))}
      {/* Inner circle */}
      <circle cx="20" cy="20" r="6" fill="#E51A28" opacity="0.9" />
      <circle cx="20" cy="20" r="3" fill="#080809" />
    </svg>
  )
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────

function SetupScreen({
  onAnalyze,
}: {
  onAnalyze: (keyword: string, cookie: string, maxNotes: number) => void
}) {
  const [keyword, setKeyword] = useState('')
  const [cookie, setCookie] = useState('')
  const [maxNotes, setMaxNotes] = useState(15)
  const [cookieOpen, setCookieOpen] = useState(false)
  const [showCookieHelp, setShowCookieHelp] = useState(false)

  const canSubmit = keyword.trim().length > 0 && cookie.trim().length > 0

  return (
    <div style={styles.setupWrap}>
      {/* Background accent */}
      <div style={styles.setupGlow} />

      {/* Header */}
      <header style={styles.setupHeader}>
        <div style={styles.logoRow}>
          <LensLogo size={36} />
          <span style={styles.wordmark}>RedLens</span>
        </div>
        <div style={styles.headerTag}>XHS Content Intelligence</div>
      </header>

      {/* Hero */}
      <div style={styles.hero}>
        <h1 style={styles.heroTitle}>
          Decode what makes<br />
          <em style={styles.heroEm}>XHS content</em> go viral.
        </h1>
        <p style={styles.heroSub}>
          Enter a keyword. We analyze the top posts, comments, and patterns —
          then tell you exactly what to create.
        </p>
      </div>

      {/* Form card */}
      <div style={styles.formCard}>
        {/* Keyword */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>KEYWORD</label>
          <input
            style={styles.input}
            type="text"
            placeholder="e.g. 减肥, 护肤, 穿搭, 旅游"
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canSubmit && onAnalyze(keyword, cookie, maxNotes)}
            autoFocus
          />
        </div>

        {/* Cookie accordion */}
        <div style={styles.fieldGroup}>
          <button
            style={styles.accordionTrigger}
            onClick={() => setCookieOpen(o => !o)}
          >
            <span style={styles.label}>
              XHS COOKIE
              {cookie && <span style={styles.cookieBadge}>✓ Set</span>}
            </span>
            <svg
              width="16" height="16" viewBox="0 0 16 16" fill="none"
              style={{ transform: cookieOpen ? 'rotate(180deg)' : 'rotate(0deg)', transition: 'transform 0.2s', flexShrink: 0 }}
            >
              <path d="M4 6l4 4 4-4" stroke="var(--text-3)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>

          {cookieOpen && (
            <div style={{ animation: 'fade-up 0.2s ease' }}>
              <div style={styles.cookieHelp}>
                <span>Paste your xiaohongshu.com cookie string here.</span>
                <button
                  style={styles.helpBtn}
                  onClick={() => setShowCookieHelp(h => !h)}
                >
                  How to get it?
                </button>
              </div>

              {showCookieHelp && (
                <div style={styles.cookieHelpBox}>
                  <p style={styles.helpStep}><strong>1.</strong> Open <code style={styles.code}>xiaohongshu.com</code> and log in</p>
                  <p style={styles.helpStep}><strong>2.</strong> Press <code style={styles.code}>F12</code> → Application → Cookies → xiaohongshu.com</p>
                  <p style={styles.helpStep}><strong>3.</strong> Or: Network tab → any request → copy the <code style={styles.code}>Cookie</code> header value</p>
                  <p style={styles.helpStep}><strong>4.</strong> Paste the full string below</p>
                </div>
              )}

              <textarea
                style={styles.cookieInput}
                placeholder="a1=...; webId=...; xsecappid=...; ..."
                value={cookie}
                onChange={e => setCookie(e.target.value)}
                rows={4}
                spellCheck={false}
              />
            </div>
          )}
        </div>

        {/* Notes slider */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>
            POSTS TO ANALYZE
            <span style={styles.sliderVal}>{maxNotes}</span>
          </label>
          <input
            type="range"
            min={5}
            max={20}
            value={maxNotes}
            onChange={e => setMaxNotes(Number(e.target.value))}
            style={styles.slider}
          />
          <div style={styles.sliderLabels}>
            <span>5 (faster)</span>
            <span>20 (deeper)</span>
          </div>
        </div>

        {/* CTA */}
        <button
          style={{
            ...styles.analyzeBtn,
            ...(canSubmit ? {} : styles.analyzeBtnDisabled),
          }}
          disabled={!canSubmit}
          onClick={() => onAnalyze(keyword, cookie, maxNotes)}
        >
          <LensLogo size={20} />
          <span>Analyze "{keyword || '…'}"</span>
        </button>

        {!cookie && !cookieOpen && (
          <p style={styles.cookieHint}>
            ↑ You'll need to set your XHS cookie to crawl content.{' '}
            <button style={styles.inlineBtn} onClick={() => setCookieOpen(true)}>Set cookie →</button>
          </p>
        )}
      </div>

      <footer style={styles.setupFooter}>
        Powered by <strong>mimo-v2.5</strong> · For research and learning purposes only
      </footer>
    </div>
  )
}

// ─── Loading Screen ───────────────────────────────────────────────────────────

function LoadingScreen({
  stage,
  message,
  keyword,
  onCancel,
}: {
  stage: LoadStage
  message: string
  keyword: string
  onCancel: () => void
}) {
  const dots = [0, 1, 2]
  return (
    <div style={styles.loadWrap}>
      <div style={styles.loadGlow} />

      <div style={styles.loadContent}>
        <div style={styles.loadLogoWrap}>
          <div style={styles.loadRing} />
          <LensLogo size={52} spinning />
        </div>

        <div style={styles.loadStage}>
          <span style={stage === 'crawling' ? styles.loadStageActive : styles.loadStageDone}>
            {stage === 'crawling' ? '●' : '✓'} Crawling XHS
          </span>
          <span style={styles.loadArrow}>→</span>
          <span style={stage === 'analyzing' ? styles.loadStageActive : styles.loadStagePending}>
            {stage === 'analyzing' ? '●' : '○'} AI Analysis
          </span>
        </div>

        <h2 style={styles.loadKeyword}>"{keyword}"</h2>

        <p style={styles.loadMessage}>
          {message}
          <span style={{ animation: 'blink 1s step-start infinite' }}>_</span>
        </p>

        <div style={styles.loadDots}>
          {dots.map(i => (
            <span
              key={i}
              style={{
                ...styles.loadDot,
                animationDelay: `${i * 0.2}s`,
              }}
            />
          ))}
        </div>

        <button style={styles.cancelBtn} onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  )
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  const formatted = value >= 10000
    ? `${(value / 10000).toFixed(1)}万`
    : value.toLocaleString()

  return (
    <div style={styles.metricCard}>
      <span style={styles.metricIcon}>{icon}</span>
      <span style={styles.metricValue}>{formatted}</span>
      <span style={styles.metricLabel}>{label}</span>
    </div>
  )
}

// ─── Report Screen ────────────────────────────────────────────────────────────

function ReportScreen({
  result,
  keyword,
  onReset,
}: {
  result: AnalysisResult
  keyword: string
  onReset: () => void
}) {
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)

  const copyHook = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }, [])

  const ms = result.metrics_summary
  const ci = result.content_insights
  const cmi = result.comment_insights

  return (
    <div style={styles.reportWrap}>
      {/* Sticky nav */}
      <div style={styles.reportNav}>
        <div style={styles.navLeft}>
          <LensLogo size={24} />
          <span style={styles.navBrand}>RedLens</span>
        </div>
        <div style={styles.navKeyword}>"{keyword}"</div>
        <button style={styles.navNew} onClick={onReset}>
          + New Analysis
        </button>
      </div>

      <div style={styles.reportContent}>
        {/* Hero summary */}
        <section style={styles.reportHero}>
          <div style={styles.reportMeta}>
            <span style={styles.reportMetaItem}>
              {ms.total_posts_analyzed} posts analyzed
            </span>
            <span style={styles.reportMetaDot}>·</span>
            <span style={styles.reportMetaItem}>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            <span style={styles.reportMetaDot}>·</span>
            <span style={styles.reportMetaModel}>{result._meta?.model || 'mimo-v2.5'}</span>
          </div>
          <h1 style={styles.reportTitle}>
            Intelligence Report:<br />
            <em style={styles.reportTitleEm}>{keyword}</em>
          </h1>
          <p style={styles.reportSummary}>{result.summary}</p>
        </section>

        {/* Metrics row */}
        <section style={styles.section}>
          <div style={styles.metricsRow}>
            <MetricCard label="Avg. Likes" value={ms.avg_likes} icon="❤️" />
            <MetricCard label="Avg. Collects" value={ms.avg_collects} icon="⭐" />
            <MetricCard label="Avg. Comments" value={ms.avg_comments} icon="💬" />
            <MetricCard label="Top Post Likes" value={ms.top_post_likes} icon="🔥" />
          </div>
          {ms.engagement_rate_insight && (
            <p style={styles.engagementInsight}>{ms.engagement_rate_insight}</p>
          )}
        </section>

        {/* Top Patterns */}
        {result.top_patterns?.length > 0 && (
          <section style={styles.section}>
            <SectionHeader label="TOP PATTERNS" title="What's Working" />
            <div style={styles.patternsScroll}>
              {result.top_patterns.map((p, i) => (
                <div key={i} style={styles.patternCard}>
                  <div style={styles.patternNum}>0{i + 1}</div>
                  <h3 style={styles.patternTitle}>{p.pattern}</h3>
                  <div style={styles.patternFreq}>{p.frequency}</div>
                  {p.example && (
                    <p style={styles.patternExample}>"{p.example}"</p>
                  )}
                  <p style={styles.patternWhy}>{p.why_it_works}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Content Insights */}
        <section style={styles.section}>
          <SectionHeader label="CONTENT INSIGHTS" title="The Formula" />
          <div style={styles.insightGrid}>
            {ci.winning_title_formulas?.length > 0 && (
              <div style={styles.insightCard}>
                <h4 style={styles.insightCardTitle}>Title Formulas That Win</h4>
                {ci.winning_title_formulas.map((f, i) => (
                  <div key={i} style={styles.formula}>
                    <span style={styles.formulaNum}>{i + 1}</span>
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            )}

            {ci.best_content_formats?.length > 0 && (
              <div style={styles.insightCard}>
                <h4 style={styles.insightCardTitle}>Best Content Formats</h4>
                {ci.best_content_formats.map((f, i) => (
                  <div key={i} style={styles.formatItem}>
                    <span style={styles.formatBullet} />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            )}

            <div style={styles.insightCard}>
              <h4 style={styles.insightCardTitle}>Length & Visuals</h4>
              {ci.optimal_length && <p style={styles.insightText}>{ci.optimal_length}</p>}
              {ci.visual_patterns && <p style={styles.insightText}>{ci.visual_patterns}</p>}
            </div>

            {ci.key_keywords_used?.length > 0 && (
              <div style={styles.insightCard}>
                <h4 style={styles.insightCardTitle}>Key Keywords in Top Posts</h4>
                <div style={styles.pillRow}>
                  {ci.key_keywords_used.map((kw, i) => (
                    <span key={i} style={styles.pill}>{kw}</span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </section>

        {/* Comment Intelligence */}
        <section style={styles.section}>
          <SectionHeader label="COMMENT INTELLIGENCE" title="The Conversation" />
          <div style={styles.commentGrid}>
            {cmi.top_pain_points?.length > 0 && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}>
                  <span style={{ color: 'var(--red)' }}>⚡</span> Top Pain Points
                </h4>
                {cmi.top_pain_points.map((p, i) => (
                  <div key={i} style={styles.commentItem}>
                    <span style={styles.commentBullet}>→</span>
                    <span>{p}</span>
                  </div>
                ))}
              </div>
            )}
            {cmi.common_questions?.length > 0 && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}>
                  <span style={{ color: 'var(--gold)' }}>?</span> Common Questions
                </h4>
                {cmi.common_questions.map((q, i) => (
                  <div key={i} style={styles.commentItem}>
                    <span style={styles.commentBullet}>→</span>
                    <span>{q}</span>
                  </div>
                ))}
              </div>
            )}
            {cmi.sentiment && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}>Sentiment Overview</h4>
                <p style={styles.sentimentText}>{cmi.sentiment}</p>
              </div>
            )}
          </div>
        </section>

        {/* Suggested Angles */}
        {result.suggested_angles?.length > 0 && (
          <section style={styles.section}>
            <SectionHeader label="SUGGESTED ANGLES" title="Your Opportunity" />
            <div style={styles.anglesGrid}>
              {result.suggested_angles.map((a, i) => (
                <div key={i} style={styles.angleCard}>
                  <div style={styles.angleNum}>0{i + 1}</div>
                  <h3 style={styles.angleTitle}>{a.angle}</h3>
                  <div style={styles.angleDivider} />
                  <p style={styles.angleRationale}>{a.rationale}</p>
                  <div style={styles.angleDiff}>
                    <span style={styles.angleDiffLabel}>How to differentiate</span>
                    <p>{a.differentiation}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Hook Examples */}
        {result.hook_examples?.length > 0 && (
          <section style={styles.section}>
            <SectionHeader label="HOOK EXAMPLES" title="Steal These Openers" />
            <div style={styles.hooksCol}>
              {result.hook_examples.map((h, i) => (
                <div key={i} style={styles.hookCard}>
                  <span style={styles.hookNum}>0{i + 1}</span>
                  <span style={styles.hookText}>{h}</span>
                  <button
                    style={{
                      ...styles.copyBtn,
                      ...(copiedIdx === i ? styles.copyBtnDone : {}),
                    }}
                    onClick={() => copyHook(h, i)}
                  >
                    {copiedIdx === i ? '✓ Copied' : 'Copy'}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Posts Analyzed */}
        {result._posts?.length > 0 && (
          <section style={styles.section}>
            <SectionHeader label="SOURCE DATA" title="Posts Analyzed" />
            <div style={styles.postsGrid}>
              {result._posts.map((p, i) => (
                <div key={i} style={styles.postCard}>
                  <div style={styles.postHeader}>
                    <span style={styles.postType}>{p.type === 'video' ? '▶ Video' : '📄 Note'}</span>
                    <span style={styles.postCreator}>@{p.user}</span>
                  </div>
                  <p style={styles.postTitle}>{p.title || '(no title)'}</p>
                  <div style={styles.postMetrics}>
                    <span>❤️ {fmtNum(p.liked_count)}</span>
                    <span>⭐ {fmtNum(p.collected_count)}</span>
                    <span>💬 {fmtNum(p.comment_count)}</span>
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Footer */}
        <footer style={styles.reportFooter}>
          <LensLogo size={20} />
          <span>RedLens · Powered by <strong>mimo-v2.5</strong> · For research and learning only</span>
          {result._meta && (
            <span style={styles.tokenMeta}>
              {result._meta.prompt_tokens + result._meta.completion_tokens} tokens used
            </span>
          )}
        </footer>
      </div>
    </div>
  )
}

function SectionHeader({ label, title }: { label: string; title: string }) {
  return (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionLabel}>{label}</span>
      <h2 style={styles.sectionTitle}>{title}</h2>
    </div>
  )
}

function fmtNum(n: number): string {
  if (n >= 10000) return `${(n / 10000).toFixed(1)}万`
  return n.toLocaleString()
}

// ─── Main App ─────────────────────────────────────────────────────────────────

export default function App() {
  const [appState, setAppState] = useState<AppState>('setup')
  const [loadStage, setLoadStage] = useState<LoadStage>('crawling')
  const [loadMessage, setLoadMessage] = useState('')
  const [keyword, setKeyword] = useState('')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  const handleAnalyze = useCallback((kw: string, cookie: string, maxNotes: number) => {
    setKeyword(kw)
    setAppState('loading')
    setLoadStage('crawling')
    setLoadMessage(`Searching XHS for "${kw}"…`)
    setError(null)

    const params = new URLSearchParams({
      keyword: kw,
      cookie,
      max_notes: String(maxNotes),
    })
    const es = new EventSource(`/api/analyze?${params}`)
    esRef.current = es

    es.addEventListener('status', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      setLoadStage(data.stage as LoadStage)
      setLoadMessage(data.message)
    })

    es.addEventListener('done', (e: MessageEvent) => {
      const data: AnalysisResult = JSON.parse(e.data)
      setResult(data)
      setAppState('report')
      es.close()
    })

    es.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setError(data.message || 'Something went wrong.')
      } catch {
        setError('Connection error. Please check your cookie and try again.')
      }
      setAppState('error')
      es.close()
    })

    es.onerror = () => {
      // Only trigger if not already handled above
      if (appState === 'loading') {
        setError('Connection lost. Please try again.')
        setAppState('error')
        es.close()
      }
    }
  }, [appState])

  const handleCancel = useCallback(() => {
    esRef.current?.close()
    setAppState('setup')
  }, [])

  const handleReset = useCallback(() => {
    esRef.current?.close()
    setResult(null)
    setError(null)
    setAppState('setup')
  }, [])

  if (appState === 'loading') {
    return (
      <LoadingScreen
        stage={loadStage}
        message={loadMessage}
        keyword={keyword}
        onCancel={handleCancel}
      />
    )
  }

  if (appState === 'report' && result) {
    return <ReportScreen result={result} keyword={keyword} onReset={handleReset} />
  }

  if (appState === 'error') {
    return (
      <div style={styles.errorWrap}>
        <div style={styles.errorCard}>
          <LensLogo size={40} />
          <h2 style={styles.errorTitle}>Analysis Failed</h2>
          <p style={styles.errorMsg}>{error}</p>
          <button style={styles.analyzeBtn} onClick={handleReset}>
            Try Again
          </button>
        </div>
      </div>
    )
  }

  return <SetupScreen onAnalyze={handleAnalyze} />
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  // Setup
  setupWrap: {
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '0 24px 60px',
    position: 'relative',
  },
  setupGlow: {
    position: 'fixed',
    top: '-200px',
    left: '50%',
    transform: 'translateX(-50%)',
    width: '600px',
    height: '600px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(229,26,40,0.08) 0%, transparent 70%)',
    pointerEvents: 'none',
  },
  setupHeader: {
    width: '100%',
    maxWidth: '640px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '28px 0 0',
  },
  logoRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
  },
  wordmark: {
    fontFamily: 'var(--font-display)',
    fontSize: '20px',
    fontWeight: 700,
    color: 'var(--text)',
    letterSpacing: '-0.02em',
  },
  headerTag: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.12em',
    color: 'var(--text-3)',
    textTransform: 'uppercase',
  },
  hero: {
    width: '100%',
    maxWidth: '640px',
    padding: '64px 0 48px',
    animation: 'fade-up 0.6s ease',
  },
  heroTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(36px, 6vw, 56px)',
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: '-0.03em',
    color: 'var(--text)',
    marginBottom: '20px',
  },
  heroEm: {
    fontStyle: 'italic',
    color: 'var(--red)',
  },
  heroSub: {
    fontSize: '16px',
    lineHeight: 1.7,
    color: 'var(--text-2)',
    maxWidth: '480px',
  },
  formCard: {
    width: '100%',
    maxWidth: '640px',
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: '16px',
    padding: '32px',
    display: 'flex',
    flexDirection: 'column',
    gap: '28px',
    animation: 'fade-up 0.7s ease',
    backdropFilter: 'blur(12px)',
  },
  fieldGroup: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  label: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.14em',
    color: 'var(--text-3)',
    textTransform: 'uppercase',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  input: {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '14px 16px',
    color: 'var(--text)',
    fontSize: '16px',
    outline: 'none',
    transition: 'border-color 0.2s',
    width: '100%',
  },
  accordionTrigger: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    width: '100%',
    padding: '0',
  },
  cookieBadge: {
    background: 'rgba(62, 207, 142, 0.15)',
    color: 'var(--green)',
    padding: '2px 8px',
    borderRadius: '4px',
    fontSize: '10px',
    fontWeight: 600,
  },
  cookieHelp: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    fontSize: '13px',
    color: 'var(--text-2)',
    marginBottom: '8px',
    flexWrap: 'wrap',
  },
  helpBtn: {
    color: 'var(--red)',
    fontSize: '13px',
    textDecoration: 'underline',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    padding: 0,
    fontFamily: 'var(--font-ui)',
  },
  cookieHelpBox: {
    background: 'var(--bg-3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '16px',
    marginBottom: '10px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  helpStep: {
    fontSize: '13px',
    color: 'var(--text-2)',
    lineHeight: 1.5,
  },
  code: {
    background: 'var(--bg)',
    border: '1px solid var(--border)',
    borderRadius: '3px',
    padding: '1px 5px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--gold)',
  },
  cookieInput: {
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '14px 16px',
    color: 'var(--text-2)',
    fontSize: '12px',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    resize: 'vertical',
    width: '100%',
    lineHeight: 1.5,
  },
  slider: {
    width: '100%',
    accentColor: 'var(--red)',
    cursor: 'pointer',
    height: '4px',
  },
  sliderVal: {
    fontFamily: 'var(--font-mono)',
    fontSize: '14px',
    color: 'var(--red)',
    fontWeight: 600,
    marginLeft: '4px',
  },
  sliderLabels: {
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '11px',
    color: 'var(--text-3)',
  },
  analyzeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '10px',
    background: 'var(--red)',
    color: '#fff',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    padding: '16px 24px',
    fontSize: '16px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'opacity 0.2s, transform 0.1s',
    fontFamily: 'var(--font-ui)',
    letterSpacing: '-0.01em',
  },
  analyzeBtnDisabled: {
    opacity: 0.35,
    cursor: 'not-allowed',
  },
  cookieHint: {
    fontSize: '13px',
    color: 'var(--text-3)',
    textAlign: 'center',
  },
  inlineBtn: {
    color: 'var(--red)',
    background: 'none',
    border: 'none',
    cursor: 'pointer',
    fontFamily: 'var(--font-ui)',
    fontSize: '13px',
    textDecoration: 'underline',
  },
  setupFooter: {
    marginTop: '40px',
    fontSize: '12px',
    color: 'var(--text-3)',
    fontFamily: 'var(--font-mono)',
    textAlign: 'center',
  },

  // Loading
  loadWrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
  },
  loadGlow: {
    position: 'fixed',
    top: '50%',
    left: '50%',
    transform: 'translate(-50%, -50%)',
    width: '500px',
    height: '500px',
    borderRadius: '50%',
    background: 'radial-gradient(circle, rgba(229,26,40,0.1) 0%, transparent 65%)',
    animation: 'pulse-ring 3s ease-in-out infinite',
    pointerEvents: 'none',
  },
  loadContent: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '20px',
    padding: '40px',
    textAlign: 'center',
  },
  loadLogoWrap: {
    position: 'relative',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadRing: {
    position: 'absolute',
    width: '80px',
    height: '80px',
    borderRadius: '50%',
    border: '1px solid rgba(229,26,40,0.3)',
    animation: 'pulse-ring 2s ease-in-out infinite',
  },
  loadStage: {
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    letterSpacing: '0.08em',
  },
  loadStageActive: {
    color: 'var(--red)',
    fontWeight: 600,
  },
  loadStageDone: {
    color: 'var(--green)',
    fontWeight: 600,
  },
  loadStagePending: {
    color: 'var(--text-3)',
  },
  loadArrow: {
    color: 'var(--text-3)',
  },
  loadKeyword: {
    fontFamily: 'var(--font-display)',
    fontSize: '28px',
    fontWeight: 700,
    fontStyle: 'italic',
    color: 'var(--text)',
    letterSpacing: '-0.02em',
  },
  loadMessage: {
    fontSize: '14px',
    color: 'var(--text-2)',
    fontFamily: 'var(--font-mono)',
  },
  loadDots: {
    display: 'flex',
    gap: '6px',
  },
  loadDot: {
    display: 'inline-block',
    width: '6px',
    height: '6px',
    borderRadius: '50%',
    background: 'var(--red)',
    animation: 'pulse-ring 1.2s ease-in-out infinite',
    opacity: 0.6,
  },
  cancelBtn: {
    marginTop: '12px',
    color: 'var(--text-3)',
    fontSize: '13px',
    textDecoration: 'underline',
    cursor: 'pointer',
    background: 'none',
    border: 'none',
    fontFamily: 'var(--font-ui)',
  },

  // Report
  reportWrap: {
    minHeight: '100vh',
    background: 'var(--bg)',
  },
  reportNav: {
    position: 'sticky',
    top: 0,
    zIndex: 100,
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    padding: '14px 24px',
    background: 'rgba(8,8,9,0.92)',
    backdropFilter: 'blur(16px)',
    borderBottom: '1px solid var(--border)',
  },
  navLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexShrink: 0,
  },
  navBrand: {
    fontFamily: 'var(--font-display)',
    fontWeight: 700,
    fontSize: '16px',
    letterSpacing: '-0.02em',
  },
  navKeyword: {
    flex: 1,
    fontFamily: 'var(--font-display)',
    fontSize: '14px',
    fontStyle: 'italic',
    color: 'var(--text-2)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  navNew: {
    background: 'var(--bg-3)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    color: 'var(--text)',
    padding: '7px 14px',
    fontSize: '13px',
    fontWeight: 600,
    cursor: 'pointer',
    flexShrink: 0,
    fontFamily: 'var(--font-ui)',
  },
  reportContent: {
    maxWidth: '900px',
    margin: '0 auto',
    padding: '0 24px 80px',
  },
  reportHero: {
    padding: '60px 0 40px',
    animation: 'fade-up 0.5s ease',
  },
  reportMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    marginBottom: '20px',
    flexWrap: 'wrap',
  },
  reportMetaItem: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--text-3)',
  },
  reportMetaDot: {
    color: 'var(--text-3)',
  },
  reportMetaModel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--gold)',
    background: 'rgba(201,169,110,0.1)',
    padding: '2px 8px',
    borderRadius: '4px',
  },
  reportTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: 'clamp(32px, 5vw, 52px)',
    fontWeight: 700,
    lineHeight: 1.1,
    letterSpacing: '-0.03em',
    color: 'var(--text)',
    marginBottom: '20px',
  },
  reportTitleEm: {
    fontStyle: 'italic',
    color: 'var(--red)',
  },
  reportSummary: {
    fontSize: '16px',
    lineHeight: 1.8,
    color: 'var(--text-2)',
    maxWidth: '680px',
    borderLeft: '2px solid var(--red)',
    paddingLeft: '20px',
  },
  section: {
    marginBottom: '64px',
    animation: 'fade-up 0.5s ease',
  },
  sectionHeader: {
    marginBottom: '24px',
  },
  sectionLabel: {
    display: 'block',
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.16em',
    color: 'var(--text-3)',
    marginBottom: '6px',
  },
  sectionTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '28px',
    fontWeight: 700,
    letterSpacing: '-0.02em',
    color: 'var(--text)',
  },

  // Metrics
  metricsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
    gap: '12px',
    marginBottom: '16px',
  },
  metricCard: {
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '20px',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
  },
  metricIcon: {
    fontSize: '18px',
  },
  metricValue: {
    fontFamily: 'var(--font-mono)',
    fontSize: '28px',
    fontWeight: 500,
    color: 'var(--text)',
    letterSpacing: '-0.02em',
  },
  metricLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.1em',
    color: 'var(--text-3)',
    textTransform: 'uppercase',
  },
  engagementInsight: {
    fontSize: '13px',
    color: 'var(--text-2)',
    fontStyle: 'italic',
    paddingLeft: '12px',
    borderLeft: '1px solid var(--border)',
  },

  // Patterns
  patternsScroll: {
    display: 'flex',
    gap: '16px',
    overflowX: 'auto',
    paddingBottom: '8px',
    scrollSnapType: 'x mandatory',
  },
  patternCard: {
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '24px',
    minWidth: '260px',
    maxWidth: '320px',
    flexShrink: 0,
    scrollSnapAlign: 'start',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
    transition: 'border-color 0.2s',
  },
  patternNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--red)',
    letterSpacing: '0.1em',
    fontWeight: 600,
  },
  patternTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '18px',
    fontWeight: 700,
    color: 'var(--text)',
    lineHeight: 1.3,
  },
  patternFreq: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--gold)',
    background: 'rgba(201,169,110,0.1)',
    padding: '2px 8px',
    borderRadius: '4px',
    alignSelf: 'flex-start',
  },
  patternExample: {
    fontSize: '13px',
    color: 'var(--text-3)',
    fontStyle: 'italic',
    lineHeight: 1.5,
  },
  patternWhy: {
    fontSize: '13px',
    color: 'var(--text-2)',
    lineHeight: 1.6,
    marginTop: '4px',
  },

  // Insights
  insightGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: '16px',
  },
  insightCard: {
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  insightCardTitle: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.1em',
    color: 'var(--text-3)',
    textTransform: 'uppercase',
    paddingBottom: '8px',
    borderBottom: '1px solid var(--border)',
  },
  formula: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    fontSize: '14px',
    color: 'var(--text)',
    lineHeight: 1.5,
  },
  formulaNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--red)',
    fontWeight: 700,
    flexShrink: 0,
    paddingTop: '2px',
  },
  formatItem: {
    display: 'flex',
    gap: '10px',
    alignItems: 'flex-start',
    fontSize: '14px',
    color: 'var(--text)',
    lineHeight: 1.5,
  },
  formatBullet: {
    display: 'block',
    width: '4px',
    height: '4px',
    borderRadius: '50%',
    background: 'var(--red)',
    marginTop: '8px',
    flexShrink: 0,
  },
  insightText: {
    fontSize: '14px',
    color: 'var(--text-2)',
    lineHeight: 1.6,
  },
  pillRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: '6px',
  },
  pill: {
    background: 'var(--red-dim)',
    border: '1px solid rgba(229,26,40,0.2)',
    color: 'var(--text)',
    padding: '4px 12px',
    borderRadius: '100px',
    fontSize: '13px',
    fontFamily: 'var(--font-mono)',
  },

  // Comments
  commentGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '16px',
  },
  commentCard: {
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '24px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
  },
  commentCardTitle: {
    fontSize: '14px',
    fontWeight: 600,
    color: 'var(--text)',
    paddingBottom: '8px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
  },
  commentItem: {
    display: 'flex',
    gap: '8px',
    fontSize: '14px',
    color: 'var(--text-2)',
    lineHeight: 1.5,
    alignItems: 'flex-start',
  },
  commentBullet: {
    color: 'var(--red)',
    flexShrink: 0,
    fontWeight: 700,
  },
  sentimentText: {
    fontSize: '14px',
    color: 'var(--text-2)',
    lineHeight: 1.7,
    fontStyle: 'italic',
  },

  // Angles
  anglesGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
    gap: '16px',
  },
  angleCard: {
    background: 'linear-gradient(135deg, var(--bg-1) 0%, rgba(229,26,40,0.03) 100%)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '28px',
    display: 'flex',
    flexDirection: 'column',
    gap: '12px',
    transition: 'border-color 0.2s',
  },
  angleNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: '12px',
    color: 'var(--red)',
    fontWeight: 700,
    letterSpacing: '0.1em',
  },
  angleTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '20px',
    fontWeight: 700,
    color: 'var(--text)',
    lineHeight: 1.3,
    letterSpacing: '-0.01em',
  },
  angleDivider: {
    height: '1px',
    background: 'var(--border)',
  },
  angleRationale: {
    fontSize: '14px',
    color: 'var(--text-2)',
    lineHeight: 1.6,
  },
  angleDiff: {
    background: 'var(--bg-2)',
    borderRadius: 'var(--radius-sm)',
    padding: '12px',
    fontSize: '13px',
    color: 'var(--text-2)',
    lineHeight: 1.5,
    display: 'flex',
    flexDirection: 'column',
    gap: '6px',
  },
  angleDiffLabel: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    letterSpacing: '0.1em',
    color: 'var(--gold)',
    textTransform: 'uppercase',
  },

  // Hooks
  hooksCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '10px',
  },
  hookCard: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '18px 20px',
    transition: 'border-color 0.2s',
  },
  hookNum: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text-3)',
    flexShrink: 0,
    width: '24px',
  },
  hookText: {
    flex: 1,
    fontSize: '15px',
    color: 'var(--text)',
    lineHeight: 1.5,
  },
  copyBtn: {
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    letterSpacing: '0.08em',
    color: 'var(--text-3)',
    background: 'var(--bg-2)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)',
    padding: '6px 12px',
    cursor: 'pointer',
    flexShrink: 0,
    transition: 'all 0.2s',
    textTransform: 'uppercase',
  },
  copyBtnDone: {
    color: 'var(--green)',
    borderColor: 'rgba(62,207,142,0.3)',
    background: 'rgba(62,207,142,0.08)',
  },

  // Posts grid
  postsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: '12px',
  },
  postCard: {
    background: 'var(--bg-1)',
    border: '1px solid var(--border)',
    borderRadius: 'var(--radius)',
    padding: '16px',
    display: 'flex',
    flexDirection: 'column',
    gap: '8px',
  },
  postHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  postType: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--text-3)',
  },
  postCreator: {
    fontFamily: 'var(--font-mono)',
    fontSize: '10px',
    color: 'var(--text-3)',
    maxWidth: '100px',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  postTitle: {
    fontSize: '13px',
    color: 'var(--text)',
    lineHeight: 1.4,
    flex: 1,
    display: '-webkit-box',
    WebkitLineClamp: 3,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  } as React.CSSProperties,
  postMetrics: {
    display: 'flex',
    gap: '10px',
    fontFamily: 'var(--font-mono)',
    fontSize: '11px',
    color: 'var(--text-3)',
    flexWrap: 'wrap',
  },

  // Error
  errorWrap: {
    minHeight: '100vh',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '24px',
  },
  errorCard: {
    maxWidth: '400px',
    width: '100%',
    background: 'var(--bg-1)',
    border: '1px solid rgba(229,26,40,0.2)',
    borderRadius: '16px',
    padding: '40px',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '16px',
    textAlign: 'center',
  },
  errorTitle: {
    fontFamily: 'var(--font-display)',
    fontSize: '24px',
    fontWeight: 700,
    color: 'var(--text)',
  },
  errorMsg: {
    fontSize: '14px',
    color: 'var(--text-2)',
    lineHeight: 1.6,
  },

  // Report footer
  reportFooter: {
    display: 'flex',
    alignItems: 'center',
    gap: '10px',
    padding: '24px 0',
    borderTop: '1px solid var(--border)',
    fontSize: '12px',
    color: 'var(--text-3)',
    fontFamily: 'var(--font-mono)',
    flexWrap: 'wrap',
  },
  tokenMeta: {
    marginLeft: 'auto',
    fontSize: '11px',
    color: 'var(--text-3)',
  },
}
