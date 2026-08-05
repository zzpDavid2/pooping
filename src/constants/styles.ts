import type { Locale, ReviewStyle } from '@/api/types'

/**
 * 文风是玩法核心（CLAUDE.md 第 4 节）：同一条评价换个文风重生成本身就有可玩性。
 *
 * 英文名不是中文名的直译 —— 「文言文体」直译成 "Classical Chinese" 对英文用户毫无笑点，
 * 要换成英文语境里等价好笑的东西。翻译要翻的是梗，不是字。
 */

export interface StyleMeta {
  key: ReviewStyle
  emoji: string
  label: Record<Locale, string>
  hint: Record<Locale, string>
}

export const STYLE_META: readonly StyleMeta[] = [
  {
    key: 'wenyan',
    emoji: '📜',
    label: { zh: '文言文', en: 'Ye Olde Scroll' },
    hint: { zh: '如厕者众，其味也远', en: 'Thine porcelain throne, chronicled' },
  },
  {
    key: 'xiaohongshu',
    emoji: '💅',
    label: { zh: '小红书', en: 'Influencer Post' },
    hint: { zh: '姐妹们！这个厕所我真的会哭', en: 'bestie this restroom ATE 😭✨' },
  },
  {
    key: 'waimai',
    emoji: '⭐',
    label: { zh: '外卖差评', en: '1-Star Review' },
    hint: { zh: '给差评不是针对谁', en: 'Would give zero stars if I could' },
  },
  {
    key: 'eulogy',
    emoji: '🕯️',
    label: { zh: '悼词', en: 'Eulogy' },
    hint: { zh: '我们在此缅怀这卷纸', en: 'We gather to mourn the paper' },
  },
  {
    key: 'luxun',
    emoji: '🖋️',
    label: { zh: '鲁迅体', en: 'Grim Literary' },
    hint: { zh: '我家门前有两个坑位', en: 'And so the stall stood, indifferent' },
  },
  {
    key: 'documentary',
    emoji: '🎬',
    label: { zh: '纪录片旁白', en: 'Nature Documentary' },
    hint: { zh: '在这里，生存是唯一的法则', en: 'Here, the lone traveller waits...' },
  },
  {
    key: 'michelin',
    emoji: '🎩',
    label: { zh: '米其林指南', en: 'Michelin Guide' },
    hint: { zh: '值得为它绕道前往', en: 'Worth a special journey' },
  },
  {
    key: 'rap',
    emoji: '🎤',
    label: { zh: '说唱', en: 'Rap Verse' },
    hint: { zh: 'yo 这个坑位有点东西', en: 'yo this stall got bars' },
  },
]

const STYLE_INDEX = new Map(STYLE_META.map((s) => [s.key, s]))

export function styleMeta(key: ReviewStyle): StyleMeta | undefined {
  return STYLE_INDEX.get(key)
}

export function styleLabel(key: ReviewStyle, locale: Locale): string {
  return STYLE_INDEX.get(key)?.label[locale] ?? key
}

export function randomStyle(): ReviewStyle {
  const pick = STYLE_META[Math.floor(Math.random() * STYLE_META.length)]!
  return pick.key
}
