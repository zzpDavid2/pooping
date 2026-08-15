import { useState } from 'react'
import { Loader2, Search } from 'lucide-react'

import { searchAddress, type GeocodeResult, type LatLng } from '@/api'
import { useI18n } from '@/i18n/useI18n'
import type { Region } from '@/map/region'

interface AddressSearchBoxProps {
  region: Region
  /** 当前地图中心，WGS-84。给搜索结果排序用——同名地点全国到处都是。 */
  near: LatLng | null
  onPick: (result: GeocodeResult) => void
  className?: string
}

/**
 * 输入框 + 结果列表，"搜地名定位"这个动作的唯一实现。
 * 报新厕所的选点步骤、主界面找厕所都用它，行为和文案只写一份。
 */
export default function AddressSearchBox({ region, near, onPick, className }: AddressSearchBoxProps) {
  const { t } = useI18n()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<GeocodeResult[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSearch() {
    const trimmed = query.trim()
    if (!trimmed) return

    setBusy(true)
    setError(null)
    const res = await searchAddress(trimmed, region, near)
    setBusy(false)

    if (res.error) {
      setError(t.addressSearchFailed)
      return
    }
    setResults(res.data)
    if (res.data.length === 0) setError(t.addressSearchEmpty)
  }

  function handlePick(result: GeocodeResult) {
    onPick(result)
    setResults([])
    setQuery(result.label)
  }

  return (
    <div className={className}>
      <div className="flex gap-2">
        <input
          id="addressSearchInput"
          name="addressSearchInput"
          autoComplete="off"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void handleSearch()
            }
          }}
          placeholder={t.addressSearchPlaceholder}
          className="flex-1 rounded-xl border border-poo-200 bg-white px-3 py-2 text-sm outline-none focus:border-poo-500"
        />
        <button
          type="button"
          onClick={() => void handleSearch()}
          disabled={busy || !query.trim()}
          aria-label={t.addressSearchButton}
          className="btn btn--ghost bg-white px-3"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="mt-2 max-h-40 divide-y divide-poo-100 overflow-y-auto rounded-xl border border-poo-100 bg-white shadow-lg">
          {results.map((r, i) => (
            <li key={`${r.lat},${r.lng},${i}`}>
              <button
                type="button"
                onClick={() => handlePick(r)}
                className="block w-full px-3 py-2 text-left text-sm hover:bg-poo-50"
              >
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && (
        <p className="mt-2 rounded-xl bg-white px-3 py-1.5 text-center text-xs text-rose-600 shadow-sm">
          {error}
        </p>
      )}
    </div>
  )
}
