/**
 * Copy local Supabase public data to a remote Supabase project.
 *
 * Usage:
 *   REMOTE_SUPABASE_URL=https://xxx.supabase.co \
 *   REMOTE_SUPABASE_SERVICE_ROLE_KEY=... \
 *   pnpm push:local-data
 *
 * By default this copies toilets and name proposals. Reviews are skipped because
 * their user_id references local auth.users, which does not exist remotely.
 */

import './env.ts'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const LOCAL_URL = process.env.LOCAL_SUPABASE_URL ?? 'http://127.0.0.1:54321'
const LOCAL_SERVICE_ROLE_KEY =
  process.env.LOCAL_SUPABASE_SERVICE_ROLE_KEY ??
  process.env.SUPABASE_SERVICE_ROLE_KEY

const REMOTE_URL = process.env.REMOTE_SUPABASE_URL
const REMOTE_SERVICE_ROLE_KEY = process.env.REMOTE_SUPABASE_SERVICE_ROLE_KEY

const PAGE_SIZE = 500

type Row = Record<string, unknown>

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`Missing ${name}`)
  return value
}

function client(url: string, key: string): SupabaseClient {
  return createClient(url, key, { auth: { persistSession: false } })
}

async function readAll<T extends Row>(
  supabase: SupabaseClient,
  table: string,
  columns = '*',
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .range(from, to)

    if (error) throw new Error(`${table}: ${error.message}`)
    const rows = (data ?? []) as unknown as T[]
    out.push(...rows)
    if (rows.length < PAGE_SIZE) return out
  }
}

async function upsertChunks(
  supabase: SupabaseClient,
  table: string,
  rows: Row[],
  onConflict?: string,
  select?: string,
): Promise<Row[]> {
  const out: Row[] = []
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const chunk = rows.slice(i, i + PAGE_SIZE)
    const query = supabase.from(table).upsert(chunk, onConflict ? { onConflict } : undefined)
    const { data, error } = select ? await query.select(select) : await query

    if (error) throw new Error(`${table}: ${error.message}`)
    if (data) out.push(...(data as unknown as Row[]))
    console.log(`  ${table}: ${Math.min(i + chunk.length, rows.length)}/${rows.length}`)
  }
  return out
}

/**
 * 聚合字段不跟着搬：它们由远端自己的评价算出来，本地的数字搬过去只会覆盖成错的。
 * created_by 指向本地 auth.users，远端没有这些用户，只能置空。
 */
function prepareToilet(row: Row): Row {
  return {
    ...row,
    created_by: null,
    review_count: 0,
    avg_clean: null,
    avg_queue: null,
    avg_smell: null,
    avg_privacy: null,
    funny_up: 0,
    funny_down: 0,
    funny_score: 0,
  }
}

/**
 * OSM 点位在远端可能已经存在（之前导入过），但 id 不一样、osm_id 一样。
 * 必须按 osm_id 判重，而且**不能带上本地 id** —— 覆盖远端 id 会把已经挂在
 * 那个 id 上的评价、密码全部变成孤儿。
 */
function stripId(row: Row): Row {
  const { id: _id, ...rest } = row
  return rest
}

function stripNullableOwner(row: Row): Row {
  return { ...row, created_by: null }
}

async function main(): Promise<void> {
  const local = client(LOCAL_URL, required('LOCAL_SUPABASE_SERVICE_ROLE_KEY', LOCAL_SERVICE_ROLE_KEY))
  const remote = client(
    required('REMOTE_SUPABASE_URL', REMOTE_URL),
    required('REMOTE_SUPABASE_SERVICE_ROLE_KEY', REMOTE_SERVICE_ROLE_KEY),
  )

  console.log(`Copying from ${LOCAL_URL} to ${REMOTE_URL}`)

  const toilets = await readAll<Row>(local, 'toilets')
  console.log(`toilets: ${toilets.length}`)

  // OSM 点位和用户自己报的点位判重方式不一样：
  // 前者认 osm_id（远端可能已经导过同一批），后者只有 id 能认。
  const osmToilets = toilets.filter((t) => t.osm_id !== null && t.osm_id !== undefined)
  const ugcToilets = toilets.filter((t) => t.osm_id === null || t.osm_id === undefined)

  /** 本地 id → 远端 id。OSM 点位在远端可能是另一个 id，后面的外键都要走这张表翻译。 */
  const idMap = new Map<string, string>()

  if (osmToilets.length > 0) {
    console.log(`  osm: ${osmToilets.length}`)
    const saved = await upsertChunks(
      remote,
      'toilets',
      osmToilets.map((t) => stripId(prepareToilet(t))),
      'osm_id',
      'id,osm_id',
    )
    const remoteByOsmId = new Map(saved.map((r) => [String(r.osm_id), String(r.id)]))
    for (const t of osmToilets) {
      const remoteId = remoteByOsmId.get(String(t.osm_id))
      if (remoteId) idMap.set(String(t.id), remoteId)
    }
  }

  if (ugcToilets.length > 0) {
    console.log(`  ugc: ${ugcToilets.length}`)
    await upsertChunks(remote, 'toilets', ugcToilets.map(prepareToilet))
    for (const t of ugcToilets) idMap.set(String(t.id), String(t.id))
  }

  const proposals = await readAll<Row>(local, 'toilet_name_proposals')
  // 翻译成远端 id；翻译不出来的（理论上不该有）直接跳过，别写坏数据
  const remappedProposals: Row[] = []
  for (const p of proposals) {
    const remoteId = idMap.get(String(p.toilet_id))
    if (remoteId) remappedProposals.push({ ...stripNullableOwner(p), toilet_id: remoteId })
  }

  console.log(`toilet_name_proposals: ${remappedProposals.length}`)
  await upsertChunks(remote, 'toilet_name_proposals', remappedProposals, 'toilet_id,name')

  console.log('Refreshing voted names on remote')
  for (const remoteId of new Set(idMap.values())) {
    const { error } = await remote.rpc('refresh_voted_name', { p_toilet_id: remoteId })
    if (error) throw new Error(`refresh_voted_name ${remoteId}: ${error.message}`)
  }

  console.log('\nDone. Reviews and votes were not copied; run pnpm seed:reviews against remote if needed.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
