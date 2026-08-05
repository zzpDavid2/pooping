import { supabase, isSupabaseConfigured } from './client'
import { ensureSession } from './auth'
import { ok, fail, fromThrown, type NameProposal, type Result } from './types'

/**
 * 厕所改名投票。
 *
 * OSM 上 85% 的点叫「公共厕所」，一屏全是重名 —— 官方数据不会来救，只能靠用户。
 * 一个厕所一人一票：投别的名字会自动把旧票挪过去（在 RPC 里一个事务完成）。
 */

interface NameRow {
  id: string
  name: string
  votes: number | string
  voted_by_me: boolean
  is_winner: boolean
}

function mapRow(r: NameRow): NameProposal {
  return {
    id: r.id,
    name: r.name,
    votes: typeof r.votes === 'number' ? r.votes : Number.parseInt(r.votes, 10) || 0,
    votedByMe: r.voted_by_me,
    isWinner: r.is_winner,
  }
}

export async function getToiletNames(toiletId: string): Promise<Result<NameProposal[]>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  try {
    const { data, error } = await supabase.rpc('toilet_names', { p_toilet_id: toiletId })
    if (error) return fail(error.code || 'db_error', error.message)
    return ok(((data ?? []) as NameRow[]).map(mapRow))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function voteToiletName(proposalId: string): Promise<Result<true>> {
  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }
  try {
    const { error } = await supabase.rpc('vote_toilet_name', { p_proposal_id: proposalId })
    if (error) return fail(error.code || 'db_error', error.message)
    return ok(true)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

export async function unvoteToiletName(proposalId: string): Promise<Result<true>> {
  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }
  try {
    const { error } = await supabase.rpc('unvote_toilet_name', { p_proposal_id: proposalId })
    if (error) return fail(error.code || 'db_error', error.message)
    return ok(true)
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}

/** 提名并自动投自己一票。名字已存在就直接改投它，不会产生重复候选。 */
export async function proposeToiletName(
  toiletId: string,
  name: string,
): Promise<Result<string>> {
  const trimmed = name.trim()
  if (!trimmed) return fail('invalid_input', '名字不能为空 / name is required')
  if (trimmed.length > 40) return fail('invalid_input', '名字太长 / name too long')

  const session = await ensureSession()
  if (session.error) return { data: null, error: session.error }

  try {
    const { data, error } = await supabase.rpc('propose_toilet_name', {
      p_toilet_id: toiletId,
      p_name: trimmed,
    })
    if (error) {
      if (error.code === '54000' || error.message.includes('rate_limited')) {
        return fail('rate_limited', error.message)
      }
      return fail(error.code || 'db_error', error.message)
    }
    return ok(String(data))
  } catch (e) {
    return fromThrown(e, 'db_error')
  }
}
