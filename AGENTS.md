# AGENTS.md - 厕评 / pooping

Shared project notes for coding agents. Read this before editing, then keep `CLAUDE.md` as the longer product brief.

## Product

厕评 is toilet reviews: nearby restroom discovery plus funny, AI-polished reviews. The moat is the review content being funny enough to screenshot and share; structured restroom data keeps people coming back.

V1 is a PWA for the US first, Portland/Reed College as the initial density target, while keeping the app reachable from China.

## Stack

- Vite + React 18 + TypeScript
- Tailwind CSS
- Supabase Postgres/PostGIS/Auth/Storage/RLS
- MapLibre GL through `src/map/`
- LLM calls only inside Supabase Edge Functions
- pnpm

## Hard Rules

- UI code never imports or calls `supabase.from(...)` directly. All data access goes through `src/api/`, and API functions return `{ data, error }` instead of throwing to UI.
- Components do not call MapLibre directly. All map behavior goes through `src/map/` and `MapView`.
- No external CDN. The only intended external requests are Supabase and map tiles.
- User-facing copy belongs in `src/constants/copy.ts`.
- Database schema changes must be migrations under `supabase/migrations/`.
- Coordinates are WGS-84 in storage and API. GCJ-02 conversion happens only in `src/map/coords.ts`.
- Anonymous auth is the V1 login model. Do not add Google/Apple login.
- AI-generated content must show the AI badge. User-written reviews must not show it.
- AI review flow is fixed: score/tags -> generate -> editable preview -> publish.
- Never implement interior restroom photo capture.

## Current Architecture

- Main map/list screen: `src/pages/MapPage.tsx`
- Detail overlay route: `src/pages/ToiletPage.tsx`
- API modules: `src/api/toilets.ts`, `src/api/reviews.ts`, `src/api/names.ts`, `src/api/reports.ts`
- Map boundary: `src/components/MapView.tsx` plus `src/map/adapter.ts`
- Static first paint data: `scripts/prebuild-static.ts` writes `public/data/bootstrap.json`; app falls back if missing.

## Development

Common checks:

```bash
pnpm typecheck
pnpm build
pnpm check:external
```

If Supabase env vars are missing, static prebuild and database reads should degrade gracefully rather than blocking local UI work.
