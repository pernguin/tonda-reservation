# tonda-reservation

Public booking site for Tonda Pizza Romana (Taman Desa, Kuala Lumpur): table reservations, event and
off-site enquiries, experiences, booking management and feedback pages. Staff use the admin area under `/admin`.

## Stack

React 19, Vite, Tailwind v4, Supabase, Vercel.

## Two Supabase projects

- Tonda's own project holds reservations, tables, slot rules, experiences and settings.
- Round's project holds the shared `customers`, `customer_visits` and `feedback` tables. The app reaches it through
  `src/supabaseCustomers.js`. See `CLAUDE.md` for the details and the architecture invariants.

## Run locally

1. `npm install`
2. Create `.env.local` with `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `VITE_ROUND_SUPABASE_URL` and
   `VITE_ROUND_SUPABASE_ANON_KEY`.
3. `npm run dev`

## Scripts

- `npm run dev` starts the Vite dev server.
- `npm run build` builds for production into `dist/`.
- `npm run preview` serves the production build locally.
- `npm run lint` runs ESLint.
- `npm test` runs the Vitest suite.

## Routes

Public: `/`, `/reservations`, `/events`, `/offsite`, `/experiences/:id`, `/booking/:id`, `/feedback`.

Admin: `/admin/login`, `/admin`, `/admin/tables`, `/admin/bookings`, `/admin/slot-rules`, `/admin/customers`,
`/admin/feedback`, `/admin/settings`, `/admin/experiences`.

## Database and functions

Migrations live in `supabase/migrations` and are applied by the owner with `supabase db push`. Edge functions live in
`supabase/functions`: `send-confirmation-email`, `send-thankyou-email`, `send-reminder-email` and
`notify-staff-reservation`.

## Build packages

Work is planned and tracked as one brief per package in `docs/build/`.

## Re-seeding `public_holidays`

`public.public_holidays` is currently **not consulted** — the `get_availability` override and the
client fetch were disabled on 2026-09-18 so public holidays behave as normal days (see
`docs/superpowers/specs/2026-09-18-ops-tweaks-port-design.md` §3 to restore). It is not auto-populated: it must be re-seeded once a
year with Malaysian national holiday dates. The original plan was to source these
from `https://date.nager.at/api/v3/PublicHolidays/<year>/MY`, but as of 2026-09-17
that API does not cover Malaysia (`AvailableCountries` has no `MY` entry, and
`PublicHolidays/<year>/MY` returns `204 No Content` for every year tried). Until a
working source is picked, insert rows by hand each December for the coming year,
e.g. `insert into public_holidays (holiday_date, name) values ('2028-01-01', 'New
Year''s Day') on conflict do nothing;`, using the official Malaysian public holiday
gazette (or a source confirmed to actually list MY) as the reference.
