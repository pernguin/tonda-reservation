# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.

## Re-seeding `public_holidays`

`public.public_holidays` overrides a date's `day_type` to `'public_holiday'` inside
`get_availability` (and should eventually replace the client's own fetch in
`src/pages/Reservations.jsx`). It is not auto-populated: it must be re-seeded once a
year with Malaysian national holiday dates. The original plan was to source these
from `https://date.nager.at/api/v3/PublicHolidays/<year>/MY`, but as of 2026-09-17
that API does not cover Malaysia (`AvailableCountries` has no `MY` entry, and
`PublicHolidays/<year>/MY` returns `204 No Content` for every year tried). Until a
working source is picked, insert rows by hand each December for the coming year,
e.g. `insert into public_holidays (holiday_date, name) values ('2028-01-01', 'New
Year''s Day') on conflict do nothing;`, using the official Malaysian public holiday
gazette (or a source confirmed to actually list MY) as the reference.
