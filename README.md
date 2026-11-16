# PARTY.exe

A retro Windows 95-inspired live party game and leaderboard.

## Stack
- Next.js App Router + TypeScript
- Supabase Postgres + Realtime
- Vercel

## Environment variables
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`

## Supabase
Project ID: `lrocdajsngeokvoivfml`

The database includes player registration, unique player numbers, single-attempt question scoring, an event schedule, and PIN-protected admin RPCs. Never expose a Supabase secret/service-role key in browser code.
