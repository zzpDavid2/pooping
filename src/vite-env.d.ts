/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL?: string
  readonly VITE_SUPABASE_ANON_KEY?: string

  /** 'cn' | 'intl'。不设则按时区/语言猜，见 src/map/region.ts */
  readonly VITE_DEFAULT_REGION?: string
  /** 'zh' | 'en'。不设则跟浏览器语言 */
  readonly VITE_DEFAULT_LOCALE?: string

  /** 高德瓦片地址覆盖，留空用内置的 webrd 子域轮询 */
  readonly VITE_AMAP_TILE_URL?: string
  /** 海外栅格瓦片模板，形如 https://.../{z}/{x}/{y}.png */
  readonly VITE_TILE_URL_INTL?: string
  readonly VITE_TILE_ATTRIBUTION?: string
  readonly VITE_MAPTILER_KEY?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
