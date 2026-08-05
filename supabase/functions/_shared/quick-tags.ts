/**
 * 快速标签的**唯一定义**。前端（src/constants/tags.ts）和 Edge Function 都从这里读。
 *
 * 放在 supabase/functions/_shared/ 下是为了让 Edge Function 能用相对路径引到它 ——
 * 那边跑的是 Deno，只能 bundle functions 目录内的东西。
 * 这个文件必须保持零依赖、零运行时 API，两个 runtime 都要能直接跑。
 *
 * 库里存的是 key，不是文案。改文案不会动到历史数据；改 key 会，所以 key 定了就别改。
 */

export type TagTone = 'bad' | 'good' | 'neutral'

/**
 * 同一 group 里的标签**互斥**，UI 做成单选。
 *
 * 起因是实测：同时勾上「排大队」和「完全不用等」，模型只能硬凑，
 * 写出来自相矛盾。输入自相矛盾，输出就不好笑，而好笑是这个产品的护城河。
 */
export type TagGroup = 'queue' | 'smell' | 'clean' | 'space' | 'paper' | 'seat'

export interface QuickTagDef {
  key: string
  tone: TagTone
  group?: TagGroup
  label: { zh: string; en: string }
}

export const TAG_GROUP_LABELS: Record<TagGroup, { zh: string; en: string }> = {
  queue: { zh: '排队', en: 'Queue' },
  smell: { zh: '气味', en: 'Smell' },
  clean: { zh: '干净程度', en: 'Cleanliness' },
  space: { zh: '空间', en: 'Space' },
  paper: { zh: '厕纸', en: 'Paper' },
  seat: { zh: '马桶还是蹲坑', en: 'Seated or squat' },
}

export const QUICK_TAG_DEFS: readonly QuickTagDef[] = [
  // ——— 互斥组：每组只能选一个 ———
  { key: 'long_queue', tone: 'bad', group: 'queue', label: { zh: '排大队', en: 'Long line' } },
  { key: 'short_wait', tone: 'neutral', group: 'queue', label: { zh: '等了一会儿', en: 'Short wait' } },
  { key: 'no_wait', tone: 'good', group: 'queue', label: { zh: '完全不用等', en: 'Walked right in' } },

  { key: 'smells_bad', tone: 'bad', group: 'smell', label: { zh: '味道感人', en: 'Smells rough' } },
  { key: 'smoke_smell', tone: 'bad', group: 'smell', label: { zh: '一股烟味', en: 'Reeks of smoke' } },
  { key: 'chemical_smell', tone: 'neutral', group: 'smell', label: { zh: '消毒水味冲', en: 'Heavy bleach smell' } },
  { key: 'no_smell', tone: 'good', group: 'smell', label: { zh: '居然没味', en: 'Somehow odourless' } },

  { key: 'filthy', tone: 'bad', group: 'clean', label: { zh: '脏得下不去脚', en: 'Genuinely filthy' } },
  { key: 'so_so_clean', tone: 'neutral', group: 'clean', label: { zh: '将就能用', en: 'Passable' } },
  { key: 'surprisingly_clean', tone: 'good', group: 'clean', label: { zh: '意外地干净', en: 'Surprisingly clean' } },

  { key: 'tight_stall', tone: 'bad', group: 'space', label: { zh: '隔间转不开身', en: "Can't turn around" } },
  { key: 'spacious', tone: 'good', group: 'space', label: { zh: '空间很大', en: 'Roomy' } },

  { key: 'seated_pan', tone: 'neutral', group: 'seat', label: { zh: '马桶', en: 'Seated' } },
  { key: 'squat_pan', tone: 'neutral', group: 'seat', label: { zh: '蹲坑', en: 'Squat' } },
  { key: 'both_pans', tone: 'neutral', group: 'seat', label: { zh: '两种都有', en: 'Both' } },

  { key: 'no_paper', tone: 'bad', group: 'paper', label: { zh: '没纸了', en: 'Out of paper' } },
  { key: 'paper_outside', tone: 'neutral', group: 'paper', label: { zh: '纸在外面', en: 'Paper is outside the stall' } },
  { key: 'well_stocked', tone: 'good', group: 'paper', label: { zh: '纸管够', en: 'Plenty of paper' } },

  // ——— 多选：设施和观察，互不冲突 ———
  { key: 'bidet', tone: 'good', label: { zh: '有冲洗功能', en: 'Has a bidet' } },
  { key: 'seat_covers', tone: 'good', label: { zh: '有坐垫纸', en: 'Seat covers provided' } },
  { key: 'seat_sanitizer', tone: 'good', label: { zh: '有马桶圈消毒液', en: 'Seat sanitiser dispenser' } },
  { key: 'warm_seat', tone: 'good', label: { zh: '马桶圈是热的', en: 'Heated seat' } },
  { key: 'hot_water', tone: 'good', label: { zh: '洗手有热水', en: 'Hot water at the sink' } },
  { key: 'dryer_works', tone: 'good', label: { zh: '烘手机给力', en: 'Dryer actually works' } },
  { key: 'good_lighting', tone: 'good', label: { zh: '灯光很好', en: 'Great lighting' } },
  { key: 'great_view', tone: 'good', label: { zh: '有窗有景', en: 'Has a view' } },
  { key: 'music_playing', tone: 'neutral', label: { zh: '放着音乐', en: 'Music playing' } },
  { key: 'motion_sensor', tone: 'neutral', label: { zh: '感应式一切', en: 'Everything is sensor-based' } },

  { key: 'no_soap', tone: 'bad', label: { zh: '没洗手液', en: 'No soap' } },
  { key: 'wet_floor', tone: 'bad', label: { zh: '地上有水', en: 'Wet floor' } },
  { key: 'no_hook', tone: 'bad', label: { zh: '没挂钩', en: 'No hook' } },
  { key: 'broken_lock', tone: 'bad', label: { zh: '门锁坏了', en: 'Broken lock' } },
  { key: 'thin_walls', tone: 'bad', label: { zh: '隔音基本没有', en: 'Zero soundproofing' } },
  { key: 'hard_to_find', tone: 'bad', label: { zh: '巨难找', en: 'Hard to find' } },
  { key: 'needs_code', tone: 'bad', label: { zh: '要密码', en: 'Needs a code' } },
  { key: 'queue_for_one', tone: 'bad', label: { zh: '只有一个坑', en: 'Only one stall' } },
]

export const TAG_KEYS: readonly string[] = QUICK_TAG_DEFS.map((t) => t.key)

const INDEX = new Map(QUICK_TAG_DEFS.map((t) => [t.key, t]))

/** 把 key 翻成对应语言的自然短语，给 LLM 当输入。未知 key 直接丢掉，不让它进 prompt。 */
export function tagPhrases(keys: readonly string[], lang: 'zh' | 'en'): string[] {
  return keys.map((k) => INDEX.get(k)?.label[lang]).filter((v): v is string => Boolean(v))
}

/** 同组只留最后选的一个，保证送进模型的描述不自相矛盾。 */
export function dedupeByGroup(keys: readonly string[]): string[] {
  const seenGroup = new Map<string, string>()
  const loose: string[] = []

  for (const key of keys) {
    const def = INDEX.get(key)
    if (!def) continue
    if (def.group) seenGroup.set(def.group, key)
    else if (!loose.includes(key)) loose.push(key)
  }
  return [...seenGroup.values(), ...loose]
}
