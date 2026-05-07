// i18n for RedLens. Default = Simplified Chinese; English as alternative.
// Keep translations short, idiomatic, and aligned with how creators actually
// talk about their work in each language.

export type Lang = 'zh' | 'en'

const STORAGE_KEY = 'redlens_lang'

export function loadLang(): Lang {
  const v = localStorage.getItem(STORAGE_KEY)
  return v === 'en' ? 'en' : 'zh'
}

export function saveLang(lang: Lang) {
  localStorage.setItem(STORAGE_KEY, lang)
}

export const LANG_LABELS: Record<Lang, string> = { zh: '中文', en: 'EN' }

type Dict = {
  // Header
  brand_tag: string

  // Hero
  hero_title_a: string
  hero_title_b: string
  hero_sub: string

  // Setup form
  field_keyword: string
  keyword_placeholder_xhs: string
  keyword_placeholder_douyin: string
  field_account: (platformLabel: string) => string
  posts_to_analyze: string
  date_range: string
  date_all: string
  date_7d: string
  date_30d: string
  date_90d: string
  date_180d: string
  slider_faster: string
  slider_deeper: string
  analyze_cta: (kw: string, platform: string) => string
  cookie_hint: (platform: string) => string
  footer_text: string
  research_only: string

  // Auth section
  save_cookie: string
  switch_account: string
  connected: string
  session_expired_xhs: string
  session_expired_douyin: string

  // Cookie panel
  cookie_one_click_title: string
  cookie_step_download: string
  cookie_step_unzip: string
  cookie_step_load: string
  cookie_step_visit: string
  cookie_step_click: string
  cookie_note: string
  cookie_manual_fallback: string
  cookie_validation_no_session: string
  cookie_validation_no_a1: string

  // Douyin paste
  douyin_paste_btn: string
  douyin_step_1: string
  douyin_step_2: string
  douyin_step_3: string
  douyin_step_4: string

  // Loading screen
  load_searching: (platform: string, keyword: string) => string
  load_stage_crawling: (platform: string) => string
  load_stage_analyzing: string
  cancel: string

  // Report
  report_posts_analyzed: (n: number) => string
  intelligence_report: string
  metric_avg_likes: string
  metric_avg_collects: string
  metric_avg_comments: string
  metric_top_likes: string
  section_top_patterns_label: string
  section_top_patterns_title: string
  section_content_insights_label: string
  section_content_insights_title: string
  card_winning_titles: string
  card_winning_hooks: string
  card_best_formats: string
  card_best_video_styles: string
  card_length_visuals: string
  card_duration_visuals: string
  card_keywords: string
  card_trending_tags: string
  section_comment_label: string
  section_comment_title: string
  card_pain_points: string
  card_questions: string
  card_sentiment: string
  section_angles_label: string
  section_angles_title: string
  how_to_differentiate: string
  section_hooks_label: string
  section_hooks_title: string
  copy: string
  copied: string
  section_source_label: string
  section_source_title: string
  post_type_video: string
  post_type_note: string
  no_title: string
  view_post: string
  new_analysis: string
  tokens_used: (n: number) => string

  // Error states
  err_analysis_failed: string
  try_again: string
  err_connection_lost: string
  err_no_posts: string

  // Toast
  ext_connected: string
  ext_incomplete: string
}

export const t: Record<Lang, Dict> = {
  zh: {
    brand_tag: '内容情报',

    hero_title_a: '解码',
    hero_title_b: '爆款内容',
    hero_sub: '输入一个关键词，我们分析爆款笔记、评论和模式 —— 然后告诉你应该创作什么。',

    field_keyword: '关键词',
    keyword_placeholder_xhs: '例如：减肥、护肤、穿搭、旅游',
    keyword_placeholder_douyin: '例如：减肥、护肤、穿搭、搞笑',
    field_account: (p) => `${p} 账号`,
    posts_to_analyze: '分析帖子数',
    date_range: '时间范围',
    date_all: '全部时间',
    date_7d: '最近 7 天',
    date_30d: '最近 30 天',
    date_90d: '最近 3 个月',
    date_180d: '最近 6 个月',
    slider_faster: '5（更快）',
    slider_deeper: '20（更深入）',
    analyze_cta: (kw, p) => `分析 "${kw || '…'}" 在 ${p}`,
    cookie_hint: (p) => `↑ 连接你的 ${p} 账号开始分析。`,
    footer_text: '由',
    research_only: '仅供研究学习使用',

    save_cookie: '保存 Cookie',
    switch_account: '切换账号',
    connected: '已连接',
    session_expired_xhs: '⚠️ 登录已过期 —— 请粘贴新的 Cookie',
    session_expired_douyin: '⚠️ Cookie 已过期 —— 请粘贴新的 Cookie 继续',

    cookie_one_click_title: '一键连接：使用 NicheLens 浏览器插件',
    cookie_step_download: '下载',
    cookie_step_unzip: '并解压',
    cookie_step_load: 'Chrome → chrome://extensions → 打开「开发者模式」→「加载已解压的扩展程序」→ 选择解压后的文件夹',
    cookie_step_visit: '访问 xiaohongshu.com 或 douyin.com（已登录），右下角会出现「Connect」按钮',
    cookie_step_click: '点击它。NicheLens 会自动打开并完成连接。',
    cookie_note: '一次安装，终身使用。每次访问小红书时按钮就在那，无需复制粘贴。',
    cookie_manual_fallback: '手动备选：F12 →「Network」→ 点击「Fetch/XHR」过滤器 → 刷新 → 点击任意 xiaohongshu.com API 请求 → 复制「cookie:」请求头的值 → 粘贴到下方。',
    cookie_validation_no_session: '缺少 web_session Cookie。XHS 把它设为 httpOnly，所以书签栏脚本读不到 —— 必须用下面的 Network 标签方法。',
    cookie_validation_no_a1: '缺少 a1 Cookie。请确保你已登录 xiaohongshu.com 并复制了完整的 Cookie 请求头。',

    douyin_paste_btn: '🔑 粘贴抖音 Cookie',
    douyin_step_1: '在 Chrome 中打开 douyin.com（已登录）',
    douyin_step_2: '按 F12 → 切换到 Network 标签 → 刷新页面',
    douyin_step_3: '点击任意请求 → Headers → 找到 Cookie:',
    douyin_step_4: '复制完整内容并粘贴到下方',

    load_searching: (p, kw) => `正在 ${p} 搜索 "${kw}"…`,
    load_stage_crawling: (p) => `抓取 ${p}`,
    load_stage_analyzing: 'AI 分析',
    cancel: '取消',

    report_posts_analyzed: (n) => `已分析 ${n} 篇帖子`,
    intelligence_report: '情报报告',
    metric_avg_likes: '平均点赞',
    metric_avg_collects: '平均收藏',
    metric_avg_comments: '平均评论',
    metric_top_likes: '最高点赞',
    section_top_patterns_label: '热门模式',
    section_top_patterns_title: '什么内容在火',
    section_content_insights_label: '内容洞察',
    section_content_insights_title: '爆款公式',
    card_winning_titles: '高效标题公式',
    card_winning_hooks: '高效开场公式',
    card_best_formats: '最佳内容形式',
    card_best_video_styles: '最佳视频风格',
    card_length_visuals: '篇幅与视觉',
    card_duration_visuals: '时长与画面',
    card_keywords: '高频关键词',
    card_trending_tags: '热门话题',
    section_comment_label: '评论情报',
    section_comment_title: '用户都在聊什么',
    card_pain_points: '主要痛点',
    card_questions: '常见疑问',
    card_sentiment: '整体情绪',
    section_angles_label: '建议切入点',
    section_angles_title: '你的机会',
    how_to_differentiate: '如何差异化',
    section_hooks_label: '开场示例',
    section_hooks_title: '直接拿去用',
    copy: '复制',
    copied: '✓ 已复制',
    section_source_label: '原始数据',
    section_source_title: '分析的帖子',
    post_type_video: '▶ 视频',
    post_type_note: '📄 笔记',
    no_title: '（无标题）',
    view_post: '查看原文 ↗',
    new_analysis: '+ 新分析',
    tokens_used: (n) => `已用 ${n} tokens`,

    err_analysis_failed: '分析失败',
    try_again: '重试',
    err_connection_lost: '连接已断开。请重试。',
    err_no_posts: '未找到帖子。试试其他关键词或检查账号连接。',

    ext_connected: '小红书已通过插件连接',
    ext_incomplete: '插件传来的 Cookie 不完整（缺少 web_session 或 a1）',
  },

  en: {
    brand_tag: 'Content Intelligence',

    hero_title_a: 'Decode what makes',
    hero_title_b: 'viral content',
    hero_sub: 'Enter a keyword. We analyze the top posts, comments, and patterns — then tell you exactly what to create.',

    field_keyword: 'KEYWORD',
    keyword_placeholder_xhs: 'e.g. 减肥, 护肤, 穿搭, 旅游',
    keyword_placeholder_douyin: 'e.g. 减肥, 护肤, 穿搭, 搞笑',
    field_account: (p) => `${p.toUpperCase()} ACCOUNT`,
    posts_to_analyze: 'POSTS TO ANALYZE',
    date_range: 'POST DATE RANGE',
    date_all: 'All time',
    date_7d: 'Last 7 days',
    date_30d: 'Last 30 days',
    date_90d: 'Last 3 months',
    date_180d: 'Last 6 months',
    slider_faster: '5 (faster)',
    slider_deeper: '20 (deeper)',
    analyze_cta: (kw, p) => `Analyze "${kw || '…'}" on ${p}`,
    cookie_hint: (p) => `↑ Connect your ${p} account to start analyzing.`,
    footer_text: 'Powered by',
    research_only: 'For research and learning purposes only',

    save_cookie: 'Save Cookie',
    switch_account: 'Switch account',
    connected: 'Connected',
    session_expired_xhs: '⚠️ Session expired — paste a fresh cookie to continue',
    session_expired_douyin: '⚠️ Cookie expired — paste a fresh one to continue',

    cookie_one_click_title: 'One-click connect with the NicheLens extension',
    cookie_step_download: 'Download',
    cookie_step_unzip: ' and unzip',
    cookie_step_load: 'Chrome → chrome://extensions → toggle Developer mode → Load unpacked → pick the unzipped folder',
    cookie_step_visit: 'Visit xiaohongshu.com or douyin.com (logged in). A "Connect" button appears bottom-right.',
    cookie_step_click: 'Click it. NicheLens opens, already connected.',
    cookie_note: 'One-time install. After that: every time you\'re on XHS, the button is right there — no extension icon, no copy/paste.',
    cookie_manual_fallback: 'Manual fallback: F12 → Network → click Fetch/XHR filter → reload → click any xiaohongshu.com API request → copy the cookie: header value → paste below.',
    cookie_validation_no_session: 'Missing web_session cookie. XHS marks it as httpOnly so a bookmarklet can\'t read it — you must use the Network tab method below.',
    cookie_validation_no_a1: 'Missing a1 cookie. Make sure you\'re logged into xiaohongshu.com and copied the full Cookie header.',

    douyin_paste_btn: '🔑 Paste Douyin Cookie',
    douyin_step_1: 'Open douyin.com in Chrome (logged in)',
    douyin_step_2: 'Press F12 → Network tab → reload the page',
    douyin_step_3: 'Click any request → Headers → find Cookie:',
    douyin_step_4: 'Copy the full value and paste below',

    load_searching: (p, kw) => `Searching ${p} for "${kw}"…`,
    load_stage_crawling: (p) => `Crawling ${p}`,
    load_stage_analyzing: 'AI Analysis',
    cancel: 'Cancel',

    report_posts_analyzed: (n) => `${n} posts analyzed`,
    intelligence_report: 'Intelligence Report',
    metric_avg_likes: 'Avg. Likes',
    metric_avg_collects: 'Avg. Collects',
    metric_avg_comments: 'Avg. Comments',
    metric_top_likes: 'Top Post Likes',
    section_top_patterns_label: 'TOP PATTERNS',
    section_top_patterns_title: "What's Working",
    section_content_insights_label: 'CONTENT INSIGHTS',
    section_content_insights_title: 'The Formula',
    card_winning_titles: 'Title Formulas That Win',
    card_winning_hooks: 'Hook Formulas That Win',
    card_best_formats: 'Best Content Formats',
    card_best_video_styles: 'Best Video Styles',
    card_length_visuals: 'Length & Visuals',
    card_duration_visuals: 'Duration & Visuals',
    card_keywords: 'Key Keywords in Top Posts',
    card_trending_tags: 'Trending Tags',
    section_comment_label: 'COMMENT INTELLIGENCE',
    section_comment_title: 'The Conversation',
    card_pain_points: 'Top Pain Points',
    card_questions: 'Common Questions',
    card_sentiment: 'Sentiment Overview',
    section_angles_label: 'SUGGESTED ANGLES',
    section_angles_title: 'Your Opportunity',
    how_to_differentiate: 'How to differentiate',
    section_hooks_label: 'HOOK EXAMPLES',
    section_hooks_title: 'Steal These Openers',
    copy: 'Copy',
    copied: '✓ Copied',
    section_source_label: 'SOURCE DATA',
    section_source_title: 'Posts Analyzed',
    post_type_video: '▶ Video',
    post_type_note: '📄 Note',
    no_title: '(no title)',
    view_post: 'View original ↗',
    new_analysis: '+ New Analysis',
    tokens_used: (n) => `${n} tokens used`,

    err_analysis_failed: 'Analysis Failed',
    try_again: 'Try Again',
    err_connection_lost: 'Connection lost. Please try again.',
    err_no_posts: 'No posts found. Try a different keyword or check your account connection.',

    ext_connected: '小红书 connected via extension',
    ext_incomplete: 'Extension cookie was incomplete (missing web_session or a1)',
  },
}
