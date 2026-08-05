import type { Locale, Review } from '@/api/types'
import { styleLabel, styleMeta } from '@/constants/styles'
import { tagLabel, tagTone } from '@/constants/tags'

/**
 * 分享卡片（CLAUDE.md 8.4）。
 *
 * 传播单元是**截图**，不是链接：未备案域名在微信里随时被拦，且没有申诉渠道。
 * 所以这张图必须自己讲完整个故事 —— 一屏放得下、字大、印着 pooping.me、不放二维码
 * （二维码扫出来还是跳链接，一样被拦）。
 *
 * 全程 canvas 本地绘制，不发任何请求。字体用系统栈，和界面保持一致。
 */

const W = 1080
const H = 1350
const PAD = 88

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", "Noto Sans CJK SC", sans-serif'

const EMOJI_FONT = '"Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji", sans-serif'
const BRAND_EMOJI = '💩'

export interface ShareCardInput {
  review: Review
  toiletName: string
  locale: Locale
}

/**
 * 按可视宽度断行。中日韩逐字断，拉丁按词断 —— 两套规则必须同时支持，
 * 否则中文会一行拉到天边，英文会把单词劈成两半。
 */
function wrapText(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const lines: string[] = []

  for (const paragraph of text.split('\n')) {
    // 把连续拉丁/数字聚成一个 token，其余（含 CJK、标点）各自成 token
    const tokens = paragraph.match(/[A-Za-z0-9'’\-.]+|\s+|[^\s]/g) ?? []
    let line = ''

    for (const token of tokens) {
      const candidate = line + token
      if (ctx.measureText(candidate).width <= maxWidth || line === '') {
        line = candidate
        continue
      }
      lines.push(line.trimEnd())
      line = token.trimStart()
    }
    lines.push(line.trimEnd())
  }

  return lines.filter((l, i, arr) => l !== '' || i < arr.length - 1)
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

export function renderShareCard(input: ShareCardInput): string | null {
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')
  if (!ctx) return null

  const { review, toiletName, locale } = input

  // 背景
  ctx.fillStyle = '#fdf8f3'
  ctx.fillRect(0, 0, W, H)

  // 顶部色带，给截图一个强辨识度的边
  ctx.fillStyle = '#c07540'
  ctx.fillRect(0, 0, W, 18)

  let y = PAD + 40

  // 品牌
  // 左上角的 💩，和界面顶栏保持一致，也让截图一眼认得出是谁家的
  ctx.font = `44px ${EMOJI_FONT}`
  ctx.textBaseline = 'alphabetic'
  const emojiW = ctx.measureText(BRAND_EMOJI).width
  ctx.fillText(BRAND_EMOJI, PAD, y)

  const brandX = PAD + emojiW + 16
  const brand = locale === 'zh' ? '厕评' : 'pooping'
  const tagline = locale === 'zh' ? '厕所版大众点评' : 'Yelp, but for toilets'

  ctx.font = `700 46px ${FONT_STACK}`
  ctx.textBaseline = 'alphabetic'
  // 必须在 46px 字体还生效时量宽度。换成 26px 再量，得到的是小字号下的宽度，
  // 副标题会直接压到 logo 上（英文下 "Yelp," 整个被盖住）。
  const brandWidth = ctx.measureText(brand).width

  ctx.fillStyle = '#c07540'
  ctx.fillText(brand, brandX, y)

  ctx.fillStyle = '#a8a29e'
  ctx.font = `500 26px ${FONT_STACK}`
  ctx.fillText(tagline, brandX + brandWidth + 24, y)

  y += 76

  // 地点名
  ctx.fillStyle = '#1c1917'
  ctx.font = `700 54px ${FONT_STACK}`
  const nameLines = wrapText(ctx, toiletName, W - PAD * 2).slice(0, 2)
  for (const line of nameLines) {
    ctx.fillText(line, PAD, y)
    y += 68
  }

  y += 26

  // 文风标签。手写评价没有文风，改画一个「本人手写」的标，不冒充 AI 作品
  const meta = review.isAi && review.aiStyle ? styleMeta(review.aiStyle) : null
  const chipText = meta
    ? `${meta.emoji} ${styleLabel(review.aiStyle!, locale)}`
    : locale === 'zh'
      ? '✍️ 本人手写'
      : '✍️ Hand-written'

  ctx.font = `600 30px ${FONT_STACK}`
  const chipW = ctx.measureText(chipText).width + 48
  ctx.fillStyle = '#f7ead9'
  roundRect(ctx, PAD, y - 42, chipW, 60, 30)
  ctx.fill()
  ctx.fillStyle = '#84472c'
  ctx.fillText(chipText, PAD + 24, y)

  y += 84

  // 正文 —— 这是整张图的主角，字号给到最大
  ctx.fillStyle = '#1c1917'
  ctx.font = `500 46px ${FONT_STACK}`
  const bodyLines = wrapText(ctx, review.aiText, W - PAD * 2)
  // 给下面的评分和标签留出位置，正文行数相应收紧
  const maxLines = 9
  const shown = bodyLines.slice(0, maxLines)
  if (bodyLines.length > maxLines) {
    shown[maxLines - 1] = `${shown[maxLines - 1]?.slice(0, -1) ?? ''}…`
  }
  for (const line of shown) {
    ctx.fillText(line, PAD, y)
    y += 70
  }

  const footerY = H - PAD

  // —— 评分。截图要能独立成立：光有段子没有分数，读的人不知道这地方到底行不行
  y += 24
  const ratings: [string, number | null][] = [
    [locale === 'zh' ? '干净' : 'Clean', review.clean],
    [locale === 'zh' ? '气味' : 'Smell', review.smell],
    [locale === 'zh' ? '不用排' : 'No wait', review.queue],
    [locale === 'zh' ? '私密' : 'Privacy', review.privacy],
  ]
  const present = ratings.filter((r): r is [string, number] => r[1] !== null)

  if (present.length > 0 && y < footerY - 150) {
    const colW = (W - PAD * 2) / present.length
    present.forEach(([label, value], i) => {
      const cx = PAD + colW * i

      ctx.fillStyle = '#a8a29e'
      ctx.font = `500 26px ${FONT_STACK}`
      ctx.fillText(label, cx, y)

      ctx.fillStyle = value >= 4 ? '#10b981' : value >= 3 ? '#d1915a' : '#e11d48'
      ctx.font = `800 46px ${FONT_STACK}`
      ctx.fillText(`${value}`, cx, y + 48)

      ctx.fillStyle = '#d6d3d1'
      ctx.font = `600 26px ${FONT_STACK}`
      ctx.fillText('/5', cx + ctx.measureText(`${value}`).width + 26, y + 48)
    })
    y += 92
  }

  // —— 标签胶囊。换行排布，放不下就停，绝不压到页脚上
  if (review.quickTags.length > 0) {
    y += 26
    ctx.font = `500 28px ${FONT_STACK}`
    let x = PAD

    for (const key of review.quickTags) {
      const text = tagLabel(key, locale)
      const chipW = ctx.measureText(text).width + 36

      if (x + chipW > W - PAD) {
        x = PAD
        y += 62
      }
      if (y > footerY - 110) break

      const tone = tagTone(key)
      ctx.fillStyle =
        tone === 'bad' ? '#ffe4e6' : tone === 'good' ? '#d1fae5' : '#f7ead9'
      roundRect(ctx, x, y - 34, chipW, 50, 25)
      ctx.fill()

      ctx.fillStyle = tone === 'bad' ? '#9f1239' : tone === 'good' ? '#065f46' : '#84472c'
      ctx.font = `500 28px ${FONT_STACK}`
      ctx.fillText(text, x + 18, y)

      x += chipW + 12
    }
  }

  // 底部：AI 标识（10.2 要求可见）+ 域名文字。不放二维码。

  ctx.fillStyle = '#a8a29e'
  ctx.font = `500 28px ${FONT_STACK}`
  const footerNote = review.isAi
    ? locale === 'zh'
      ? 'AI 润色 · 内容仅供一乐'
      : 'AI-polished · for laughs'
    : locale === 'zh'
      ? '本人手写 · 内容仅供一乐'
      : 'Hand-written · for laughs'
  ctx.fillText(footerNote, PAD, footerY - 56)

  ctx.fillStyle = '#c07540'
  ctx.font = `800 44px ${FONT_STACK}`
  ctx.fillText('pooping.me', PAD, footerY)

  return canvas.toDataURL('image/png')
}

export function downloadDataUrl(dataUrl: string, filename: string): void {
  const a = document.createElement('a')
  a.href = dataUrl
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
}
