/**
 * 地图外观的可调参数。**想调点位大小、颜色、emoji，只改这个文件。**
 *
 * ─────────────────────────────────────────────────────────────────
 * 怎么调（改完存盘，dev server 会热更新，不用重启）
 * ─────────────────────────────────────────────────────────────────
 *
 * 「点太小/ 太大」
 *   → 改 PIN.bare.radius 和 PIN.rated.radius。
 *     那是个 [zoom, 半径px] 的对照表，MapLibre 在这些档位之间线性插值。
 *     例：把 16 那档的 6 改成 9，中等缩放下的点就明显变大。
 *     只想整体放大而不改手感，把三档乘同一个系数就行。
 *
 * 「远看太密 / 太挤」
 *   → 把小 zoom（12）那档调小，大 zoom（19）那档保持。
 *
 * 「点不好戳中」
 *   → 调 PIN.hitSlopPx。它不影响外观，只放大点击判定范围。
 *     手机上 44px 是公认的最小可点尺寸，别低于 10。
 *
 * 「选中的样子不明显」
 *   → SELECTED.emoji 换个字符，SELECTED.sizePx 调大小，
 *     SELECTED.haloWidth 调外圈粗细。
 *
 * 「颜色不对」
 *   → COLORS 里改。和 tailwind.config.js 里的 poo 色阶是对应的，
 *     两边最好一起改，否则地图和界面会脱节。
 *
 * ─────────────────────────────────────────────────────────────────
 * 注意
 * ─────────────────────────────────────────────────────────────────
 * radius 表里的 zoom 必须**从小到大**排列，MapLibre 会因为乱序直接报错。
 */

export const COLORS = {
  /** 还没有评价的点 —— 浅色，退到背景里 */
  bare: '#c99a6a',
  /** 有评价的点 —— 深色，是"这儿有内容"的信号 */
  rated: '#a45c33',
  /** 选中点的外圈光晕 */
  selectedHalo: 'rgba(192,117,64,0.5)',
  /** 所有点的白描边，让点从底图里跳出来 */
  stroke: '#ffffff',
  userDot: '#3b82f6',
  userHalo: 'rgba(59,130,246,0.22)',
} as const

export const PIN = {
  /**
   * [zoom, 半径px]。之前 bare 在 zoom16 只有 5px，实测太小、看不见也戳不中，
   * 这里整体放大了一档。
   */
  bare: {
    radius: [
      [12, 4],
      [16, 8],
      [19, 11],
    ] as [number, number][],
    strokeWidth: 1.5,
  },
  rated: {
    radius: [
      [12, 6],
      [16, 11],
      [19, 15],
    ] as [number, number][],
    strokeWidth: 2.5,
  },
  /** 只放大点击判定，不影响外观。手指戳不中时加大这个。 */
  hitSlopPx: 12,
} as const

export const SELECTED = {
  /** 选中的点上盖一个 emoji。换成 '💩' / '📍' 都行，一个字符即可。 */
  emoji: '🚽',
  /** emoji 绘制尺寸（CSS px）。太大会盖住周围的点。 */
  sizePx: 30,
  /** emoji 底下的圆底半径，让它在杂乱底图上也看得清 */
  discRadius: 20,
  discColor: '#ffffff',
  haloWidth: 4,
} as const

export const USER_DOT = {
  radius: 6,
  haloRadius: 14,
  strokeWidth: 2.5,
} as const

/**
 * 生成 circle-radius 表达式：一条 interpolate，每档的值再按"有没有评价"分叉。
 *
 * 结构不能反过来写成 `case(条件, interpolate, interpolate)` ——
 * MapLibre 规定一个表达式里只能有**一个** zoom 相关的 interpolate/step，
 * 嵌两个会直接报 "Only one zoom-based subexpression may be used"，
 * 整个图层加不上，地图上一个点都不显示。
 *
 * 所以 bare 和 rated 两张表必须用**相同的 zoom 档位**，这里按 rated 的档位对齐取值。
 */
export function radiusExpression(
  bare: [number, number][],
  rated: [number, number][],
) {
  const stops = rated.flatMap(([zoom, ratedR], i) => {
    const bareR = bare[i]?.[1] ?? ratedR
    return [zoom, ['case', ['==', ['get', 'rated'], 1], ratedR, bareR]]
  })
  return ['interpolate', ['linear'], ['zoom'], ...stops]
}
