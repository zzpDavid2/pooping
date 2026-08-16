import { supabase, isSupabaseConfigured } from './client'
import { ok, fail, fromThrown, type Result } from './types'

export interface CurrentUser {
  id: string
  nickname: string | null
  isAnonymous: boolean
  email: string | null
}

/**
 * 发验证码这一步分两种情况，但对用户来说是同一个动作（输入邮箱）：
 *
 * - 'upgrade'：当前是匿名身份，第一次绑邮箱，把匿名账号原地升级成正式账号，
 *   user.id 不变，历史评价不丢（CLAUDE.md 5：升级用 linkIdentity 类似的思路）。
 * - 'signin'：这个邮箱已经绑过别的账号了 —— 说明是老用户换设备回来找号，
 *   改成登录已有账号，这次登录后会换成那个账号的 session。
 */
export type EmailLoginMode = 'upgrade' | 'signin'

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

/**
 * 发验证码。先假设是"给匿名账号首次绑邮箱"；如果这个邮箱已经被注册过
 * （error.code === 'email_exists'），说明猜错了，改走"登录已有账号"那条路重发一次。
 * 两条路用的是不同的验证码类型，所以要把选中的模式带回去，验证时才知道该传哪个 type。
 */
export async function startEmailLogin(email: string): Promise<Result<EmailLoginMode>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const trimmed = email.trim()
  if (!trimmed) return fail('invalid_input', '请输入邮箱 / enter an email')

  try {
    const { data: session } = await supabase.auth.getSession()
    const isAnon = session.session?.user?.is_anonymous ?? true

    if (isAnon) {
      const { error } = await supabase.auth.updateUser({ email: trimmed })
      if (!error) return ok('upgrade')
      if (error.code !== 'email_exists') return fail(error.code ?? 'auth_error', error.message)
      // 邮箱已经被注册过，往下走登录已有账号那条路
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: trimmed,
      options: { shouldCreateUser: false },
    })
    if (error) return fail(error.code ?? 'auth_error', error.message)
    return ok('signin')
  } catch (e) {
    return fromThrown(e, 'auth_error')
  }
}

/** 校验用户从邮件里抄回来的 6 位验证码，完成升级或登录。 */
export async function verifyEmailLogin(
  email: string,
  token: string,
  mode: EmailLoginMode,
): Promise<Result<CurrentUser>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }

  const trimmedToken = token.trim()
  if (!trimmedToken) return fail('invalid_input', '请输入验证码 / enter the code')

  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: trimmedToken,
      type: mode === 'upgrade' ? 'email_change' : 'email',
    })
    if (error) return fail(error.code ?? 'auth_error', error.message)
    if (!data.user) return fail('auth_error', '验证失败 / verification failed')
    return ok(toCurrentUser(data.user))
  } catch (e) {
    return fromThrown(e, 'auth_error')
  }
}

/**
 * 退出正式账号，换回一个新的匿名身份 —— 不是"变成没有身份"，
 * 这个产品从打开就得有身份（发评价要挂 user_id），退出登录只是换一个。
 */
export async function signOut(): Promise<Result<CurrentUser>> {
  if (!isSupabaseConfigured) {
    return fail('not_configured', 'Supabase 未配置 / Supabase is not configured')
  }
  try {
    const { error } = await supabase.auth.signOut()
    if (error) return fail(error.code ?? 'auth_error', error.message)
    return signIn()
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
  email?: string
  is_anonymous?: boolean
  user_metadata?: Record<string, unknown>
}

function toCurrentUser(user: AuthUserLike): CurrentUser {
  const raw = user.user_metadata?.['nickname']
  return {
    id: user.id,
    nickname: typeof raw === 'string' && raw ? raw : null,
    isAnonymous: user.is_anonymous ?? true,
    email: user.email || null,
  }
}
