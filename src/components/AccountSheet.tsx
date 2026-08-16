import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Loader2, LogOut, X } from 'lucide-react'

import {
  getCurrentUser,
  getMyReviewStats,
  signOut,
  startEmailLogin,
  verifyEmailLogin,
  type CurrentUser,
  type EmailLoginMode,
  type ReviewStats,
} from '@/api'
import { useI18n } from '@/i18n/useI18n'

interface AccountSheetProps {
  onClose: () => void
}

/**
 * "我的" 面板：访客模式下是邮箱验证码登录表单，登录后是战绩 + 退出登录。
 *
 * 登录本身分两步（发验证码 → 输验证码），但对用户来说只是"输入邮箱、输入验证码"
 * 两个框，是升级匿名账号还是登录老账号，由 startEmailLogin 内部判断，这里不用关心。
 */
export default function AccountSheet({ onClose }: AccountSheetProps) {
  const { t } = useI18n()

  const [user, setUser] = useState<CurrentUser | null>(null)
  const [stats, setStats] = useState<ReviewStats | null>(null)
  const [loadingUser, setLoadingUser] = useState(true)

  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [mode, setMode] = useState<EmailLoginMode | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    void getCurrentUser().then((res) => {
      if (cancelled) return
      setUser(res.data ?? null)
      setLoadingUser(false)
      if (res.data && !res.data.isAnonymous) {
        void getMyReviewStats().then((s) => {
          if (!cancelled) setStats(s.data)
        })
      }
    })

    return () => {
      cancelled = true
    }
  }, [])

  async function handleSendCode() {
    setBusy(true)
    setError(null)
    const res = await startEmailLogin(email)
    setBusy(false)

    if (res.error) {
      setError(t.accountSendFailed)
      return
    }
    setMode(res.data)
  }

  async function handleVerify() {
    if (!mode) return
    setBusy(true)
    setError(null)
    const res = await verifyEmailLogin(email, code, mode)
    setBusy(false)

    if (res.error) {
      setError(t.accountVerifyFailed)
      return
    }
    setUser(res.data)
    const s = await getMyReviewStats()
    setStats(s.data)
  }

  async function handleSignOut() {
    setBusy(true)
    const res = await signOut()
    setBusy(false)
    if (res.data) {
      setUser(res.data)
      setStats(null)
      setEmail('')
      setCode('')
      setMode(null)
    }
  }

  // TopBar 自己有 z-index，会给子元素罩一层"层叠上下文"天花板——
  // 弹窗哪怕自己 z-40 也冲不出去，会被下面地图面板盖住。传送到 body 上就没有这个限制了。
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 animate-fade-in sm:items-center">
      <div className="safe-bottom flex max-h-[92vh] w-full max-w-sm flex-col rounded-t-2xl bg-white animate-slide-up sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-poo-100 px-4 py-3">
          <h2 className="font-semibold">{t.account}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-faint">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {loadingUser ? (
            <div className="flex justify-center py-8">
              <Loader2 size={20} className="animate-spin text-ink-faint" />
            </div>
          ) : user && !user.isAnonymous ? (
            <>
              <p className="text-sm text-ink-soft">{user.email}</p>

              <div className="rounded-xl border border-poo-200 bg-poo-50 p-4">
                <p className="mb-3 text-sm font-semibold">{t.accountStats}</p>
                {stats ? (
                  <div className="flex gap-6">
                    <div>
                      <p className="text-2xl font-bold text-poo-700">{stats.aiCount}</p>
                      <p className="text-xs text-ink-soft">
                        {t.accountStatsAi}
                        {t.accountStatsUnit}
                      </p>
                    </div>
                    <div>
                      <p className="text-2xl font-bold text-poo-700">{stats.manualCount}</p>
                      <p className="text-xs text-ink-soft">
                        {t.accountStatsManual}
                        {t.accountStatsUnit}
                      </p>
                    </div>
                  </div>
                ) : (
                  <Loader2 size={16} className="animate-spin text-ink-faint" />
                )}
              </div>

              <button
                type="button"
                onClick={() => void handleSignOut()}
                disabled={busy}
                className="btn btn--ghost w-full"
              >
                <LogOut size={16} />
                {t.accountSignOut}
              </button>
            </>
          ) : (
            <>
              <div>
                <p className="text-sm font-semibold">{t.accountGuestMode}</p>
                <p className="mt-1 text-xs text-ink-soft">{t.accountGuestHint}</p>
              </div>

              <div>
                <input
                  id="accountEmail"
                  name="accountEmail"
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={mode !== null}
                  placeholder={t.accountEmailPlaceholder}
                  className="w-full rounded-xl border border-poo-200 px-3 py-2 text-sm outline-none focus:border-poo-500 disabled:bg-poo-50 disabled:text-ink-soft"
                />
              </div>

              {mode === null ? (
                <button
                  type="button"
                  onClick={() => void handleSendCode()}
                  disabled={busy || !email.trim()}
                  className="btn btn--primary w-full"
                >
                  {busy ? (
                    <>
                      <Loader2 size={16} className="animate-spin" />
                      {t.accountSending}
                    </>
                  ) : (
                    t.accountSendCode
                  )}
                </button>
              ) : (
                <>
                  <p className="text-xs text-ink-soft">{t.accountCodeSent}</p>
                  <input
                    id="accountCode"
                    name="accountCode"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    placeholder={t.accountCodePlaceholder}
                    className="w-full rounded-xl border border-poo-200 px-3 py-2 text-center text-lg tracking-[0.3em] outline-none focus:border-poo-500"
                  />
                  <button
                    type="button"
                    onClick={() => void handleVerify()}
                    disabled={busy || code.length < 6}
                    className="btn btn--primary w-full"
                  >
                    {busy ? (
                      <>
                        <Loader2 size={16} className="animate-spin" />
                        {t.accountVerifying}
                      </>
                    ) : (
                      t.accountVerify
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSendCode()}
                    disabled={busy}
                    className="w-full text-center text-xs text-ink-soft underline"
                  >
                    {t.accountResendCode}
                  </button>
                </>
              )}

              {error && (
                <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
              )}
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
