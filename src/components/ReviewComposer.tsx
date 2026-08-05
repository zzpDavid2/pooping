import { useState } from 'react'
import { Loader2, Sparkles, Wand2, X } from 'lucide-react'

import {
  createReview,
  generateReview,
  type Review,
  type ReviewStyle,
  type Toilet,
} from '@/api'
import { useI18n } from '@/i18n/useI18n'
import { STYLE_META, randomStyle } from '@/constants/styles'
import {
  LOOSE_TAGS,
  LOOSE_TAG_MAX,
  TAG_GROUPS,
  TAG_GROUP_LABELS,
  countLooseSelected,
  toggleTagKey,
} from '@/constants/tags'
import { RatingPicker } from './Ratings'

interface ReviewComposerProps {
  toilet: Toilet
  onClose: () => void
  onPublished: (review: Review) => void
}

const TONE_CLASS = {
  bad: 'border-rose-200 text-rose-700',
  good: 'border-emerald-200 text-emerald-700',
  neutral: 'border-poo-200 text-ink-soft',
} as const

/**
 * 发布流程固定：勾选 → 生成 → **预览可改** → 发布（CLAUDE.md 10.3）。
 * 生成和发布是两个动作，绝不允许把生成结果直接落库。
 */
export default function ReviewComposer({ toilet, onClose, onPublished }: ReviewComposerProps) {
  const { t, locale } = useI18n()

  const [clean, setClean] = useState(3)
  const [smell, setSmell] = useState(3)
  const [queue, setQueue] = useState(3)
  const [privacy, setPrivacy] = useState(3)
  const [tags, setTags] = useState<string[]>([])
  const [rawNote, setRawNote] = useState('')
  const [style, setStyle] = useState<ReviewStyle>(randomStyle)
  const [nickname, setNickname] = useState('')

  /** 'ai' = 走生成再预览；'self' = 用户自己写，完全不碰 LLM */
  const [mode, setMode] = useState<'ai' | 'self'>('ai')
  const [selfText, setSelfText] = useState('')

  const [draft, setDraft] = useState('')
  const [generatedText, setGeneratedText] = useState('')
  const [phase, setPhase] = useState<'form' | 'preview'>('form')
  const [busy, setBusy] = useState<'generate' | 'publish' | null>(null)
  const [error, setError] = useState<string | null>(null)

  // 互斥组走单选，其余多选。规则在 constants/tags.ts 里，UI 只负责画。
  const toggleTag = (tag: (typeof LOOSE_TAGS)[number]) =>
    setTags((cur) => toggleTagKey(cur, tag))

  const payload = {
    toiletId: toilet.id,
    clean,
    smell,
    queue,
    privacy,
    quickTags: tags,
    rawNote,
    lang: locale,
  }

  async function handleGenerate(nextStyle: ReviewStyle = style) {
    setBusy('generate')
    setError(null)

    const res = await generateReview({ ...payload, style: nextStyle })
    setBusy(null)

    if (res.error) {
      setError(res.error.code === 'rate_limited' ? t.rateLimited : t.generateFailed)
      return
    }

    setGeneratedText(res.data.text)
    setDraft(res.data.text)
    setStyle(nextStyle)
    setPhase('preview')
  }

  async function handlePublish() {
    const isAi = mode === 'ai'
    const text = (isAi ? draft : selfText).trim()
    if (!text) {
      setError(isAi ? t.needGenerate : t.needSelfText)
      return
    }

    setBusy('publish')
    setError(null)

    const res = await createReview({
      ...payload,
      aiText: text,
      // 自己写的没有文风，也绝不能挂 AI 标（CLAUDE.md 10.2）
      style: isAi ? style : null,
      isAi,
      // 用户动过就标出来，卡片上会显示「本人改过」。自己写的整篇都是他的，不算"改过"
      editedByUser: isAi && text !== generatedText.trim(),
      nickname: nickname.trim() || null,
    })
    setBusy(null)

    if (res.error) {
      setError(res.error.code === 'rate_limited' ? t.rateLimited : res.error.message)
      return
    }
    onPublished(res.data)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 animate-fade-in sm:items-center">
      <div className="safe-bottom flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white animate-slide-up sm:max-h-[86vh] sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-poo-100 px-4 py-3">
          <h2 className="font-semibold">{t.writeReview}</h2>
          <button type="button" onClick={onClose} className="rounded-lg p-1 text-ink-faint">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-5 overflow-y-auto px-4 py-4">
          {phase === 'form' ? (
            <>
              {/* 评分和标签两条路都要填 —— 结构化数据是留存的那一半，跟谁写正文无关。
                  「交给 AI 还是自己写」的选择在下面的文风组里。 */}
              <section className="space-y-2.5">
                <h3 className="text-sm font-semibold">{t.stepRate}</h3>
                <p className="-mt-1 text-xs text-ink-faint">{t.ratingHint}</p>
                <RatingPicker label={t.rateClean} value={clean} onChange={setClean} />
                <RatingPicker label={t.rateSmell} value={smell} onChange={setSmell} />
                <RatingPicker label={t.rateQueue} value={queue} onChange={setQueue} />
                <RatingPicker label={t.ratePrivacy} value={privacy} onChange={setPrivacy} />
              </section>

              <section className="space-y-3">
                <h3 className="text-sm font-semibold">{t.stepTags}</h3>

                {/* 互斥组：一组一行，只能选一个。
                    「排大队」和「完全不用等」同时勾上会让模型写出自相矛盾的东西。 */}
                {TAG_GROUPS.map(({ group, tags: groupTags }) => (
                  <div key={group}>
                    <p className="mb-1 text-[11px] font-medium text-ink-faint">
                      {TAG_GROUP_LABELS[group][locale]}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {groupTags.map((tag) => {
                        const on = tags.includes(tag.key)
                        return (
                          <button
                            key={tag.key}
                            type="button"
                            aria-pressed={on}
                            onClick={() => toggleTag(tag)}
                            className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                              on
                                ? 'border-poo-600 bg-poo-600 text-white'
                                : `bg-white ${TONE_CLASS[tag.tone]}`
                            }`}
                          >
                            {tag.label[locale]}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}

                <div>
                  <div className="mb-1 flex items-baseline justify-between">
                    <p className="text-[11px] font-medium text-ink-faint">{t.tagsOther}</p>
                    <p className="text-[11px] text-ink-faint">
                      <span
                        className={
                          countLooseSelected(tags) >= LOOSE_TAG_MAX ? 'font-semibold text-poo-700' : ''
                        }
                      >
                        {t.tagCount(countLooseSelected(tags), LOOSE_TAG_MAX)}
                      </span>
                      <span className="ml-1.5 opacity-70">· {t.tagLimitNote}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {LOOSE_TAGS.map((tag) => {
                      const on = tags.includes(tag.key)
                      const capped = !on && countLooseSelected(tags) >= LOOSE_TAG_MAX
                      return (
                        <button
                          key={tag.key}
                          type="button"
                          aria-pressed={on}
                          disabled={capped}
                          onClick={() => toggleTag(tag)}
                          className={`rounded-full border px-2.5 py-1 text-xs transition-colors ${
                            on
                              ? 'border-poo-600 bg-poo-600 text-white'
                              : capped
                                ? 'border-poo-100 bg-white text-ink-faint/40'
                                : `bg-white ${TONE_CLASS[tag.tone]}`
                          }`}
                        >
                          {tag.label[locale]}
                        </button>
                      )
                    })}
                  </div>
                </div>
              </section>

              {/*
                「谁来写」是一个选择，所以八个文风和「我自己写」放在同一组里，
                而不是在顶上再立一个模式开关 —— 那会让用户先做一次选择、再做一次选择。
                自己写的那块占满两列摆在最后：它不是第九种文风，是另一条路。

                选择下面永远只有**一个**输入框，内容跟着选择走：
                交给 AI 就是「补一句」（喂素材），自己写就是正文本身。
                两者摆在同一个位置，用户不用去想该往哪个框里写。
              */}
              <section>
                <h3 className="mb-2 text-sm font-semibold">{t.stepStyle}</h3>
                <div className="grid grid-cols-2 gap-1.5">
                  {STYLE_META.map((s) => {
                    const on = mode === 'ai' && style === s.key
                    return (
                      <button
                        key={s.key}
                        type="button"
                        aria-pressed={on}
                        onClick={() => {
                          setMode('ai')
                          setStyle(s.key)
                        }}
                        className={`rounded-xl border px-3 py-2 text-left transition-colors ${
                          on ? 'border-poo-600 bg-poo-50' : 'border-poo-200 hover:bg-poo-50/60'
                        }`}
                      >
                        <div className="text-sm font-medium">
                          {s.emoji} {s.label[locale]}
                        </div>
                        <div className="truncate text-[11px] text-ink-faint">{s.hint[locale]}</div>
                      </button>
                    )
                  })}

                  <button
                    type="button"
                    aria-pressed={mode === 'self'}
                    onClick={() => setMode('self')}
                    className={`col-span-2 rounded-xl border border-dashed px-3 py-2 text-left transition-colors ${
                      mode === 'self'
                        ? 'border-poo-600 bg-poo-50'
                        : 'border-poo-300 hover:bg-poo-50/60'
                    }`}
                  >
                    <div className="text-sm font-medium">✍️ {t.modeSelf}</div>
                    <div className="truncate text-[11px] text-ink-faint">{t.selfWriteHint}</div>
                  </button>
                </div>

                <div className="mt-3">
                  {mode === 'self' ? (
                    <>
                      <label htmlFor="selfText" className="mb-1.5 block text-sm font-semibold">
                        {t.selfWriteLabel}
                      </label>
                      <textarea
                        id="selfText"
                        value={selfText}
                        onChange={(e) => setSelfText(e.target.value.slice(0, 600))}
                        placeholder={t.selfWritePlaceholder}
                        rows={5}
                        className="w-full resize-none rounded-xl border border-poo-200 px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-poo-500"
                      />
                      <div className="mt-1.5 text-right text-xs tabular-nums text-ink-faint">
                        {selfText.length}/600
                      </div>
                    </>
                  ) : (
                    <>
                      <label htmlFor="rawNote" className="mb-1.5 block text-sm font-semibold">
                        {t.rawNoteLabel}
                      </label>
                      <textarea
                        id="rawNote"
                        value={rawNote}
                        onChange={(e) => setRawNote(e.target.value.slice(0, 200))}
                        placeholder={t.rawNotePlaceholder}
                        rows={2}
                        className="w-full resize-none rounded-xl border border-poo-200 px-3 py-2 text-sm outline-none focus:border-poo-500"
                      />
                      <div className="mt-1.5 text-right text-xs tabular-nums text-ink-faint">
                        {rawNote.length}/200
                      </div>
                    </>
                  )}
                </div>
              </section>
            </>
          ) : (
            <>
              <section>
                <div className="mb-2 flex items-center justify-between">
                  <h3 className="text-sm font-semibold">{t.stepPreview}</h3>
                  <span className="inline-flex items-center gap-1 rounded-full bg-poo-50 px-2 py-0.5 text-[11px] text-poo-700">
                    <Sparkles size={11} />
                    {t.aiBadge}
                  </span>
                </div>
                <textarea
                  value={draft}
                  onChange={(e) => setDraft(e.target.value.slice(0, 600))}
                  rows={6}
                  className="w-full resize-none rounded-xl border border-poo-200 px-3 py-2.5 text-[15px] leading-relaxed outline-none focus:border-poo-500"
                />
                <p className="mt-1.5 text-xs text-ink-faint">{t.previewHint}</p>
              </section>

              <section className="flex gap-2">
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleGenerate(style)}
                  className="btn btn--ghost flex-1"
                >
                  <Wand2 size={15} />
                  {t.regenerate}
                </button>
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => void handleGenerate(randomStyle())}
                  className="btn btn--ghost flex-1"
                >
                  {t.rerollStyle}
                </button>
              </section>

              <section>
                <label htmlFor="nickname" className="mb-1.5 block text-sm font-semibold">
                  {t.nickname}
                </label>
                <input
                  id="nickname"
                  value={nickname}
                  onChange={(e) => setNickname(e.target.value.slice(0, 24))}
                  placeholder={t.nicknamePlaceholder}
                  className="w-full rounded-xl border border-poo-200 px-3 py-2 text-sm outline-none focus:border-poo-500"
                />
              </section>
            </>
          )}

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
        </div>

        <footer className="border-t border-poo-100 px-4 py-3">
          {phase === 'form' ? (
            mode === 'self' ? (
              // 自己写的不需要"生成 → 预览"那一步，本来就是他写的
              <button
                type="button"
                disabled={busy !== null || !selfText.trim()}
                onClick={() => void handlePublish()}
                className="btn btn--primary w-full"
              >
                {busy === 'publish' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t.publishing}
                  </>
                ) : (
                  t.publish
                )}
              </button>
            ) : (
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void handleGenerate()}
              className="btn btn--primary w-full"
            >
              {busy === 'generate' ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  {t.generating}
                </>
              ) : (
                <>
                  <Sparkles size={16} />
                  {t.generate}
                </>
              )}
            </button>
            )
          ) : (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setPhase('form')}
                className="btn btn--ghost"
                disabled={busy !== null}
              >
                {t.back}
              </button>
              <button
                type="button"
                disabled={busy !== null || !draft.trim()}
                onClick={() => void handlePublish()}
                className="btn btn--primary flex-1"
              >
                {busy === 'publish' ? (
                  <>
                    <Loader2 size={16} className="animate-spin" />
                    {t.publishing}
                  </>
                ) : (
                  t.publish
                )}
              </button>
            </div>
          )}
        </footer>
      </div>
    </div>
  )
}
