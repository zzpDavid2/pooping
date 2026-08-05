import { createClient, type SupabaseClient } from '@supabase/supabase-js'

// 连接串全部走 env（CLAUDE.md 8.5）。代码里不写死任何 URL。
const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? ''
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim() ?? ''

/**
 * 没配 env 时不要让整个 app 白屏 —— 首屏静态数据（8.3）本来就不依赖 Supabase，
 * 地图应该照常能开。UI 用这个 flag 决定要不要显示"未连接数据库"的提示条。
 */
export const isSupabaseConfigured = Boolean(url && anonKey)

/** 唯一实例。除 src/api/ 内部外，任何地方都不许 import 它。 */
export const supabase: SupabaseClient = createClient(
  url || 'http://localhost:54321',
  anonKey || 'anon-key-not-configured',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: false,
    },
    global: {
      headers: { 'x-client-info': 'pooping-web' },
    },
  },
)

export const functionsBaseUrl = url ? `${url.replace(/\/$/, '')}/functions/v1` : ''
