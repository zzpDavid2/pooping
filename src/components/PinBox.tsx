import { useEffect, useState } from 'react'
import { KeyRound, Loader2, Lock } from 'lucide-react'

import { deleteMyPin, getMyPin, saveMyPin, type ToiletPin } from '@/api'
import { useI18n } from '@/i18n/useI18n'

interface PinBoxProps {
  toiletId: string
}

/**
 * 门锁密码。**只有本人看得到**（RLS 锁死在 auth.uid()，见 add_toilet_pins migration）。
 *
 * 不公开是刻意的：公开等于帮人白嫖商家，商家一改密码这功能就废了；
 * 而且密码常变，公开的旧密码会误导人。所以这是"我自己的备忘"，不是 UGC 内容。
 *
 * 存和改是同一个动作（后端 upsert），前端不区分，用户只看到一个输入框。
 */
export default function PinBox({ toiletId }: PinBoxProps) {
  const { t } = useI18n()

  const [pin, setPin] = useState<ToiletPin | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [draftPin, setDraftPin] = useState('')
  const [draftNote, setDraftNote] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)

    void getMyPin(toiletId).then((res) => {
      if (cancelled) return
      setPin(res.data ?? null)
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [toiletId])

  function startEditing() {
    setDraftPin(pin?.pin ?? '')
    setDraftNote(pin?.note ?? '')
    setError(null)
    setEditing(true)
  }

  async function handleSave() {
    if (!draftPin.trim()) return
    setBusy(true)
    setError(null)
    const res = await saveMyPin(toiletId, draftPin, draftNote)
    setBusy(false)

    if (res.error) {
      setError(t.pinSaveFailed)
      return
    }
    setPin(res.data)
    setEditing(false)
  }

  async function handleDelete() {
    setBusy(true)
    const res = await deleteMyPin(toiletId)
    setBusy(false)
    if (!res.error) {
      setPin(null)
      setEditing(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-3">
        <Loader2 size={16} className="animate-spin text-ink-faint" />
      </div>
    )
  }

  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5">
        <h3 className="text-sm font-semibold">{t.pinTitle}</h3>
        <span className="inline-flex items-center gap-1 rounded-full bg-poo-50 px-2 py-0.5 text-[11px] text-ink-faint">
          <Lock size={10} />
          {t.pinPrivateHint}
        </span>
      </div>

      {editing ? (
        <div className="space-y-2">
          <input
            id="toiletPin"
            name="toiletPin"
            autoFocus
            autoComplete="off"
            value={draftPin}
            onChange={(e) => setDraftPin(e.target.value.slice(0, 40))}
            placeholder={t.pinPlaceholder}
            className="w-full rounded-xl border border-poo-200 px-3 py-2 text-lg font-semibold tracking-wider outline-none focus:border-poo-500"
          />
          <input
            id="toiletPinNote"
            name="toiletPinNote"
            autoComplete="off"
            value={draftNote}
            onChange={(e) => setDraftNote(e.target.value.slice(0, 200))}
            placeholder={t.pinNotePlaceholder}
            className="w-full rounded-xl border border-poo-200 px-3 py-2 text-sm outline-none focus:border-poo-500"
          />

          {error && <p className="text-xs text-rose-600">{error}</p>}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="btn btn--ghost"
              disabled={busy}
            >
              {t.cancel}
            </button>
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy || !draftPin.trim()}
              className="btn btn--primary flex-1"
            >
              {busy ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t.pinSaving}
                </>
              ) : (
                t.pinSave
              )}
            </button>
          </div>
        </div>
      ) : pin ? (
        <div className="rounded-xl border border-poo-200 bg-poo-50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <p className="text-xl font-bold tracking-wider text-poo-800">{pin.pin}</p>
            <div className="flex shrink-0 gap-1">
              <button
                type="button"
                onClick={startEditing}
                className="rounded-lg px-2 py-1 text-xs text-ink-soft hover:bg-white"
              >
                {t.pinEdit}
              </button>
              <button
                type="button"
                onClick={() => void handleDelete()}
                disabled={busy}
                className="rounded-lg px-2 py-1 text-xs text-ink-faint hover:bg-white disabled:opacity-50"
              >
                {t.pinDelete}
              </button>
            </div>
          </div>
          {pin.note && <p className="mt-1 text-xs text-ink-soft">{pin.note}</p>}
        </div>
      ) : (
        <button
          type="button"
          onClick={startEditing}
          className="flex w-full items-center gap-2 rounded-xl border border-dashed border-poo-200 px-3 py-2.5 text-left text-sm text-ink-soft hover:border-poo-400 hover:bg-poo-50"
        >
          <KeyRound size={16} className="shrink-0 text-poo-600" />
          <span className="min-w-0 flex-1">{t.pinEmpty}</span>
          <span className="shrink-0 text-xs font-medium text-poo-700">{t.pinAdd}</span>
        </button>
      )}
    </div>
  )
}
