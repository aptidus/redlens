import { useState, useRef, useCallback, useEffect } from 'react'

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
type QRState = 'idle' | 'connecting' | 'showing' | 'done' | 'error'

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

// ─── QR Modal (XHS) ───────────────────────────────────────────────────────────

function QRModal({ onAuthenticated, onClose }: {
  onAuthenticated: (cookie: string, username: string) => void
  onClose: () => void
}) {
  const [qrState, setQrState] = useState<QRState>('connecting')
  const [qrImage, setQrImage] = useState('')
  const [statusMsg, setStatusMsg] = useState('Connecting to 小红书…')
  const qrStateRef = useRef<QRState>('connecting')

  const setQrStateSync = (s: QRState) => { qrStateRef.current = s; setQrState(s) }

  useEffect(() => {
    const es = new EventSource('/api/login/qr')
    es.addEventListener('status', (e: MessageEvent) => setStatusMsg(JSON.parse(e.data).message))
    es.addEventListener('qr', (e: MessageEvent) => {
      setQrImage(JSON.parse(e.data).image)
      setQrStateSync('showing')
    })
    es.addEventListener('authenticated', (e: MessageEvent) => {
      const data = JSON.parse(e.data)
      setQrStateSync('done')
      setStatusMsg('Connected!')
      es.close()
      setTimeout(() => onAuthenticated(data.cookie, data.username || ''), 700)
    })
    es.addEventListener('error', (e: MessageEvent) => {
      try { setStatusMsg(JSON.parse(e.data).message || 'Login failed.') } catch { setStatusMsg('Connection error.') }
      setQrStateSync('error')
      es.close()
    })
    es.onerror = () => {
      if (qrStateRef.current !== 'done' && qrStateRef.current !== 'error') {
        setStatusMsg('Connection lost. Try the cookie paste method instead.')
        setQrStateSync('error')
      }
      es.close()
    }
    return () => { es.close() }
  }, [])

  return (
    <div style={styles.qrOverlay} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div style={styles.qrModal}>
        <button style={styles.qrClose} onClick={onClose}>✕</button>
        <div style={styles.qrHeader}>
          <LensLogo size={28} />
          <h3 style={styles.qrTitle}>Connect 小红书</h3>
        </div>
        {qrState === 'connecting' && (
          <div style={styles.qrSpinner}>
            <LensLogo size={44} spinning />
            <p style={styles.qrStatusMsg}>{statusMsg}</p>
          </div>
        )}
        {qrState === 'showing' && (
          <div style={styles.qrBody}>
            <div style={styles.qrImageWrap}>
              <img src={qrImage} alt="小红书 QR Code" style={styles.qrImage} />
            </div>
            <p style={styles.qrStatusMsg}>{statusMsg}</p>
            <p style={styles.qrHint}>Open 小红书 app → tap profile → Scan QR</p>
          </div>
        )}
        {qrState === 'done' && (
          <div style={styles.qrSuccess}>
            <div style={styles.qrSuccessIcon}>✓</div>
            <p style={styles.qrSuccessText}>Connected successfully!</p>
          </div>
        )}
        {qrState === 'error' && (
          <div style={styles.qrBody}>
            <p style={styles.qrErrorMsg}>{statusMsg}</p>
            <button style={styles.qrRetryBtn} onClick={onClose}>Close &amp; try again</button>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Douyin Cookie Section ────────────────────────────────────────────────────

function DouyinCookieSection({ session, onSave, onClear, isExpired = false }: {
  session: { cookie: string; username: string }
  onSave: (cookie: string) => void
  onClear: () => void
  isExpired?: boolean
}) {
  const [expanded, setExpanded] = useState(!session.cookie)
  const [input, setInput] = useState('')

  if (session.cookie) {
    return (
      <div style={styles.sessionRow}>
        <div style={styles.sessionBadge}>
          <span style={styles.sessionDot} />
          <span style={styles.sessionName}>{session.username || 'Douyin Connected'}</span>
        </div>
        <button style={styles.switchBtn} onClick={onClear}>Switch account</button>
      </div>
    )
  }

  return (
    <div style={styles.cookieSection}>
      {isExpired && (
        <div style={styles.cookieExpiredBanner}>
          ⚠️ Cookie expired — paste a fresh one to continue
        </div>
      )}
      <button style={styles.cookieToggle} onClick={() => setExpanded(x => !x)}>
        <span>🔑 Paste Douyin Cookie</span>
        <span style={{ color: 'var(--text-3)', fontSize: '12px' }}>{expanded ? '▲' : '▼'}</span>
      </button>
      {expanded && (
        <div style={styles.cookieBody}>
          <p style={styles.cookieInstructions}>
            1. Open <strong>douyin.com</strong> in Chrome (logged in)<br />
            2. Press <code>F12</code> → Network tab → reload the page<br />
            3. Click any request → Headers → find <code>Cookie:</code><br />
            4. Copy the full value and paste below
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
            Save Cookie
          </button>
        </div>
      )}
    </div>
  )
}

// ─── XHS Auth Section ────────────────────────────────────────────────────────

function XHSAuthSection({ onQR, onSave, isExpired }: {
  onQR: () => void
  onSave: (cookie: string) => void
  isExpired?: boolean
}) {
  const [showPaste, setShowPaste] = useState(false)
  const [input, setInput] = useState('')
  const [validationError, setValidationError] = useState('')

  const handleSave = () => {
    const cookie = input.trim()
    if (!cookie.includes('web_session=')) {
      setValidationError('Missing web_session cookie. XHS marks it as httpOnly so a bookmarklet can\'t read it — you must use the Network tab method below.')
      return
    }
    if (!cookie.includes('a1=')) {
      setValidationError('Missing a1 cookie. Make sure you\'re logged into xiaohongshu.com and copied the full Cookie header.')
      return
    }
    setValidationError('')
    onSave(cookie)
    setInput('')
  }

  if (!showPaste) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
        {isExpired && (
          <div style={styles.cookieExpiredBanner}>
            ⚠️ Session expired — reconnect via QR or paste a fresh cookie
          </div>
        )}
        <button style={styles.qrLoginBtn} onClick={onQR}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <rect x="2" y="2" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <rect x="11" y="2" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <rect x="2" y="11" width="7" height="7" rx="1" stroke="currentColor" strokeWidth="1.5" />
            <rect x="4" y="4" width="3" height="3" fill="currentColor" />
            <rect x="13" y="4" width="3" height="3" fill="currentColor" />
            <rect x="4" y="13" width="3" height="3" fill="currentColor" />
            <rect x="11" y="11" width="2" height="2" fill="currentColor" />
            <rect x="15" y="11" width="2" height="2" fill="currentColor" />
            <rect x="13" y="13" width="2" height="2" fill="currentColor" />
            <rect x="11" y="15" width="2" height="2" fill="currentColor" />
            <rect x="15" y="15" width="2" height="2" fill="currentColor" />
          </svg>
          Scan QR to connect 小红书
        </button>
        <button style={styles.altAuthLink} onClick={() => setShowPaste(true)}>
          Paste cookie manually instead
        </button>
      </div>
    )
  }

  return (
    <div style={styles.cookieSection}>
      <div style={styles.cookieBody}>
        <div style={styles.bookmarkletBox}>
          <p style={styles.bookmarkletTitle}>Easiest: install the cookie grabber extension</p>
          <ol style={styles.bookmarkletSteps}>
            <li>Download <a href="https://github.com/aptidus/redlens/tree/main/extension" target="_blank" rel="noreferrer" style={{ color: 'var(--red)' }}>the <code>extension/</code> folder</a> from the repo</li>
            <li>Chrome → <code>chrome://extensions</code> → enable <strong>Developer mode</strong></li>
            <li>Click <strong>Load unpacked</strong> → pick the folder</li>
            <li>Log into <strong>xiaohongshu.com</strong>, click the extension icon, copy</li>
            <li>Paste below</li>
          </ol>
          <p style={styles.bookmarkletNote}>
            Or manually: F12 → <strong>Network</strong> tab → click <strong>Fetch/XHR</strong> filter →
            reload → click any <code>xiaohongshu.com</code> API request →
            Request Headers → copy <code>cookie:</code> value.
            Static image (CDN) requests have no cookie — pick an XHR.
          </p>
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
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <button style={styles.altAuthLink} onClick={() => setShowPaste(false)}>← Back to QR</button>
          <button
            style={{ ...styles.cookieSaveBtn, ...(input.trim() ? {} : styles.analyzeBtnDisabled) }}
            disabled={!input.trim()}
            onClick={handleSave}
          >
            Save Cookie
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
  const [platform, setPlatform] = useState<Platform>(expiredPlatform ?? 'xhs')
  const [keyword, setKeyword] = useState('')
  const [maxNotes, setMaxNotes] = useState(15)
  const [dateRange, setDateRange] = useState('30d')
  const [sessions, setSessions] = useState<Record<Platform, { cookie: string; username: string }>>({
    xhs: loadSession('xhs'),
    douyin: loadSession('douyin'),
  })
  const [showQR, setShowQR] = useState(false)

  const session = sessions[platform]
  const canSubmit = keyword.trim().length > 0 && session.cookie.trim().length > 0
  const activePlatform = PLATFORMS.find(p => p.id === platform)!

  const handleAuthenticated = useCallback((cookie: string, username: string) => {
    storeSession('xhs', cookie, username)
    setSessions(s => ({ ...s, xhs: { cookie, username } }))
    setShowQR(false)
  }, [])

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
      {showQR && (
        <QRModal onAuthenticated={handleAuthenticated} onClose={() => setShowQR(false)} />
      )}
      <div style={styles.setupGlow} />

      {/* Header */}
      <header style={styles.setupHeader}>
        <div style={styles.logoRow}>
          <LensLogo size={36} />
          <span style={styles.wordmark}>RedLens</span>
        </div>
        <div style={styles.headerTag}>Content Intelligence</div>
      </header>

      {/* Hero */}
      <div style={styles.hero}>
        <h1 style={styles.heroTitle}>
          Decode what makes<br />
          <em style={styles.heroEm}>viral content</em> work.
        </h1>
        <p style={styles.heroSub}>
          Enter a keyword. We analyze the top posts, comments, and patterns —
          then tell you exactly what to create.
        </p>
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
          <label style={styles.label}>KEYWORD</label>
          <input
            style={styles.input}
            type="text"
            placeholder={platform === 'xhs' ? 'e.g. 减肥, 护肤, 穿搭, 旅游' : 'e.g. 减肥, 护肤, 穿搭, 搞笑'}
            value={keyword}
            onChange={e => setKeyword(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && canSubmit && onAnalyze(keyword, session.cookie, maxNotes, platform, dateRange)}
            autoFocus
          />
        </div>

        {/* Auth section */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>
            {activePlatform.emoji} {activePlatform.label.toUpperCase()} ACCOUNT
          </label>

          {platform === 'xhs' && (
            session.cookie ? (
              <div style={styles.sessionRow}>
                <div style={styles.sessionBadge}>
                  <span style={styles.sessionDot} />
                  <span style={styles.sessionName}>{session.username || 'Connected'}</span>
                </div>
                <button style={styles.switchBtn} onClick={() => handleClearSession('xhs')}>
                  Switch account
                </button>
              </div>
            ) : (
              <XHSAuthSection
                onQR={() => setShowQR(true)}
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
            POSTS TO ANALYZE
            <span style={styles.sliderVal}>{maxNotes}</span>
          </label>
          <input type="range" min={5} max={20} value={maxNotes}
            onChange={e => setMaxNotes(Number(e.target.value))} style={styles.slider} />
          <div style={styles.sliderLabels}>
            <span>5 (faster)</span>
            <span>20 (deeper)</span>
          </div>
        </div>

        {/* Date range */}
        <div style={styles.fieldGroup}>
          <label style={styles.label}>POST DATE RANGE</label>
          <select
            style={styles.select}
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
          >
            {DATE_RANGE_OPTIONS.map(opt => (
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
          <span>Analyze "{keyword || '…'}" on {activePlatform.label}</span>
        </button>

        {!session.cookie && (
          <p style={styles.cookieHint}>
            ↑ Connect your {activePlatform.label} account to start analyzing.
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

function LoadingScreen({ stage, message, keyword, platform, onCancel }: {
  stage: LoadStage
  message: string
  keyword: string
  platform: Platform
  onCancel: () => void
}) {
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
            {stage === 'crawling' ? '●' : '✓'} Crawling {platformLabel}
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
          {[0, 1, 2].map(i => (
            <span key={i} style={{ ...styles.loadDot, animationDelay: `${i * 0.2}s` }} />
          ))}
        </div>
        <button style={styles.cancelBtn} onClick={onCancel}>Cancel</button>
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
          <span style={styles.navBrand}>RedLens</span>
        </div>
        <div style={styles.navKeyword}>"{keyword}"</div>
        <button style={styles.navNew} onClick={onReset}>+ New Analysis</button>
      </div>

      <div style={styles.reportContent}>
        {/* Hero */}
        <section style={styles.reportHero}>
          <div style={styles.reportMeta}>
            <span style={styles.reportMetaItem}>{ms.total_posts_analyzed} posts analyzed</span>
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
            Intelligence Report:<br />
            <em style={styles.reportTitleEm}>{keyword}</em>
          </h1>
          <p style={styles.reportSummary}>{result.summary}</p>
        </section>

        {/* Metrics */}
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
                  {p.example && <p style={styles.patternExample}>"{p.example}"</p>}
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
                <h4 style={styles.insightCardTitle}>{isVideo ? 'Hook Formulas That Win' : 'Title Formulas That Win'}</h4>
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
                <h4 style={styles.insightCardTitle}>{isVideo ? 'Best Video Styles' : 'Best Content Formats'}</h4>
                {ci.best_content_formats.map((f, i) => (
                  <div key={i} style={styles.formatItem}>
                    <span style={styles.formatBullet} />
                    <span>{f}</span>
                  </div>
                ))}
              </div>
            )}
            <div style={styles.insightCard}>
              <h4 style={styles.insightCardTitle}>{isVideo ? 'Duration & Visuals' : 'Length & Visuals'}</h4>
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
                {ci.trending_tags?.length ? (
                  <>
                    <h4 style={{ ...styles.insightCardTitle, marginTop: '12px' }}>Trending Tags</h4>
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
          <SectionHeader label="COMMENT INTELLIGENCE" title="The Conversation" />
          <div style={styles.commentGrid}>
            {cmi.top_pain_points?.length > 0 && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}><span style={{ color: 'var(--red)' }}>⚡</span> Top Pain Points</h4>
                {cmi.top_pain_points.map((p, i) => (
                  <div key={i} style={styles.commentItem}>
                    <span style={styles.commentBullet}>→</span><span>{p}</span>
                  </div>
                ))}
              </div>
            )}
            {cmi.common_questions?.length > 0 && (
              <div style={styles.commentCard}>
                <h4 style={styles.commentCardTitle}><span style={{ color: 'var(--gold)' }}>?</span> Common Questions</h4>
                {cmi.common_questions.map((q, i) => (
                  <div key={i} style={styles.commentItem}>
                    <span style={styles.commentBullet}>→</span><span>{q}</span>
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
                    style={{ ...styles.copyBtn, ...(copiedIdx === i ? styles.copyBtnDone : {}) }}
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
                    <span style={styles.postType}>
                      {p.type === 'video' ? '▶ Video' : '📄 Note'}
                      {p.duration ? ` · ${(p.duration / 1000).toFixed(0)}s` : ''}
                    </span>
                    <span style={styles.postCreator}>@{p.user}</span>
                  </div>
                  <p style={styles.postTitle}>{p.title || '(no title)'}</p>
                  <div style={styles.postMetrics}>
                    <span>❤️ {fmtNum(p.liked_count)}</span>
                    <span>💬 {fmtNum(p.comment_count)}</span>
                    {p.play_count ? <span>▶ {fmtNum(p.play_count)}</span> : <span>⭐ {fmtNum(p.collected_count)}</span>}
                  </div>
                </div>
              ))}
            </div>
          </section>
        )}

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
  const [platform, setPlatform] = useState<Platform>('xhs')
  const [result, setResult] = useState<AnalysisResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [expiredPlatform, setExpiredPlatform] = useState<Platform | undefined>()
  const esRef = useRef<EventSource | null>(null)

  const handleAnalyze = useCallback((kw: string, cookie: string, maxNotes: number, plt: Platform, dateRange: string) => {
    const platformLabel = PLATFORMS.find(p => p.id === plt)?.label ?? plt
    setKeyword(kw)
    setPlatform(plt)
    setAppState('loading')
    setLoadStage('crawling')
    setLoadMessage(`Searching ${platformLabel} for "${kw}"…`)
    setError(null)

    const params = new URLSearchParams({
      keyword: kw,
      cookie,
      max_notes: String(maxNotes),
      platform: plt,
      date_range: dateRange,
    })
    const es = new EventSource(`/api/analyze?${params}`)
    esRef.current = es

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

  if (appState === 'loading') {
    return (
      <LoadingScreen
        stage={loadStage}
        message={loadMessage}
        keyword={keyword}
        platform={platform}
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
          <button style={styles.analyzeBtn} onClick={handleReset}>Try Again</button>
        </div>
      </div>
    )
  }

  return <SetupScreen onAnalyze={handleAnalyze} expiredPlatform={expiredPlatform} />
}

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  setupWrap: { minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '0 24px 60px', position: 'relative' },
  setupGlow: { position: 'fixed', top: '-200px', left: '50%', transform: 'translateX(-50%)', width: '600px', height: '600px', borderRadius: '50%', background: 'radial-gradient(circle, rgba(229,26,40,0.08) 0%, transparent 70%)', pointerEvents: 'none' },
  setupHeader: { width: '100%', maxWidth: '640px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '28px 0 0' },
  logoRow: { display: 'flex', alignItems: 'center', gap: '10px' },
  wordmark: { fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, color: 'var(--text)', letterSpacing: '-0.02em' },
  headerTag: { fontFamily: 'var(--font-mono)', fontSize: '10px', letterSpacing: '0.12em', color: 'var(--text-3)', textTransform: 'uppercase' as const },
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

  qrLoginBtn: { display: 'flex', alignItems: 'center', gap: '10px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '14px 16px', fontSize: '15px', fontWeight: 500, cursor: 'pointer', transition: 'border-color 0.2s, background 0.2s', fontFamily: 'var(--font-ui)', width: '100%', justifyContent: 'center' },
  altAuthLink: { background: 'none', border: 'none', color: 'var(--text-3)', fontSize: '12px', cursor: 'pointer', textDecoration: 'underline', fontFamily: 'var(--font-mono)', padding: '6px 0', textAlign: 'center' as const, letterSpacing: '0.02em' },

  // Douyin cookie section
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

  // QR Modal
  qrOverlay: { position: 'fixed' as const, inset: 0, background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 999, padding: '24px', animation: 'fade-up 0.2s ease' },
  qrModal: { position: 'relative' as const, background: 'var(--bg-1)', border: '1px solid var(--border)', borderRadius: '20px', padding: '32px', width: '100%', maxWidth: '360px', display: 'flex', flexDirection: 'column', gap: '24px', boxShadow: '0 24px 80px rgba(0,0,0,0.5)' },
  qrClose: { position: 'absolute' as const, top: '16px', right: '16px', background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: '6px', color: 'var(--text-3)', cursor: 'pointer', padding: '4px 8px', fontSize: '13px', lineHeight: 1, fontFamily: 'var(--font-mono)' },
  qrHeader: { display: 'flex', alignItems: 'center', gap: '12px' },
  qrTitle: { fontFamily: 'var(--font-display)', fontSize: '20px', fontWeight: 700, letterSpacing: '-0.02em', color: 'var(--text)' },
  qrSpinner: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px', padding: '24px 0' },
  qrBody: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '16px' },
  qrImageWrap: { background: '#fff', borderRadius: '12px', padding: '12px', display: 'inline-flex', boxShadow: '0 4px 20px rgba(0,0,0,0.15)' },
  qrImage: { width: '200px', height: '200px', display: 'block' },
  qrStatusMsg: { fontFamily: 'var(--font-mono)', fontSize: '12px', color: 'var(--text-2)', textAlign: 'center' as const, letterSpacing: '0.04em' },
  qrHint: { fontSize: '13px', color: 'var(--text-3)', textAlign: 'center' as const, lineHeight: 1.5 },
  qrSuccess: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px', padding: '24px 0' },
  qrSuccessIcon: { width: '52px', height: '52px', borderRadius: '50%', background: 'rgba(62,207,142,0.12)', border: '2px solid var(--green)', color: 'var(--green)', fontSize: '24px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 },
  qrSuccessText: { fontSize: '15px', color: 'var(--text)', fontWeight: 500 },
  qrErrorMsg: { fontSize: '14px', color: 'rgba(229,26,40,0.9)', textAlign: 'center' as const, lineHeight: 1.5 },
  qrRetryBtn: { background: 'var(--bg-2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text)', padding: '10px 20px', fontSize: '14px', cursor: 'pointer', fontFamily: 'var(--font-ui)' },

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
