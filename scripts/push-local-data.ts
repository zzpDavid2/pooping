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
): Promise<void> {
  for (let i = 0; i < rows.length; i += PAGE_SIZE) {
    const chunk = rows.slice(i, i + PAGE_SIZE)
    const { error } = await supabase
      .from(table)
      .upsert(chunk, onConflict ? { onConflict } : undefined)

    if (error) throw new Error(`${table}: ${error.message}`)
    console.log(`  ${table}: ${Math.min(i + chunk.length, rows.length)}/${rows.length}`)
  }
}

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
  await upsertChunks(remote, 'toilets', toilets.map(prepareToilet))

  const proposals = await readAll<Row>(local, 'toilet_name_proposals')
  console.log(`toilet_name_proposals: ${proposals.length}`)
  await upsertChunks(
    remote,
    'toilet_name_proposals',
    proposals.map(stripNullableOwner),
    'toilet_id,name',
  )

  console.log('Refreshing voted names on remote')
  for (const toilet of toilets) {
    const { error } = await remote.rpc('refresh_voted_name', { p_toilet_id: toilet.id })
    if (error) throw new Error(`refresh_voted_name ${String(toilet.id)}: ${error.message}`)
  }

  console.log('\nDone. Reviews and votes were not copied; run pnpm seed:reviews against remote if needed.')
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
