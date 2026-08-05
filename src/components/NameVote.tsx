import { useEffect, useState } from 'react'
import { Check, Plus, X } from 'lucide-react'

import {
  getToiletNames,
  proposeToiletName,
  unvoteToiletName,
  voteToiletName,
  type NameProposal,
} from '@/api'
import { useI18n } from '@/i18n/useI18n'

interface NameVoteProps {
  toiletId: string
  /** 数据源里的原始名字，作为"官方名"垫底显示 */
  fallbackName: string
  onWinnerChange?: (name: string | null) => void
}

/**
 * 给厕所改名投票，Discord reaction 那种交互：
 * 一排药丸，每个是「名字 · 票数」，点一下投票，再点一下收回。
 *
 * 一个厕所一人一票 —— 投别的名字会自动把票挪过去。
 * 这比 Discord 的多选更适合命名：多选会让所有名字票数都很高，选不出赢家。
 */
export default function NameVote({ toiletId, fallbackName, onWinnerChange }: NameVoteProps) {
  const { t } = useI18n()

  const [names, setNames] = useState<NameProposal[]>([])
  const [adding, setAdding] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function load() {
    const res = await getToiletNames(toiletId)
    if (res.error) return
    setNames(res.data)
    onWinnerChange?.(res.data.find((n) => n.isWinner)?.name ?? null)
  }

  useEffect(() => {
    void load()
    // toiletId 变了才重新拉；onWinnerChange 是父组件每次渲染的新函数，不能进依赖
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toiletId])

  async function toggleVote(p: NameProposal) {
    if (busy) return
    setBusy(true)
    setError(null)

    // 乐观更新：投票是高频轻操作，等一个往返再变色会显得很迟钝
    setNames((cur) =>
      cur.map((n) => {
        if (n.id === p.id) {
          return { ...n, votedByMe: !p.votedByMe, votes: n.votes + (p.votedByMe ? -1 : 1) }
        }
        // 一人一票：投了新的，旧的那票要在界面上同步减掉
        if (!p.votedByMe && n.votedByMe) {
          return { ...n, votedByMe: false, votes: Math.max(0, n.votes - 1) }
        }
        return n
      }),
    )

    const res = p.votedByMe ? await unvoteToiletName(p.id) : await voteToiletName(p.id)
    setBusy(false)
    if (res.error) setError(t.voteFailed)
    await load() // 以服务端为准，顺便把赢家算准
  }

  async function submitProposal() {
    const name = draft.trim()
    if (!name) return

    setBusy(true)
    setError(null)
    const res = await proposeToiletName(toiletId, name)
    setBusy(false)

    if (res.error) {
      setError(res.error.code === 'rate_limited' ? t.nameTooFast : t.voteFailed)
      return
    }
    setDraft('')
    setAdding(false)
    await load()
  }

  async function voteFallbackName() {
    if (busy) return
    const name = fallbackName.trim()
    if (!name) return

    setBusy(true)
    setError(null)
    const res = await proposeToiletName(toiletId, name)
    setBusy(false)

    if (res.error) {
      setError(res.error.code === 'rate_limited' ? t.nameTooFast : t.voteFailed)
      return
    }
    await load()
  }

  const fallbackIsListed = names.some((p) => p.name.trim() === fallbackName.trim())

  return (
    <section>
      <div className="mb-2 flex items-baseline justify-between">
        <h3 className="text-sm font-semibold">{t.nameVoteTitle}</h3>
        <span className="text-[11px] text-ink-faint">{t.nameVoteHint}</span>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {names.map((p) => (
          <button
            key={p.id}
            type="button"
            disabled={busy}
            onClick={() => void toggleVote(p)}
            aria-pressed={p.votedByMe}
            className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors disabled:opacity-60 ${
              p.votedByMe
                ? 'border-poo-600 bg-poo-600 text-white'
                : 'border-poo-200 bg-white text-ink-soft hover:bg-poo-50'
            }`}
          >
            {p.isWinner && <span aria-hidden="true">👑</span>}
            <span className="font-medium">{p.name}</span>
            <span
              className={`rounded-full px-1.5 tabular-nums ${
                p.votedByMe ? 'bg-white/25' : 'bg-poo-100 text-poo-800'
              }`}
            >
              {p.votes}
            </span>
            {p.votedByMe && <Check size={11} />}
          </button>
        ))}

        {!fallbackIsListed && fallbackName.trim() && (
          <button
            type="button"
            disabled={busy}
            onClick={() => void voteFallbackName()}
            className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-poo-300 bg-white px-2.5 py-1 text-xs text-ink-soft hover:bg-poo-50 disabled:opacity-60"
          >
            {fallbackName}
            <span className="rounded-full bg-poo-100 px-1.5 tabular-nums text-poo-800">0</span>
          </button>
        )}

        {!adding && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex items-center gap-1 rounded-full border border-dashed border-poo-300 px-2.5 py-1 text-xs text-poo-700 hover:bg-poo-50"
          >
            <Plus size={12} />
            {t.nameProposeNew}
          </button>
        )}
      </div>

      {adding && (
        <div className="mt-2 flex gap-1.5">
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value.slice(0, 40))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submitProposal()
              if (e.key === 'Escape') setAdding(false)
            }}
            placeholder={t.namePlaceholder}
            className="min-w-0 flex-1 rounded-xl border border-poo-200 px-3 py-1.5 text-sm outline-none focus:border-poo-500"
          />
          <button
            type="button"
            disabled={busy || !draft.trim()}
            onClick={() => void submitProposal()}
            className="btn btn--primary px-3 py-1.5 text-xs"
          >
            {t.nameSubmit}
          </button>
          <button
            type="button"
            onClick={() => {
              setAdding(false)
              setDraft('')
            }}
            className="rounded-lg p-1.5 text-ink-faint"
            aria-label={t.cancel}
          >
            <X size={16} />
          </button>
        </div>
      )}

      {error && <p className="mt-1.5 text-xs text-rose-700">{error}</p>}
    </section>
  )
}
