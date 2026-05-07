import { useState, useRef, useCallback, useEffect, createContext, useContext } from 'react'
import { SignedIn, SignedOut, SignIn, UserButton, useAuth } from '@clerk/clerk-react'
import { Lang, loadLang, saveLang, t as translations, LANG_LABELS } from './i18n'
import { detectExtension } from './extensionApi'
import { scrapeXhsViaExtension } from './extensionScrapers'

// ─── i18n context ─────────────────────────────────────────────────────────────

type T = typeof translations.zh
const LangContext = createContext<{ lang: Lang; T: T; setLang: (l: Lang) => void }>({
  lang: 'zh', T: translations.zh, setLang: () => {},
})
const useLang = () => useContext(LangContext)

// ─── Storage helpers ──────────────────────────────────────────────────────────

type Platform = 'xhs' | 'douyin'

const STORAGE_KEYS: Record<Platform, { cookie: string; username: string }> = {
  xhs: { cookie: 'redlens_xhs_cookie', username: 'redlens_xhs_username' },
  douyin: { cookie: 'redlens_douyin_cookie', username: 'redlens_douyin_username' },
}

function loadSession(p: Platform) {
  const k = STORAGE_KEYS[p]
  return {
    cookie: localStorage.getItem(k.cookie) ?? '',
    username: localStorage.getItem(k.username) ?? '',
  }
}
function storeSession(p: Platform, cookie: string, username: string) {
  const k = STORAGE_KEYS[p]
  localStorage.setItem(k.cookie, cookie)
  localStorage.setItem(k.username, username)
}
function clearSession(p: Platform) {
  const k = STORAGE_KEYS[p]
  localStorage.removeItem(k.cookie)
  localStorage.removeItem(k.username)
}

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
  trending_tags?: string[]
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
  play_count?: number
  cover_url: string
  type: string
  duration?: number
  note_url?: string
}
interface AnalysisMeta {
  model: string
  completion_tokens: number
  reasoning_tokens: number
  prompt_tokens: number
  platform?: string
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
  _platform?: string
}

// ─── Platform config ──────────────────────────────────────────────────────────

const PLATFORMS: { id: Platform; label: string; emoji: string; color: string; name: string }[] = [
  { id: 'xhs', label: '小红书', emoji: '📕', color: '#E51A28', name: 'Xiaohongshu' },
  { id: 'douyin', label: '抖音', emoji: '🎵', color: '#161823', name: 'Douyin' },
]

// ─── Lens Logo ────────────────────────────────────────────────────────────────

function LensLogo({ size = 40, spinning = false }: { size?: number; spinning?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none"
      style={{ animation: spinning ? 'spin-slow 3s linear infinite' : undefined, flexShrink: 0 }}>
      <circle cx="20" cy="20" r="18" stroke="#E51A28" strokeWidth="1.5" />
      {[0, 60, 120, 180, 240, 300].map((angle, i) => (
        <path key={i}
          d={`M20 20 L${20 + 14 * Math.cos((angle * Math.PI) / 180)} ${20 + 14 * Math.sin((angle * Math.PI) / 180)} A14 14 0 0 1 ${20 + 14 * Math.cos(((angle + 55) * Math.PI) / 180)} ${20 + 14 * Math.sin(((angle + 55) * Math.PI) / 180)} Z`}
          fill="#E51A28" opacity={0.15 + i * 0.05} />
      ))}
      <circle cx="20" cy="20" r="6" fill="#E51A28" opacity="0.9" />
      <circle cx="20" cy="20" r="3" fill="#080809" />
    </svg>
  )
}

// ─── Douyin Cookie Section ────────────────────────────────────────────────────

function DouyinCookieSection({ session, onSave, onClear, isExpired = false }: {
  session: { cookie: string; username: string }
  onSave: (cookie: string) => void
  onClear: () => void
  isExpired?: boolean
}) {
  const { T } = useLang()
  const [expanded, setExpanded] = useState(!session.cookie)
  const [input, setInput] = useState('')

  if (session.cookie) {
    return (
      <div style={styles.sessionRow}>
        <div style={styles.sessionBadge}>
          <span style={styles.sessionDot} />
          <span style={styles.sessionName}>{session.username || T.connected}</span>
        </div>
        <button style={styles.switchBtn} onClick={onClear}>{T.switch_account}</button>
      </div>
    )
  }

  return (
    <div style={styles.cookieSection}>
      {isExpired && (
        <div style={styles.cookieExpiredBanner}>{T.session_expired_douyin}</div>
      )}
      <button style={styles.cookieToggle} onClick={() => setExpanded(x => !x)}>
        <span>{T.douyin_paste_btn}</span>
        <span style={{ color: 'var(--text-3)', fontSize: '12px' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={styles.cookieBody}>
          <p style={styles.cookieInstructions}>
            1. {T.douyin_step_1}<br />
            2. {T.douyin_step_2}<br />
            3. {T.douyin_step_3}<br />
            4. {T.douyin_step_4}
          </p>
          <textarea
            style={styles.cookieTextarea}
            placeholder="msToken=...; ttwid=...; s_v_web_id=..."
            value={input}
            onChange={e => setInput(e.target.value)}
            rows={3}
          />
          <button
            style={{ ...styles.cookieSaveBtn, ...(input.trim() ? {} : styles.analyzeBtnDisabled) }}
            disabled={!input.trim()}
            onClick={() => { onSave(input.trim()); setInput('') }}
          >
            {T.save_cookie}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── XHS Auth Section ────────────────────────────────────────────────────────

function XHSAuthSection({ onSave, isExpired }: {
  onSave: (cookie: string) => void
  isExpired?: boolean
}) {
  const { T } = useLang()
  const [input, setInput] = useState('')
  const [validationError, setValidationError] = useState('')

  const handleSave = () => {
    const cookie = input.trim()
    if (!cookie.includes('web_session=')) { setValidationError(T.cookie_validation_no_session); return }
    if (!cookie.includes('a1=')) { setValidationError(T.cookie_validation_no_a1); return }
    setValidationError('')
    onSave(cookie)
    setInput('')
  }

  return (
    <div style={styles.cookieSection}>
      {isExpired && (
        <div style={styles.cookieExpiredBanner}>{T.session_expired_xhs}</div>
      )}
      <div style={styles.cookieBody}>
        <div style={styles.bookmarkletBox}>
          <p style={styles.bookmarkletTitle}>{T.cookie_one_click_title}</p>
          <ol style={styles.bookmarkletSteps}>
            <li>
              <a href="/extension.zip" download="nichelens-extension.zip" style={{ color: 'var(--red)', fontWeight: 600 }}>
                {T.cookie_step_download} nichelens-extension.zip ↓
              </a>{T.cookie_step_unzip}
            </li>
            <li>{T.cookie_step_load}</li>
            <li>{T.cookie_step_visit}</li>
            <li>{T.cookie_step_click}</li>
          </ol>
          <p style={styles.bookmarkletNote}>{T.cookie_note} {T.cookie_manual_fallback}</p>
        </div>
        <textarea
          style={styles.cookieTextarea}
          placeholder="a1=...; web_session=...; webId=..."
          value={input}
          onChange={e => { setInput(e.target.value); setValidationError('') }}
          rows={4}
        />
        {validationError && (
          <div style={styles.validationError}>{validationError}</div>
        )}
        <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center' }}>
          <button
            style={{ ...styles.cookieSaveBtn, ...(input.trim() ? {} : styles.analyzeBtnDisabled) }}
            disabled={!input.trim()}
            onClick={handleSave}
          >
            {T.save_cookie}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────

const DATE_RANGE_OPTIONS = [
  { value: 'all', label: 'All time' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
  { value: '90d', label: 'Last 3 months' },
  { value: '180d', label: 'Last 6 months' },
]

function SetupScreen({ onAnalyze, expiredPlatform }: {
  onAnalyze: (keyword: string, cookie: string, maxNotes: number, platform: Platform, dateRange: string) => void
  expiredPlatform?: Platform
}) {
  const { T, lang, setLang } = useLang()
  const [platform, setPlatform] = useState<Platform>(expiredPlatform ?? 'xhs')
  const [keyword, setKeyword] = useState('')
  const [maxNotes, setMaxNotes] = useState(15)
  const [dateRange, setDateRange] = useState('30d')

  const dateOptions = [
    { value: 'all', label: T.date_all },
    { value: '7d', label: T.date_7d },
    { value: '30d', label: T.date_30d },
    { value: '90d', label: T.date_90d },
    { value: '180d', label: T.date_180d },
  ]
  const [sessions, setSessions] = useState<Record<Platform, { cookie: string; username: string }>>({
    xhs: loadSession('xhs'),
    douyin: loadSession('douyin'),
  })

  const session = sessions[platform]
  const canSubmit = keyword.trim().length > 0 && session.cookie.trim().length > 0
  const activePlatform = PLATFORMS.find(p => p.id === platform)!

  const handleClearSession = useCallback((p: Platform) => {
    clearSession(p)
    setSessions(s => ({ ...s, [p]: { cookie: '', username: '' } }))
  }, [])

  const handleDouyinSave = useCallback((cookie: string) => {
    storeSession('douyin', cookie, '')
    setSessions(s => ({ ...s, douyin: { cookie, username: '' } }))
  }, [])

  return (
    <div style={styles.setupWrap}>
      <div style={styles.setupGlow} />

      {/* Header */}
      <header style={styles.setupHeader}>
        <div style={styles.logoRow}>
          <LensLogo size={36} />
          <span style={styles.wordmark}>NicheLens</span>
        </div>
        <div style={styles.headerRight}>
          <button
            style={styles.langToggle}
            onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
            title="Switch language"
          >
            {lang === 'zh' ? LANG_LABELS.en : LANG_LABELS.zh}
          </button>
          <div style={styles.headerTag}>{T.brand_tag}</div>
        </div>
      </header>

      {/* Hero */}
      <div style={styles.hero}>
        <h1 style={styles.heroTitle}>
          {T.hero_title_a}<br />
          <em style={styles.heroEm}>{T.hero_title_b}</em>
        </h1>
        <p style={styles.heroSub}>{T.hero_sub}</p>
      </div>

      {/* Form card */}
      <div style={styles.formCard}>

        {/* Platform tabs */}
        <div style={styles.platformTabs}>
          {PLATFORMS.map(p => (
            <button
              key={p.id}
              style={{
                ...styles.platformTab,
                ...(platform === p.id ? styles.platformTabActive : {}),
              }}
              onClick={() => setPlatform(p.id)}
            >
              <span style={styles.platformEmoji}>{p.emoji}</span>
              <span>{p.label}</span>
              {sessions[p.id].cookie && (
                <span style={styles.platformConnectedDot} />
              )}
            </button>
          ))}
        </div>

        {/* Keyword */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{T.field_keyword}</label>
          <input
            style={styles.input}
            type="text"
            placeholder={platform === 'xhs' ? T.keyword_placeholder_xhs : T.keyword_placeholder_douyin}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canSubmit && onAnalyze(keyword, session.cookie, maxNotes, platform, dateRange)}
            autoFocus
          />
        </div>

        {/* Auth section */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>
            {activePlatform.emoji} {T.field_account(activePlatform.label)}
          </label>

          {platform === 'xhs' && (
            session.cookie ? (
              <div style={styles.sessionRow}>
                <div style={styles.sessionBadge}>
                  <span style={styles.sessionDot} />
                  <span style={styles.sessionName}>{session.username || T.connected}</span>
                </div>
                <button style={styles.switchBtn} onClick={() => handleClearSession('xhs')}>
                  {T.switch_account}
                </button>
              </div>
            ) : (
              <XHSAuthSection
                onSave={(cookie) => {
                  storeSession('xhs', cookie, '')
                  setSessions(s => ({ ...s, xhs: { cookie, username: '' } }))
                }}
                isExpired={expiredPlatform === 'xhs'}
              />
            )
          )}

          {platform === 'douyin' && (
            <DouyinCookieSection
              session={session}
              onSave={handleDouyinSave}
              onClear={() => handleClearSession('douyin')}
              isExpired={expiredPlatform === 'douyin' && !session.cookie}
            />
          )}
        </div>

        {/* Notes slider */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>
            {T.posts_to_analyze}
            <span style={styles.sliderVal}>{maxNotes}</span>
          </label>
          <input type="range" min={5} max={20} value={maxNotes}
            onChange={e => setMaxNotes(Number(e.target.value))} style={styles.slider} />
          <div style={styles.sliderLabels}>
            <span>{T.slider_faster}</span>
            <span>{T.slider_deeper}</span>
          </div>
        </div>

        {/* Date range */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>{T.date_range}</label>
          <select
            style={styles.select}
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
          >
            {dateOptions.map(opt => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
        </div>

        {/* CTA */}
        <button
          style={{ ...styles.analyzeBtn, ...(canSubmit ? {} : styles.analyzeBtnDisabled) }}
          disabled={!canSubmit}
          onClick={() => onAnalyze(keyword, session.cookie, maxNotes, platform, dateRange)}
        >
          <LensLogo size={20} />
          <span>{T.analyze_cta(keyword, activePlatform.label)}</span>
        </button>

        {!session.cookie && (
          <p style={styles.cookieHint}>{T.cookie_hint(activePlatform.label)}</p>
        )}
      </div>

      <footer style={styles.setupFooter}>{T.research_only}</footer>
    </div>
  )
}

// ─── Loading Screen ───────────────────────────────────────────────────────────

function LoadingScreen({ stage, message, keyword, platform, onCancel }: {
  stage: LoadStage
  message: string
  keyword: string
  platform: Platform
  onCancel: () => void
}) {
  const { T } = useLang()
  const platformLabel = PLATFORMS.find(p => p.id === platform)?.label ?? platform
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
            {stage === 'crawling' ? '●' : '✓'} {T.load_stage_crawling(platformLabel)}
          </span>
          <span style={styles.loadArrow}>→</span>
          <span style={stage === 'analyzing' ? styles.loadStageActive : styles.loadStagePending}>
            {stage === 'analyzing' ? '●' : '○'} {T.load_stage_analyzing}
          </span>
        </div>
        <h2 style={styles.loadKeyword}>"{keyword}"</h2>
        <p style={styles.loadMessage}>
          {message}
          <span style={{ animation: 'blink 1s step-start infinite' }}>_</span>
        </p>
        <div style={styles.loadDots}>
          {[0, 1, 2].map(i => (
            <span key={i} style={{ ...styles.loadDot, animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
        <button style={styles.cancelBtn} onClick={onCancel}>{T.cancel}</button>
      </div>
    </div>
  )
}

// ─── Metric Card ──────────────────────────────────────────────────────────────

function MetricCard({ label, value, icon }: { label: string; value: number; icon: string }) {
  const formatted = value >= 10000 ? `${(value / 10000).toFixed(1)}万` : value.toLocaleString()
  return (
    <div style={styles.metricCard}>
      <span style={styles.metricIcon}>{icon}</span>
      <span style={styles.metricValue}>{formatted}</span>
      <span style={styles.metricLabel}>{label}</span>
    </div>
  )
}

// ─── Report Screen ────────────────────────────────────────────────────────────

function ReportScreen({ result, keyword, onReset }: {
  result: AnalysisResult
  keyword: string
  onReset: () => void
}) {
  const { T } = useLang()
  const [copiedIdx, setCopiedIdx] = useState<number | null>(null)
  const copyHook = useCallback((text: string, idx: number) => {
    navigator.clipboard.writeText(text)
    setCopiedIdx(idx)
    setTimeout(() => setCopiedIdx(null), 2000)
  }, [])

  const ms = result.metrics_summary
  const ci = result.content_insights
  const cmi = result.comment_insights
  const platform = result._platform as Platform | undefined
  const platformInfo = PLATFORMS.find(p => p.id === platform)
  const isVideo = platform === 'douyin'

  return (
    <div style={styles.reportWrap}>
      {/* Sticky nav */}
      <div style={styles.reportNav}>
        <div style={styles.navLeft}>
          <LensLogo size={24} />
          <span style={styles.navBrand}>NicheLens</span>
        </div>
        <div style={styles.navKeyword}>"{keyword}"</div>
        <button style={styles.navNew} onClick={onReset}>{T.new_analysis}</button>
      </div>

      <div style={styles.reportContent}>
        {/* Hero */}
        <section style={styles.reportHero}>
          <div style={styles.reportMeta}>
            <span style={styles.reportMetaItem}>{T.report_posts_analyzed(ms.total_posts_analyzed)}</span>
            <span style={styles.reportMetaDot}>·</span>
            <span style={styles.reportMetaItem}>
              {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>
            {platformInfo && (
              <>
                <span style={styles.reportMetaDot}>·</span>
                <span style={{ ...styles.reportMetaModel, background: 'rgba(229,26,40,0.1)', color: 'var(--red)' }}>
                  {platformInfo.emoji} {platformInfo.label}
                </span>
              </>
            )}
            <span style={styles.reportMetaDot}>·</span>
            <span style={styles.reportMetaModel}>{result._meta?.model || 'mimo-v2.5'}</span>
          </div>
          <h1 style={styles.reportTitle}>
            {T.intelligence_report}：<br />
            <em style={styles.reportTitleEm}>{keyword}</em>
          </h1>
          <p style={styles.reportSummary}>{result.summary}</p>
        </section>

        {/* Metrics */}
        <section style={styles.section}>
          <div style={styles.metricsRow}>
            <MetricCard label={T.metric_avg_likes} value={ms.avg_likes} icon="❤️" />
            <MetricCard label={T.metric_avg_collects} value={ms.avg_collects} icon="⭐" />
            <MetricCard label={T.metric_avg_comments} value={ms.avg_comments} icon="💬" />
            <MetricCard label={T.metric_top_likes} value={ms.top_post_likes} icon="🔥" />
          </div>
          {ms.engagement_rate_insight && (
            <p style={styles.engagementInsight}>{ms.engagement_rate_insight}</p>
          )}
        </section>

        {/* Top Patterns */}
        {result.top_patterns?.length > 0 && (
          <section style={styles.section}>
            <SectionHeader label={T.section_top_patterns_label} title={T.section_top_patterns_title} />
            <div style={styles.patternsScroll}>
              {result.top_patterns.map((p, i) => (
                <div key={i} style={styles.patternCard}>
                  <div style={styles.patternNum}>0{i + 1}</div>
                  <h3 style={styles.patternTitle}>{p.pattern}</h3>
                  <div style={styles.patternFreq}>{p.frequency}</div>
                  {p.example && <p style={styles.patternExample}>"{p.example}"</p>}
                  <p style={styles.patternWhy}>{p.why_it_works}</p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Content Insights */}
        <section style={styles.section}>
          <SectionHeader label={T.section_content_insights_label} title={T.section_content_insights_title} />
          <div style={styles.insightGrid}>
            {ci.winning_title_formulas?.length > 0 && (
              <div style={styles.insightCard}>
                <h4 style={styles.insightCardTitle}>{isVideo ? T.card_winning_hooks : T.card_winning_titles}</h4>
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
                <h4 style={styles.insightCardTitle}>{isVideo ? T.card_best_video_styles : T.card_best_formats}</h4>
                {ci.best_content_formats.map((f, i) => (
                  <div key={i} style={styles.formatItem}>
                    <span style={styles.formatBullet} />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={styles.insightCard}>
              <h4 style={styles.insightCardTitle}>{isVideo ? T.card_duration_visuals : T.card_length_visuals}</h4>
              {ci.optimal_length && <p style={styles.insightText}>{ci.optimal_length}</p>}
              {ci.visual_patterns && <p style={styles.insightText}>{ci.visual_patterns}</p>}
            </div>
            {ci.key_keywords_used?.length > 0 && (
              <div style={styles.insightCard}>
                <h4 style={styles.insightCardTitle}>{T.card_keywords}</h4>
                <div style={styles.pillRow}>
                  {ci.key_keywords_used.map((kw, i) => (
                    <span key={i} style={styles.pill}>{kw}</span>
                  ))}
                </div>
                {ci.trending_tags?.length ? (
                  <>
                    <h4 style={{ ...styles.insightCardTitle, marginTop: '12px' }}>{T.card_trending_tags}</h4>
                    <div style={styles.pillRow}>
                      {ci.trending_tags.map((t, i) => (
                        <span key={i} style={{ ...styles.pill, background: 'rgba(62,207,142,0.08)', borderColor: 'rgba(62,207,142,0.2)', color: 'var(--green)' }}>#{t}</span>
                      ))}
                    </div>
                  </>
                ) : null}
              </div>
            )}
          </div>
        </section>

        {/* Comment Intelligence */}
        <section style={styles.section}>
          <SectionHeader label={T.section_comment_label} title={T.section_comment_title} />
          <div style={styles.commentGrid}>
            {cmi.top_pain_points?.length > 0 && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}><span style={{ color: 'var(--red)' }}>⚡</span> {T.card_pain_points}</h4>
                {cmi.top_pain_points.map((p, i) => (
                  <div key={i} style={styles.commentItem}>
                    <span style={styles.commentBullet}>→</span><span>{p}</span>
                  </div>
                ))}
              </div>
            )}
            {cmi.common_questions?.length > 0 && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}><span style={{ color: 'var(--gold)' }}>?</span> {T.card_questions}</h4>
                {cmi.common_questions.map((q, i) => (
                  <div key={i} style={styles.commentItem}>
                    <span style={styles.commentBullet}>→</span><span>{q}</span>
                  </div>
                ))}
              </div>
            )}
            {cmi.sentiment && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}>{T.card_sentiment}</h4>
                <p style={styles.sentimentText}>{cmi.sentiment}</p>
              </div>
            )}
          </div>
        </section>

        {/* Suggested Angles */}
        {result.suggested_angles?.length > 0 && (
          <section style={styles.section}>
            <SectionHeader label={T.section_angles_label} title={T.section_angles_title} />
            <div style={styles.anglesGrid}>
              {result.suggested_angles.map((a, i) => (
                <div key={i} style={styles.angleCard}>
                  <div style={styles.angleNum}>0{i + 1}</div>
                  <h3 style={styles.angleTitle}>{a.angle}</h3>
                  <div style={styles.angleDivider} />
                  <p style={styles.angleRationale}>{a.rationale}</p>
                  <div style={styles.angleDiff}>
                    <span style={styles.angleDiffLabel}>{T.how_to_differentiate}</span>
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
            <SectionHeader label={T.section_hooks_label} title={T.section_hooks_title} />
            <div style={styles.hooksCol}>
              {result.hook_examples.map((h, i) => (
                <div key={i} style={styles.hookCard}>
                  <span style={styles.hookNum}>0{i + 1}</span>
                  <span style={styles.hookText}>{h}</span>
                  <button
                    style={{ ...styles.copyBtn, ...(copiedIdx === i ? styles.copyBtnDone : {}) }}
                    onClick={() => copyHook(h, i)}
                  >
                    {copiedIdx === i ? T.copied : T.copy}
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Posts Analyzed */}
        {result._posts?.length > 0 && (
          <section style={styles.section}>
            <SectionHeader label={T.section_source_label} title={T.section_source_title} />
            <div style={styles.postsGrid}>
              {result._posts.map((p, i) => {
                const inner = (
                  <>
                    <div style={styles.postHeader}>
                      <span style={styles.postType}>
                        {p.type === 'video' ? T.post_type_video : T.post_type_note}
                        {p.duration ? ` · ${(p.duration / 1000).toFixed(0)}s` : ''}
                      </span>
                      <span style={styles.postCreator}>@{p.user}</span>
                    </div>
                    <p style={styles.postTitle}>{p.title || T.no_title}</p>
                    <div style={styles.postMetrics}>
                      <span>❤️ {fmtNum(p.liked_count)}</span>
                      <span>💬 {fmtNum(p.comment_count)}</span>
                      {p.play_count ? <span>▶ {fmtNum(p.play_count)}</span> : <span>⭐ {fmtNum(p.collected_count)}</span>}
                    </div>
                    {p.note_url && (
                      <span style={styles.postLinkHint}>{T.view_post}</span>
                    )}
                  </>
                )
                return p.note_url ? (
                  <a
                    key={i}
                    href={p.note_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    style={{ ...styles.postCard, ...styles.postCardLink }}
                  >
                    {inner}
                  </a>
                ) : (
                  <div key={i} style={styles.postCard}>{inner}</div>
                )
              })}
            </div>
          </section>
        )}

        <footer style={styles.reportFooter}>
          <LensLogo size={20} />
          <span>NicheLens · For research and learning only</span>
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
  const [lang, setLangState] = useState<Lang>(loadLang())
  const setLang = useCallback((l: Lang) => { setLangState(l); saveLang(l) }, [])
  const T = translations[lang]

  const [appState, setAppState] = useState<AppState>('setup')
  const [loadStage, setLoadStage] = useState<LoadStage>('crawling')
  const [loadMessage, setLoadMessage] = useState('')
  const [keyword, setKeyword] = useState('')
  const [platform, setPlatform] = useState<Platform>('xhs')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expiredPlatform, setExpiredPlatform] = useState<Platform | undefined>()
  const [extensionToast, setExtensionToast] = useState<string | null>(null)
  const esRef = useRef<EventSource | null>(null)

  // Detect cookie sent by the NicheLens browser extension via URL fragment
  useEffect(() => {
    const hash = window.location.hash
    const xhsMatch = hash.match(/[#&]xhs_cookie=([^&]+)/)
    const douyinMatch = hash.match(/[#&]douyin_cookie=([^&]+)/)
    const match = xhsMatch || douyinMatch
    if (!match) return
    const targetPlatform: Platform = xhsMatch ? 'xhs' : 'douyin'
    try {
      const cookie = decodeURIComponent(match[1])
      const isComplete = targetPlatform === 'xhs'
        ? cookie.includes('web_session=') && cookie.includes('a1=')
        : cookie.includes('sessionid_ss=') && cookie.includes('ttwid=') && cookie.includes('msToken=')
      if (isComplete) {
        storeSession(targetPlatform, cookie, '')
        setPlatform(targetPlatform)
        setExtensionToast(T.ext_connected)
        setTimeout(() => setExtensionToast(null), 4000)
      } else {
        setExtensionToast(T.ext_incomplete)
        setTimeout(() => setExtensionToast(null), 5000)
      }
    } catch (e) {
      console.error('Failed to parse extension cookie:', e)
    } finally {
      history.replaceState(null, '', window.location.pathname + window.location.search)
    }
  }, [T])

  const { getToken } = useAuth()

  const handleAnalyze = useCallback(async (kw: string, cookie: string, maxNotes: number, plt: Platform, dateRange: string) => {
    const platformLabel = PLATFORMS.find(p => p.id === plt)?.label ?? plt
    setKeyword(kw)
    setPlatform(plt)
    setAppState('loading')
    setLoadStage('crawling')
    setLoadMessage(`Searching ${platformLabel} for "${kw}"…`)
    setError(null)

    const token = await getToken().catch(() => null)
    if (!token) {
      setError('Auth error — please sign in again.')
      setAppState('error')
      return
    }

    // Prefer extension-side scraping when available — it bypasses XHS's
    // server-IP block (-104) by running the API call from the user's own
    // logged-in tab. Today: XHS only. Falls back to server-side for douyin
    // and when the extension isn't installed.
    if (plt === 'xhs') {
      const extVersion = await detectExtension(800)
      if (extVersion) {
        try {
          setLoadMessage(`Scraping ${platformLabel} via your browser…`)
          const notes = await scrapeXhsViaExtension(kw, maxNotes)
          if (notes.length === 0) throw new Error('No notes returned by extension fetch.')
          setLoadStage('analyzing')
          setLoadMessage(`Analyzing ${notes.length} posts with AI…`)
          const res = await fetch('/api/analyze-from-results', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ keyword: kw, notes, platform: plt, language: lang }),
          })
          if (!res.ok) {
            const txt = await res.text().catch(() => '')
            throw new Error(`Analyze failed: ${res.status} ${txt.slice(0, 200)}`)
          }
          const analysis = await res.json()
          if (typeof analysis?._credits_remaining === 'number') {
            window.dispatchEvent(new CustomEvent('nichelens:balance', { detail: analysis._credits_remaining }))
          }
          setResult(analysis as AnalysisResult)
          setAppState('report')
          return
        } catch (e) {
          console.warn('[NicheLens] extension scrape failed, falling back to server', e)
          // fall through to server-side path
        }
      }
    }

    const params = new URLSearchParams({
      keyword: kw,
      cookie,
      max_notes: String(maxNotes),
      platform: plt,
      date_range: dateRange,
      language: lang,
      token,
    })
    const es = new EventSource(`/api/analyze?${params}`)
    esRef.current = es

    es.addEventListener('balance', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        if (typeof data.credits === 'number') {
          window.dispatchEvent(new CustomEvent('nichelens:balance', { detail: data.credits }))
        }
      } catch {}
    })

    es.addEventListener('status', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      setLoadStage(data.stage as LoadStage)
      setLoadMessage(data.message)
    })

    es.addEventListener('done', (e: MessageEvent) => {
      setResult(JSON.parse(e.data) as AnalysisResult)
      setAppState('report')
      es.close()
    })

    es.addEventListener('error', (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data)
        setError(data.message || 'Something went wrong.')
        if (data.code === 'auth') {
          clearSession(plt)
          setExpiredPlatform(plt)
        }
      } catch {
        setError('Connection error. Please try again.')
      }
      setAppState('error')
      es.close()
    })

    es.onerror = () => {
      if (appState === 'loading') {
        setError('Connection lost. Please try again.')
        setAppState('error')
        es.close()
      }
    }
  }, [appState])

  const handleCancel = useCallback(() => { esRef.current?.close(); setExpiredPlatform(undefined); setAppState('setup') }, [])
  const handleReset = useCallback(() => { esRef.current?.close(); setResult(null); setError(null); setAppState('setup') }, [])

  return (
    <LangContext.Provider value={{ lang, T, setLang }}>
      <SignedOut>
        <SignInScreen lang={lang} setLang={setLang} />
      </SignedOut>
      <SignedIn>
      <AccountStrip />
      {window.location.pathname === '/admin' && <AdminPage />}
      {window.location.pathname !== '/admin' && (<>
      {appState === 'loading' && (
        <LoadingScreen
          stage={loadStage}
          message={loadMessage}
          keyword={keyword}
          platform={platform}
          onCancel={handleCancel}
        />
      )}
      {appState === 'report' && result && (
        <ReportScreen result={result} keyword={keyword} onReset={handleReset} />
      )}
      {appState === 'error' && (
        <div style={styles.errorWrap}>
          <div style={styles.errorCard}>
            <LensLogo size={40} />
            <h2 style={styles.errorTitle}>{T.err_analysis_failed}</h2>
            <p style={styles.errorMsg}>{error}</p>
            <button style={styles.analyzeBtn} onClick={handleReset}>{T.try_again}</button>
          </div>
        </div>
      )}
      {appState === 'setup' && (
        <SetupScreen onAnalyze={handleAnalyze} expiredPlatform={expiredPlatform} />
      )}
      {extensionToast && (
        <div style={styles.extensionToast}>
          <span style={{ color: 'var(--green)' }}>✓</span>
          <span>{extensionToast}</span>
        </div>
      )}
      </>)}
      </SignedIn>
    </LangContext.Provider>
  )
}

// ─── Sign-in landing ──────────────────────────────────────────────────────────

function SignInScreen({ lang, setLang }: { lang: Lang; setLang: (l: Lang) => void }) {
  return (
    <div style={styles.setupWrap}>
      <div style={styles.setupGlow} />
      <header style={styles.setupHeader}>
        <div style={styles.logoRow}>
          <LensLogo size={36} />
          <span style={styles.wordmark}>NicheLens</span>
        </div>
        <button
          style={styles.langToggle}
          onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')}
          title="Switch language"
        >
          {lang === 'zh' ? LANG_LABELS.en : LANG_LABELS.zh}
        </button>
      </header>
      <div style={{ width: '100%', maxWidth: '420px', marginTop: '64px', display: 'flex', justifyContent: 'center' }}>
        <SignIn
          routing="hash"
          appearance={{
            elements: {
              rootBox: { width: '100%' },
              card: { background: 'var(--bg-1)', border: '1px solid var(--border)' },
            },
          }}
        />
      </div>
    </div>
  )
}

// ─── Account strip (credit balance + UserButton) ──────────────────────────────

function AccountStrip() {
  const { getToken } = useAuth()
  const [credits, setCredits] = useState<number | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)

  useEffect(() => {
    let cancelled = false
    const refresh = async () => {
      const token = await getToken().catch(() => null)
      if (!token) return
      try {
        const res = await fetch('/api/me', { headers: { Authorization: `Bearer ${token}` } })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        if (typeof data.credits === 'number') setCredits(data.credits)
        setIsAdmin(Boolean(data.is_admin))
      } catch {}
    }
    refresh()
    const onBalance = (e: Event) => {
      const detail = (e as CustomEvent).detail
      if (typeof detail === 'number') setCredits(detail)
    }
    window.addEventListener('nichelens:balance', onBalance)
    return () => {
      cancelled = true
      window.removeEventListener('nichelens:balance', onBalance)
    }
  }, [getToken])

  return (
    <div style={styles.accountStrip}>
      {isAdmin && (
        <a href="/admin" style={styles.adminLink}>Admin</a>
      )}
      <div style={styles.creditPill}>
        <span style={styles.creditDot} />
        <span>{credits === null ? '…' : credits} credits</span>
      </div>
      <UserButton afterSignOutUrl="/" />
    </div>
  )
}

// ─── Admin page ───────────────────────────────────────────────────────────────

interface AdminUserRow {
  clerk_user_id: string
  email: string | null
  credits: number
  created_at: string
  spent_total: number
}

function AdminPage() {
  const { getToken } = useAuth()
  const [rows, setRows] = useState<AdminUserRow[]>([])
  const [total, setTotal] = useState(0)
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [edits, setEdits] = useState<Record<string, string>>({})
  const [savingId, setSavingId] = useState<string | null>(null)

  const fetchUsers = useCallback(async (q: string) => {
    setLoading(true)
    setError(null)
    const token = await getToken().catch(() => null)
    if (!token) { setError('Not authenticated.'); setLoading(false); return }
    try {
      const url = `/api/admin/users?limit=100${q ? `&q=${encodeURIComponent(q)}` : ''}`
      const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      if (res.status === 403) { setError('Admin access required.'); setLoading(false); return }
      if (!res.ok) { setError(`Error ${res.status}`); setLoading(false); return }
      const data = await res.json()
      setRows(data.users || [])
      setTotal(data.total ?? 0)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [getToken])

  useEffect(() => { fetchUsers('') }, [fetchUsers])

  const onSave = async (clerkId: string) => {
    const raw = edits[clerkId]
    const n = Number.parseInt(raw, 10)
    if (!Number.isFinite(n) || n < 0) { alert('Credits must be a non-negative integer.'); return }
    setSavingId(clerkId)
    const token = await getToken().catch(() => null)
    if (!token) { setSavingId(null); return }
    try {
      const res = await fetch(`/api/admin/users/${encodeURIComponent(clerkId)}/credits`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ credits: n }),
      })
      if (!res.ok) {
        const txt = await res.text()
        alert(`Failed: ${res.status} ${txt.slice(0, 200)}`)
        return
      }
      const data = await res.json()
      setRows(rs => rs.map(r => r.clerk_user_id === clerkId ? { ...r, credits: data.credits } : r))
      setEdits(e => { const next = { ...e }; delete next[clerkId]; return next })
    } finally {
      setSavingId(null)
    }
  }

  return (
    <div style={styles.adminWrap}>
      <header style={styles.adminHeader}>
        <div style={styles.logoRow}>
          <LensLogo size={28} />
          <span style={styles.wordmark}>NicheLens</span>
          <span style={styles.adminTag}>ADMIN</span>
        </div>
        <a href="/" style={styles.adminLink}>← Back to app</a>
      </header>
      <div style={styles.adminSearchRow}>
        <input
          style={styles.adminSearch}
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') fetchUsers(query) }}
          placeholder="Search by email or clerk id…"
        />
        <button style={styles.adminSearchBtn} onClick={() => fetchUsers(query)}>Search</button>
      </div>
      {loading && <p style={styles.adminMeta}>Loading…</p>}
      {error && <p style={{ ...styles.adminMeta, color: 'var(--red)' }}>{error}</p>}
      {!loading && !error && (
        <>
          <p style={styles.adminMeta}>{rows.length} of {total} users</p>
          <table style={styles.adminTable}>
            <thead>
              <tr>
                <th style={styles.adminTh}>Email</th>
                <th style={styles.adminTh}>Clerk ID</th>
                <th style={styles.adminTh}>Created</th>
                <th style={styles.adminThNum}>Spent</th>
                <th style={styles.adminThNum}>Credits</th>
                <th style={styles.adminTh}>Set to</th>
                <th style={styles.adminTh}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.clerk_user_id}>
                  <td style={styles.adminTd}>{r.email || <em style={{ color: 'var(--text-3)' }}>—</em>}</td>
                  <td style={{ ...styles.adminTd, fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)' }}>{r.clerk_user_id}</td>
                  <td style={styles.adminTd}>{new Date(r.created_at).toLocaleDateString()}</td>
                  <td style={styles.adminTdNum}>{r.spent_total}</td>
                  <td style={styles.adminTdNum}>{r.credits}</td>
                  <td style={styles.adminTd}>
                    <input
                      style={styles.adminCreditInput}
                      type="number"
                      min={0}
                      value={edits[r.clerk_user_id] ?? ''}
                      placeholder={String(r.credits)}
                      onChange={e => setEdits(s => ({ ...s, [r.clerk_user_id]: e.target.value }))}
                    />
                  </td>
                  <td style={styles.adminTd}>
                    <button
                      style={styles.adminSaveBtn}
                      disabled={savingId === r.clerk_user_id || !(edits[r.clerk_user_id] ?? '').trim()}
                      onClick={() => onSave(r.clerk_user_id)}
                    >
                      {savingId === r.clerk_user_id ? 'Saving…' : 'Save'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  setupWrap: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px 60px', position: 'relative' },
  setupGlow: { position: 'fixed', top: '-200px', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(229,26,40,0.08) 0%, transparent 70%)', pointerEvents: 'none' },
  setupHeader: { width: '100%', maxWidth: '640px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 0' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  wordmark: { fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' },
  headerTag: { fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', color: 'var(--text-3)', textTransform: 'uppercase' as const },
  headerRight: { display: 'flex', alignItems: 'center', gap: '12px' },
  langToggle: { background: 'var(--bg-1)', border: '1px solid var(--border)', color: 'var(--text-2)', padding: '6px 12px', borderRadius: '999px', fontSize: '11px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', transition: 'all 0.15s' },
  hero: { width: '100%', maxWidth: '640px', padding: '64px 0 48px', animation: 'fade-up 0.6s ease' },
  heroTitle: { fontFamily: 'var(--font-display)', fontSize: 'clamp(36px, 6vw, 56px)', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '20px' },
  heroEm: { fontStyle: 'italic', color: 'var(--red)' },
  heroSub: { fontSize: '16px', lineHeight: 1.7, color: 'var(--text-2)', maxWidth: '480px' },

  formCard: { width: '100%', maxWidth: '640px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '16px', padding: '32px', display: 'flex', flexDirection: 'column', gap: '28px', animation: 'fade-up 0.7s ease', backdropFilter: 'blur(12px)' },

  // Platform tabs
  platformTabs: { display: 'flex', gap: '8px', padding: '4px', background: 'var(--bg-2)', borderRadius: '10px', border: '1px solid var(--border)' },
  platformTab: { flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px', padding: '10px 16px', borderRadius: '7px', border: 'none', background: 'transparent', color: 'var(--text-2)', fontSize: '14px', fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'var(--font-ui)', position: 'relative' as const },
  platformTabActive: { background: 'var(--bg-3)', color: 'var(--text)', boxShadow: '0 1px 4px rgba(0,0,0,0.3)', border: '1px solid var(--border)' },
  platformEmoji: { fontSize: '16px' },
  platformConnectedDot: { position: 'absolute' as const, top: '6px', right: '8px', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)', boxShadow: '0 0 4px rgba(62,207,142,0.8)' },

  fieldGroup: { display: 'flex', flexDirection: 'column', gap: '10px' },
  label: { fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.14em', color: 'var(--text-3)', textTransform: 'uppercase' as const, display: 'flex', alignItems: 'center', gap: '8px' },
  input: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', color: 'var(--text)', fontSize: '16px', outline: 'none', transition: 'border-color 0.2s', width: '100%' },

  sessionRow: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px 16px' },
  sessionBadge: { display: 'flex', alignItems: 'center', gap: '8px' },
  sessionDot: { display: 'block', width: '8px', height: '8px', borderRadius: '50%', background: 'var(--green)', flexShrink: 0, boxShadow: '0 0 6px rgba(62,207,142,0.6)' },
  sessionName: { fontSize: '14px', color: 'var(--text)', fontWeight: 500 },
  switchBtn: { fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.06em', color: 'var(--text-3)', background: 'none', border: 'none', cursor: 'pointer', textDecoration: 'underline', padding: 0 },

  // Cookie section (XHS + Douyin)
  cookieSection: { display: 'flex', flexDirection: 'column', gap: '0', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' },
  cookieExpiredBanner: { padding: '10px 16px', background: 'rgba(229,26,40,0.08)', borderBottom: '1px solid rgba(229,26,40,0.2)', fontSize: '13px', color: 'rgba(229,26,40,0.9)', fontFamily: 'var(--font-mono)', letterSpacing: '0.02em' },
  cookieToggle: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 16px', background: 'var(--bg-2)', border: 'none', cursor: 'pointer', color: 'var(--text)', fontSize: '15px', fontFamily: 'var(--font-ui)', fontWeight: 500 },
  cookieBody: { padding: '16px', background: 'var(--bg-1)', display: 'flex', flexDirection: 'column', gap: '12px', borderTop: '1px solid var(--border)' },
  cookieInstructions: { fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.7 },
  cookieTextarea: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '12px', color: 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-mono)', resize: 'vertical' as const, outline: 'none', width: '100%' },
  cookieSaveBtn: { background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '10px 20px', fontSize: '14px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui)', alignSelf: 'flex-end' },
  bookmarkletBox: { background: 'rgba(229,26,40,0.05)', border: '1px solid rgba(229,26,40,0.15)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' },
  bookmarkletTitle: { fontSize: '12px', fontWeight: 600, color: 'var(--text)', marginBottom: '10px', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', textTransform: 'uppercase' as const },
  bookmarkletSteps: { fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.9, paddingLeft: '20px', margin: 0 },
  bookmarkletNote: { fontSize: '11px', color: 'var(--text-3)', lineHeight: 1.6, marginTop: '10px', paddingTop: '10px', borderTop: '1px dashed rgba(229,26,40,0.15)' },
  validationError: { padding: '10px 12px', background: 'rgba(229,26,40,0.1)', border: '1px solid rgba(229,26,40,0.3)', borderRadius: 'var(--radius-sm)', fontSize: '13px', color: 'rgba(229,26,40,0.95)', lineHeight: 1.5 },
  extensionToast: { position: 'fixed' as const, bottom: '24px', right: '24px', display: 'flex', alignItems: 'center', gap: '10px', padding: '14px 18px', background: 'rgba(8,8,9,0.95)', border: '1px solid rgba(62,207,142,0.3)', borderRadius: '10px', fontSize: '14px', color: 'var(--text)', boxShadow: '0 8px 32px rgba(0,0,0,0.5)', backdropFilter: 'blur(10px)', zIndex: 1000, fontFamily: 'var(--font-ui)', animation: 'fade-up 0.3s ease' },

  accountStrip: { position: 'fixed' as const, top: '20px', right: '20px', display: 'flex', alignItems: 'center', gap: '12px', zIndex: 100 },
  creditPill: { display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 14px', background: 'rgba(8,8,9,0.85)', border: '1px solid var(--border)', borderRadius: '999px', fontSize: '12px', fontFamily: 'var(--font-mono)', color: 'var(--text)', backdropFilter: 'blur(10px)' },
  creditDot: { width: '6px', height: '6px', borderRadius: '50%', background: 'var(--green)' },
  adminLink: { color: 'var(--text-2)', textDecoration: 'none', fontSize: '12px', fontFamily: 'var(--font-mono)', padding: '6px 12px', border: '1px solid var(--border)', borderRadius: '999px', background: 'rgba(8,8,9,0.85)', backdropFilter: 'blur(10px)' },

  // Admin page
  adminWrap: { minHeight: '100vh', padding: '24px 32px 60px', maxWidth: '1200px', margin: '0 auto' },
  adminHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: '20px', borderBottom: '1px solid var(--border)', marginBottom: '24px' },
  adminTag: { fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', color: 'var(--red)', border: '1px solid rgba(229,26,40,0.3)', padding: '2px 8px', borderRadius: '4px', marginLeft: '8px' },
  adminSearchRow: { display: 'flex', gap: '8px', marginBottom: '12px' },
  adminSearch: { flex: 1, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 14px', color: 'var(--text)', fontSize: '14px', outline: 'none', fontFamily: 'var(--font-ui)' },
  adminSearchBtn: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '8px', padding: '10px 18px', color: 'var(--text)', fontSize: '13px', cursor: 'pointer', fontFamily: 'var(--font-ui)' },
  adminMeta: { fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', margin: '8px 0 16px' },
  adminTable: { width: '100%', borderCollapse: 'collapse' as const, fontSize: '13px' },
  adminTh: { textAlign: 'left' as const, padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text-2)', fontSize: '11px', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' as const },
  adminThNum: { textAlign: 'right' as const, padding: '10px 12px', borderBottom: '1px solid var(--border)', fontWeight: 600, color: 'var(--text-2)', fontSize: '11px', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em', textTransform: 'uppercase' as const },
  adminTd: { padding: '10px 12px', borderBottom: '1px solid var(--bg-2)', color: 'var(--text)', verticalAlign: 'middle' as const },
  adminTdNum: { padding: '10px 12px', borderBottom: '1px solid var(--bg-2)', color: 'var(--text)', textAlign: 'right' as const, fontFamily: 'var(--font-mono)' },
  adminCreditInput: { width: '90px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '6px', padding: '6px 10px', color: 'var(--text)', fontSize: '13px', fontFamily: 'var(--font-mono)', outline: 'none' },
  adminSaveBtn: { background: 'var(--red)', border: 'none', borderRadius: '6px', padding: '6px 14px', color: '#fff', fontSize: '12px', fontWeight: 600, cursor: 'pointer', fontFamily: 'var(--font-ui)' },

  select: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', color: 'var(--text)', fontSize: '14px', outline: 'none', width: '100%', cursor: 'pointer', fontFamily: 'var(--font-ui)', appearance: 'auto' as const },
  slider: { width: '100%', accentColor: 'var(--red)', cursor: 'pointer', height: '4px' },
  sliderVal: { fontFamily: 'var(--font-mono)', fontSize: '14px', color: 'var(--red)', fontWeight: 600, marginLeft: '4px' },
  sliderLabels: { display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-3)' },
  analyzeBtn: { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '10px', background: 'var(--red)', color: '#fff', border: 'none', borderRadius: 'var(--radius-sm)', padding: '16px 24px', fontSize: '16px', fontWeight: 600, cursor: 'pointer', transition: 'opacity 0.2s, transform 0.1s', fontFamily: 'var(--font-ui)', letterSpacing: '-0.01em' },
  analyzeBtnDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  cookieHint: { fontSize: '13px', color: 'var(--text-3)', textAlign: 'center' as const },
  setupFooter: { marginTop: '40px', fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', textAlign: 'center' as const },

  // Loading
  loadWrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'relative' as const, overflow: 'hidden' },
  loadGlow: { position: 'fixed' as const, top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: '500px', height: '500px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(229,26,40,0.1) 0%, transparent 65%)', animation: 'pulse-ring 3s ease-in-out infinite', pointerEvents: 'none' },
  loadContent: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '20px', padding: '40px', textAlign: 'center' as const },
  loadLogoWrap: { position: 'relative' as const, display: 'flex', alignItems: 'center', justifyContent: 'center' },
  loadRing: { position: 'absolute' as const, width: '80px', height: '80px', borderRadius: '50%', border: '1px solid rgba(229,26,40,0.3)', animation: 'pulse-ring 2s ease-in-out infinite' },
  loadStage: { display: 'flex', alignItems: 'center', gap: '12px', fontFamily: 'var(--font-mono)', fontSize: '12px', letterSpacing: '0.08em' },
  loadStageActive: { color: 'var(--red)', fontWeight: 600 },
  loadStageDone: { color: 'var(--green)', fontWeight: 600 },
  loadStagePending: { color: 'var(--text-3)' },
  loadArrow: { color: 'var(--text-3)' },
  loadKeyword: { fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, fontStyle: 'italic', color: 'var(--text)', letterSpacing: '-0.02em' },
  loadMessage: { fontSize: '14px', color: 'var(--text-2)', fontFamily: 'var(--font-mono)' },
  loadDots: { display: 'flex', gap: '6px' },
  loadDot: { display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: 'var(--red)', animation: 'pulse-ring 1.2s ease-in-out infinite', opacity: 0.6 },
  cancelBtn: { marginTop: '12px', color: 'var(--text-3)', fontSize: '13px', textDecoration: 'underline', cursor: 'pointer', background: 'none', border: 'none', fontFamily: 'var(--font-ui)' },

  // Report
  reportWrap: { minHeight: '100vh', background: 'var(--bg)' },
  reportNav: { position: 'sticky' as const, top: 0, zIndex: 100, display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 24px', background: 'rgba(8,8,9,0.92)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--border)' },
  navLeft: { display: 'flex', alignItems: 'center', gap: '8px', flexShrink: 0 },
  navBrand: { fontFamily: 'var(--font-display)', fontWeight: 700, fontSize: '16px', letterSpacing: '-0.02em' },
  navKeyword: { flex: 1, fontFamily: 'var(--font-display)', fontSize: '14px', fontStyle: 'italic', color: 'var(--text-2)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  navNew: { background: 'var(--bg-3)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '7px 14px', fontSize: '13px', fontWeight: 600, cursor: 'pointer', flexShrink: 0, fontFamily: 'var(--font-ui)' },
  reportContent: { maxWidth: '900px', margin: '0 auto', padding: '0 24px 80px' },
  reportHero: { padding: '60px 0 40px', animation: 'fade-up 0.5s ease' },
  reportMeta: { display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '20px', flexWrap: 'wrap' as const },
  reportMetaItem: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-3)' },
  reportMetaDot: { color: 'var(--text-3)' },
  reportMetaModel: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--gold)', background: 'rgba(201,169,110,0.1)', padding: '2px 8px', borderRadius: '4px' },
  reportTitle: { fontFamily: 'var(--font-display)', fontSize: 'clamp(32px, 5vw, 52px)', fontWeight: 700, lineHeight: 1.1, letterSpacing: '-0.03em', color: 'var(--text)', marginBottom: '20px' },
  reportTitleEm: { fontStyle: 'italic', color: 'var(--red)' },
  reportSummary: { fontSize: '16px', lineHeight: 1.8, color: 'var(--text-2)', maxWidth: '680px', borderLeft: '2px solid var(--red)', paddingLeft: '20px' },
  section: { marginBottom: '64px', animation: 'fade-up 0.5s ease' },
  sectionHeader: { marginBottom: '24px' },
  sectionLabel: { display: 'block', fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.16em', color: 'var(--text-3)', marginBottom: '6px' },
  sectionTitle: { fontFamily: 'var(--font-display)', fontSize: '28px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' },

  metricsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: '12px', marginBottom: '16px' },
  metricCard: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '20px', display: 'flex', flexDirection: 'column', gap: '4px' },
  metricIcon: { fontSize: '18px' },
  metricValue: { fontFamily: 'var(--font-mono)', fontSize: '28px', fontWeight: 500, color: 'var(--text)', letterSpacing: '-0.02em' },
  metricLabel: { fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase' as const },
  engagementInsight: { fontSize: '13px', color: 'var(--text-2)', fontStyle: 'italic', paddingLeft: '12px', borderLeft: '1px solid var(--border)' },

  patternsScroll: { display: 'flex', gap: '16px', overflowX: 'auto' as const, paddingBottom: '8px', scrollSnapType: 'x mandatory' },
  patternCard: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', minWidth: '260px', maxWidth: '320px', flexShrink: 0, scrollSnapAlign: 'start', display: 'flex', flexDirection: 'column', gap: '8px' },
  patternNum: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--red)', letterSpacing: '0.1em', fontWeight: 600 },
  patternTitle: { fontFamily: 'var(--font-display)', fontSize: '18px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3 },
  patternFreq: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--gold)', background: 'rgba(201,169,110,0.1)', padding: '2px 8px', borderRadius: '4px', alignSelf: 'flex-start' },
  patternExample: { fontSize: '13px', color: 'var(--text-3)', fontStyle: 'italic', lineHeight: 1.5 },
  patternWhy: { fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.6, marginTop: '4px' },

  insightGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '16px' },
  insightCard: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  insightCardTitle: { fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.1em', color: 'var(--text-3)', textTransform: 'uppercase' as const, paddingBottom: '8px', borderBottom: '1px solid var(--border)' },
  formula: { display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px', color: 'var(--text)', lineHeight: 1.5 },
  formulaNum: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--red)', fontWeight: 700, flexShrink: 0, paddingTop: '2px' },
  formatItem: { display: 'flex', gap: '10px', alignItems: 'flex-start', fontSize: '14px', color: 'var(--text)', lineHeight: 1.5 },
  formatBullet: { display: 'block', width: '4px', height: '4px', borderRadius: '50%', background: 'var(--red)', marginTop: '8px', flexShrink: 0 },
  insightText: { fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6 },
  pillRow: { display: 'flex', flexWrap: 'wrap' as const, gap: '6px' },
  pill: { background: 'var(--red-dim)', border: '1px solid rgba(229,26,40,0.2)', color: 'var(--text)', padding: '4px 12px', borderRadius: '100px', fontSize: '13px', fontFamily: 'var(--font-mono)' },

  commentGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' },
  commentCard: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '24px', display: 'flex', flexDirection: 'column', gap: '12px' },
  commentCardTitle: { fontSize: '14px', fontWeight: 600, color: 'var(--text)', paddingBottom: '8px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: '8px' },
  commentItem: { display: 'flex', gap: '8px', fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.5, alignItems: 'flex-start' },
  commentBullet: { color: 'var(--red)', flexShrink: 0, fontWeight: 700 },
  sentimentText: { fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.7, fontStyle: 'italic' },

  anglesGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '16px' },
  angleCard: { background: 'linear-gradient(135deg, var(--bg-1) 0%, rgba(229,26,40,0.03) 100%)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '28px', display: 'flex', flexDirection: 'column', gap: '12px' },
  angleNum: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--red)', fontWeight: 700, letterSpacing: '0.1em' },
  angleTitle: { fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: 'var(--text)', lineHeight: 1.3, letterSpacing: '-0.01em' },
  angleDivider: { height: '1px', background: 'var(--border)' },
  angleRationale: { fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6 },
  angleDiff: { background: 'var(--bg-2)', borderRadius: 'var(--radius-sm)', padding: '12px', fontSize: '13px', color: 'var(--text-2)', lineHeight: 1.5, display: 'flex', flexDirection: 'column', gap: '6px' },
  angleDiffLabel: { fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.1em', color: 'var(--gold)', textTransform: 'uppercase' as const },

  hooksCol: { display: 'flex', flexDirection: 'column', gap: '10px' },
  hookCard: { display: 'flex', alignItems: 'center', gap: '16px', background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '18px 20px' },
  hookNum: { fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)', flexShrink: 0, width: '24px' },
  hookText: { flex: 1, fontSize: '15px', color: 'var(--text)', lineHeight: 1.5 },
  copyBtn: { fontFamily: 'var(--font-mono)', fontSize: '11px', letterSpacing: '0.08em', color: 'var(--text-3)', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '6px 12px', cursor: 'pointer', flexShrink: 0, transition: 'all 0.2s', textTransform: 'uppercase' as const },
  copyBtnDone: { color: 'var(--green)', borderColor: 'rgba(62,207,142,0.3)', background: 'rgba(62,207,142,0.08)' },

  postsGrid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: '12px' },
  postCard: { background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: 'var(--radius)', padding: '16px', display: 'flex', flexDirection: 'column', gap: '8px' },
  postCardLink: { textDecoration: 'none', color: 'inherit', cursor: 'pointer', transition: 'border-color 0.15s, transform 0.1s' },
  postLinkHint: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--red)', marginTop: '4px', letterSpacing: '0.04em' },
  postHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  postType: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)' },
  postCreator: { fontFamily: 'var(--font-mono)', fontSize: '10px', color: 'var(--text-3)', maxWidth: '100px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  postTitle: { fontSize: '13px', color: 'var(--text)', lineHeight: 1.4, flex: 1, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' } as React.CSSProperties,
  postMetrics: { display: 'flex', gap: '10px', fontFamily: 'var(--font-mono)', fontSize: '11px', color: 'var(--text-3)', flexWrap: 'wrap' as const },

  errorWrap: { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px' },
  errorCard: { maxWidth: '400px', width: '100%', background: 'var(--bg-1)', border: '1px solid rgba(229,26,40,0.2)', borderRadius: '16px', padding: '40px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', textAlign: 'center' as const },
  errorTitle: { fontFamily: 'var(--font-display)', fontSize: '24px', fontWeight: 700, color: 'var(--text)' },
  errorMsg: { fontSize: '14px', color: 'var(--text-2)', lineHeight: 1.6 },

  reportFooter: { display: 'flex', alignItems: 'center', gap: '10px', padding: '24px 0', borderTop: '1px solid var(--border)', fontSize: '12px', color: 'var(--text-3)', fontFamily: 'var(--font-mono)', flexWrap: 'wrap' as const },
  tokenMeta: { marginLeft: 'auto', fontSize: '11px', color: 'var(--text-3)' },
}
