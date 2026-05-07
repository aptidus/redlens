/**
 * Extension-driven scrapers. These run XHS/Douyin API calls inside the user's
 * own browser tab via the extension bridge — no server-side scraping, no -104
 * blocks. Output shape matches what /api/analyze-from-results expects.
 */
import { extensionFetch } from './extensionApi'

export interface ScrapedNote {
  note_id: string
  note_url: string
  title: string
  desc: string
  type: string
  liked_count: number
  collected_count: number
  comment_count: number
  share_count: number
  user: string
  cover_url: string
  tags: string[]
  create_time: number
  comments: unknown[]
}

function safeInt(v: unknown): number {
  if (typeof v === 'number') return v
  const n = Number.parseInt(String(v ?? '0'), 10)
  return Number.isFinite(n) ? n : 0
}

function genSearchId(): string {
  // XHS expects ~21-char base36 search id. Match its format loosely.
  const t = Date.now().toString(36)
  const r = Math.random().toString(36).slice(2, 12)
  return (t + r).slice(0, 21)
}

interface XhsSearchItem {
  id?: string
  model_type?: string
  xsec_token?: string
  note_card?: {
    type?: string
    display_title?: string
    desc?: string
    liked_count?: number | string
    collected_count?: number | string
    comment_count?: number | string
    share_count?: number | string
    cover?: { url_default?: string; url_pre?: string }
    user?: { nickname?: string; nick_name?: string }
    interact_info?: {
      liked_count?: number | string
      collected_count?: number | string
      comment_count?: number | string
      share_count?: number | string
    }
    tag_list?: Array<{ name?: string }>
  }
}

function reshapeXhsItem(item: XhsSearchItem): ScrapedNote | null {
  const noteId = item.id
  if (!noteId) return null
  const card = item.note_card || {}
  const interact = card.interact_info || {}
  const tags = (card.tag_list || []).map(t => t.name || '').filter(Boolean)
  const xsec = item.xsec_token || ''
  return {
    note_id: noteId,
    note_url: `https://www.xiaohongshu.com/explore/${noteId}` + (xsec ? `?xsec_token=${xsec}&xsec_source=pc_search` : ''),
    title: card.display_title || '',
    desc: card.desc || '',
    type: card.type || 'normal',
    liked_count: safeInt(interact.liked_count ?? card.liked_count),
    collected_count: safeInt(interact.collected_count ?? card.collected_count),
    comment_count: safeInt(interact.comment_count ?? card.comment_count),
    share_count: safeInt(interact.share_count ?? card.share_count),
    user: card.user?.nickname || card.user?.nick_name || '',
    cover_url: card.cover?.url_default || card.cover?.url_pre || '',
    tags,
    create_time: 0,
    comments: [],
  }
}

export async function scrapeXhsViaExtension(keyword: string, maxNotes: number): Promise<ScrapedNote[]> {
  const payload = {
    keyword,
    page: 1,
    page_size: Math.min(Math.max(maxNotes, 1), 30),
    search_id: genSearchId(),
    sort: 'general',
    note_type: 0,
    ext_flags: [],
  }
  const resp = await extensionFetch<{ success?: boolean; code?: number; msg?: string; data?: { items?: XhsSearchItem[] } }>(
    'xhs',
    {
      path: '/api/sns/web/v1/search/notes',
      method: 'POST',
      body: payload,
    }
  )
  if (resp && resp.success === false) {
    throw new Error(`XHS error ${resp.code ?? '?'}: ${resp.msg ?? 'unknown'}`)
  }
  const items = resp?.data?.items || []
  const notes: ScrapedNote[] = []
  for (const it of items) {
    const reshaped = reshapeXhsItem(it)
    if (reshaped) notes.push(reshaped)
    if (notes.length >= maxNotes) break
  }
  return notes
}
