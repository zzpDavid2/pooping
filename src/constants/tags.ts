import type { Locale } from '@/api/types'
import {
  QUICK_TAG_DEFS,
  TAG_GROUP_LABELS,
  dedupeByGroup,
  tagPhrases as sharedTagPhrases,
  type QuickTagDef,
  type TagGroup,
  type TagTone,
} from '../../supabase/functions/_shared/quick-tags.ts'

/**
 * 快速标签。用户只勾选，不打字（CLAUDE.md 第 4 节）。
 *
 * 定义本体在 supabase/functions/_shared/quick-tags.ts —— 前端和 Edge Function 共用同一份，
 * 免得两边的标签文案各改各的、生成时对不上。这里只做前端侧的取用。
 *
 * 库里存的是 **key**（'no_paper'），不是展示文案：
 * 存了"没纸了"的话英文界面就只能看中文，而且以后改文案会把历史数据一起改乱。
 */

export type { TagTone, TagGroup }
export type QuickTag = QuickTagDef

export const QUICK_TAGS = QUICK_TAG_DEFS
export { TAG_GROUP_LABELS, dedupeByGroup }

/** 互斥组，按定义顺序。UI 里每组渲染成一行单选。 */
export const TAG_GROUPS: { group: TagGroup; tags: QuickTagDef[] }[] = (() => {
  const order: TagGroup[] = []
  const byGroup = new Map<TagGroup, QuickTagDef[]>()

  for (const tag of QUICK_TAG_DEFS) {
    if (!tag.group) continue
    if (!byGroup.has(tag.group)) {
      byGroup.set(tag.group, [])
      order.push(tag.group)
    }
    byGroup.get(tag.group)!.push(tag)
  }
  return order.map((group) => ({ group, tags: byGroup.get(group)! }))
})()

/** 不属于任何互斥组的标签，多选。 */
export const LOOSE_TAGS: QuickTagDef[] = QUICK_TAG_DEFS.filter((t) => !t.group)

/**
 * 「其它」里最多选几个。
 *
 * 互斥组不占名额 —— 它们每组最多贡献 1 个，本来就有上限。
 * 现在是 6 组 + 4 个自由标签 = 最多 10 个，送进模型正好：
 * 再多的话 60–120 字塞不下，模型只会把标签流水账式地列一遍，反而不好笑。
 */
export const LOOSE_TAG_MAX = 4

/** 已选的自由标签数（互斥组的不算）。 */
export function countLooseSelected(keys: string[]): number {
  const loose = new Set(LOOSE_TAGS.map((t) => t.key))
  return keys.filter((k) => loose.has(k)).length
}

/**
 * 勾选逻辑：有 group 的走单选（再点一次取消），没有的走多选。
 * 返回新的 key 数组，不改传入的。
 */
export function toggleTagKey(current: string[], tag: QuickTagDef, max = LOOSE_TAG_MAX): string[] {
  const has = current.includes(tag.key)

  if (tag.group) {
    const siblings = new Set(
      QUICK_TAG_DEFS.filter((t) => t.group === tag.group).map((t) => t.key),
    )
    const without = current.filter((k) => !siblings.has(k))
    return has ? without : [...without, tag.key]
  }

  if (has) return current.filter((k) => k !== tag.key)
  // 只数自由标签，互斥组的不占名额
  return countLooseSelected(current) >= max ? current : [...current, tag.key]
}

const TAG_INDEX = new Map(QUICK_TAG_DEFS.map((t) => [t.key, t]))

export function tagLabel(key: string, locale: Locale): string {
  return TAG_INDEX.get(key)?.label[locale] ?? key
}

export function tagTone(key: string): TagTone {
  return TAG_INDEX.get(key)?.tone ?? 'neutral'
}

/** 给 LLM 的输入：把 key 翻成对应语言的自然短语。 */
export function tagsToPhrases(keys: string[], locale: Locale): string[] {
  return sharedTagPhrases(keys, locale)
}

/** 随机挑几个标签，seed 脚本和"手气不错"用。 */
export function randomTagKeys(count: number): string[] {
  const pool = [...QUICK_TAG_DEFS]
  const picked: string[] = []
  while (picked.length < count && pool.length > 0) {
    const [tag] = pool.splice(Math.floor(Math.random() * pool.length), 1)
    if (tag) picked.push(tag.key)
  }
  return picked
}
