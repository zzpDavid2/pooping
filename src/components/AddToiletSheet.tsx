import { useState } from 'react'
import { Loader2, MapPin, X } from 'lucide-react'

import { createToilet, type Category, type LatLng } from '@/api'
import { useI18n } from '@/i18n/useI18n'

interface AddToiletSheetProps {
  /** 十字准星当前对准的位置，WGS-84（已由地图适配器转回来） */
  location: LatLng
  onCancel: () => void
  onCreated: (id: string) => void
  onRetakeLocation: () => void
}

/**
 * 报新厕所的表单。位置在上一步用地图中心的十字准星选好了。
 *
 * 只问三件事：叫什么、什么场所、地址（可选）。
 * 设施细节故意不问 —— 那些应该由后来的人用评价补上，
 * 一上来就是十几个开关，没人会填完。
 */
export default function AddToiletSheet({
  location,
  onCancel,
  onCreated,
  onRetakeLocation,
}: AddToiletSheetProps) {
  const { t } = useI18n()

  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [category, setCategory] = useState<Category>('public')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const categories: { key: Category; label: string }[] = [
    { key: 'public', label: t.catPublic },
    { key: 'mall', label: t.catMall },
    { key: 'restaurant', label: t.catRestaurant },
    { key: 'transit', label: t.catTransit },
    { key: 'campus', label: t.catCampus },
    { key: 'office', label: t.catOffice },
    { key: 'park', label: t.catPark },
    { key: 'other', label: t.catOther },
  ]

  async function submit() {
    if (!name.trim()) {
      setError(t.addNeedName)
      return
    }
    setBusy(true)
    setError(null)

    const res = await createToilet({
      ...location,
      name,
      address,
      category,
    })
    setBusy(false)

    if (res.error) {
      setError(res.error.code === 'rate_limited' ? t.addTooFast : t.addFailed)
      return
    }
    onCreated(res.data)
  }

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/40 animate-fade-in sm:items-center">
      <div className="safe-bottom flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl bg-white animate-slide-up sm:rounded-2xl">
        <header className="flex items-center justify-between border-b border-poo-100 px-4 py-3">
          <h2 className="font-semibold">{t.addToiletTitle}</h2>
          <button type="button" onClick={onCancel} className="rounded-lg p-1 text-ink-faint">
            <X size={20} />
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-4 py-4">
          <button
            type="button"
            onClick={onRetakeLocation}
            className="flex w-full items-center gap-2 rounded-xl border border-poo-200 bg-poo-50 px-3 py-2.5 text-left"
          >
            <MapPin size={16} className="shrink-0 text-poo-700" />
            <span className="flex-1 text-xs tabular-nums text-ink-soft">
              {location.lat.toFixed(5)}, {location.lng.toFixed(5)}
            </span>
            <span className="text-xs font-medium text-poo-700">{t.pinRetake}</span>
          </button>

          <div>
            <label htmlFor="toiletName" className="mb-1.5 block text-sm font-semibold">
              {t.addName}
            </label>
            <input
              id="toiletName"
              value={name}
              onChange={(e) => setName(e.target.value.slice(0, 80))}
              placeholder={t.addNamePlaceholder}
              className="w-full rounded-xl border border-poo-200 px-3 py-2 text-sm outline-none focus:border-poo-500"
            />
          </div>

          <div>
            <p className="mb-1.5 text-sm font-semibold">{t.addCategory}</p>
            <div className="flex flex-wrap gap-1.5">
              {categories.map(({ key, label }) => (
                <button
                  key={key}
                  type="button"
                  aria-pressed={category === key}
                  onClick={() => setCategory(key)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    category === key
                      ? 'border-poo-600 bg-poo-600 text-white'
                      : 'border-poo-200 bg-white text-ink-soft'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label htmlFor="toiletAddress" className="mb-1.5 block text-sm font-semibold">
              {t.addAddress}
            </label>
            <input
              id="toiletAddress"
              value={address}
              onChange={(e) => setAddress(e.target.value.slice(0, 120))}
              placeholder={t.addAddressPlaceholder}
              className="w-full rounded-xl border border-poo-200 px-3 py-2 text-sm outline-none focus:border-poo-500"
            />
          </div>

          {error && (
            <p className="rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          )}
        </div>

        <footer className="border-t border-poo-100 px-4 py-3">
          <button
            type="button"
            disabled={busy || !name.trim()}
            onClick={() => void submit()}
            className="btn btn--primary w-full"
          >
            {busy ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                {t.addSubmitting}
              </>
            ) : (
              t.addSubmit
            )}
          </button>
        </footer>
      </div>
    </div>
  )
}
