import { supabase, isSupabaseConfigured } from './client'
import { ok, fail, fromThrown, type Result } from './types'

export interface CurrentUser {
  id: string
  nickname: string | null
  isAnonymous: boolean
}

/**
 * 正在进行中的登录请求。
 *
 * 「查 session → 没有就登录」是个 check-then-act，并发调用会一起穿过去：
 * App 挂载时调一次、用户点发布时又调一次，就会建出两个匿名号，
 * 评价还可能挂到用户看不见的那一个上。开发环境 StrictMode 双跑 effect 会稳定复现。
 *
 * 所以把飞行中的 promise 存起来，并发调用共享同一次请求。
 */
let pending: Promise<Result<CurrentUser>> | null = null

/**
 * V1 只做匿名登录（CLAUDE.md 第 5 节）。打开即用，没有注册流程。
 * 幂等且并发安全：已有 session 直接返回，同时多次调用只会真正登录一次。
 */
export function ensureSession(): Promise<Result<CurrentUser>> {
  if (!isSupabaseConfigured) {
    return Promise.resolve(
      fail('not_configured', 'Supabase 未配置 / Supabase is not configured'),
    )
  }

  if (pending) return pending

  pending = signIn().finally(() => {
    // 失败也要清掉，否则一次网络抖动会把后续所有调用永久钉在同一个错误上
    pending = null
  })

  return pending
}

async function signIn(): Promise<Result<CurrentUser>> {
  try {
    const { data: existing } = await supabase.auth.getSession()
    if (existing.session?.user) {
      // getSession 只读本地存的 JWT，不校验这个用户还在不在。
      // 用户被删掉（开发时 `supabase db reset` 就会）之后本地 token 依然"有效"，
      // 结果是所有写入都撞外键，报一个跟真实原因毫无关系的错。
      // 这里向服务端确认一次；确认不过就当作没登录，重新开一个匿名号。
      const { data: verified } = await supabase.auth.getUser()
      if (verified.user) return ok(toCurrentUser(verified.user))
      await supabase.auth.signOut({ scope: 'local' })
    }

    const { data, error } = await supabase.auth.signInAnonymously()
    if (error) return fail(error.code ?? 'auth_error', error.message)
    if (!data.user) return fail('auth_error', '匿名登录没有返回用户 / no user returned')

    return ok(toCurrentUser(data.user))
  } catch (e) {
    return fromThrown(e, 'auth_error')
  }
}

export async function getCurrentUser(): Promise<Result<CurrentUser | null>> {
  if (!isSupabaseConfigured) return ok(null)
  try {
    const { data } = await supabase.auth.getSession()
    return ok(data.session?.user ? toCurrentUser(data.session.user) : null)
  } catch (e) {
    return fromThrown(e, 'auth_error')
  }
}

/** 昵称存在 user_metadata，用户自己起，不做唯一性校验。 */
export async function setNickname(nickname: string): Promise<Result<CurrentUser>> {
  const trimmed = nickname.trim().slice(0, 24)
  if (!trimmed) return fail('invalid_input', '昵称不能为空 / nickname is empty')

  try {
    const { data, error } = await supabase.auth.updateUser({
      data: { nickname: trimmed },
    })
    if (error) return fail(error.code ?? 'auth_error', error.message)
    if (!data.user) return fail('auth_error', 'updateUser 没有返回用户 / no user returned')
    return ok(toCurrentUser(data.user))
  } catch (e) {
    return fromThrown(e, 'auth_error')
  }
}

/** 拿当前 access token，给 Edge Function 调用用。 */
export async function getAccessToken(): Promise<string | null> {
  if (!isSupabaseConfigured) return null
  try {
    const { data } = await supabase.auth.getSession()
    return data.session?.access_token ?? null
  } catch {
    return null
  }
}

interface AuthUserLike {
  id: string
  is_anonymous?: boolean
  user_metadata?: Record<string, unknown>
}

function toCurrentUser(user: AuthUserLike): CurrentUser {
  const raw = user.user_metadata?.['nickname']
  return {
    id: user.id,
    nickname: typeof raw === 'string' && raw ? raw : null,
    isAnonymous: user.is_anonymous ?? true,
  }
}
