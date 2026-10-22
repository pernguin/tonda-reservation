# 12 — Booking success page matches the booking's status (Round + Tonda)

After a guest books, `src/pages/Reservations.jsx` shows a fixed "Request Received" heading and the
Settings text `confirmation_message_reservation`, whatever the booking's status. Tonda's Settings text
says "Your booking has been confirmed" (wrong for pending 9+ bookings); Round's says "Our team will
contact you shortly to confirm" (wrong for auto-confirmed bookings). Since package 11 a pending guest
gets a "Confirmed" email when staff approve, so the page should say what will happen. After this
package the heading and text follow the status returned by `create_reservation_atomic` (both sites
return the `reservations` row, so `booking.status` is already in hand). **Client-only: no migration,
no edge function.**

Shared spec, built with `perng-harness:parallel-port`. Round first, then Tonda.
Brainstormed: 2026-10-22. Behaviour and divergences approved by Perng 2026-10-22.
Branch in both repos: `build/12-status-aware-booking-success`.

## Per-site divergences (approved 2026-10-22)

| | Round | Tonda |
|---|---|---|
| Heading style | keep Round's existing `<h2>` classes/style | keep Tonda's existing `<h2>` classes/style (incl. `fontStyle: 'var(--font-heading-style)'`) |
| When a booking is pending | 9–10 guests with the long table free | 9+ guests with the big table free |
| Live Settings text | pending wording; **Perng rewrites it after merge** (not part of the build) | already confirmed wording; unchanged |
| Weekdays / Grab / holidays / menus | not relevant | not relevant |

Anything else that differs between the two implementations is a parity bug.

## Identical on both sites

### Helper `src/lib/bookingSuccessCopy.js`

```js
export const PENDING_HEADING = 'Request Received'
export const PENDING_MESSAGE = "Thank you for your reservation request. Our team will review it and email you once your booking is confirmed."
export const CONFIRMED_HEADING = 'Booking Confirmed'
export const CONFIRMED_FALLBACK = 'Your booking is confirmed. We look forward to welcoming you.'

// status: the status create_reservation_atomic returned. settingsMessage: confirmation_message_reservation or null.
export function bookingSuccessCopy(status, settingsMessage) -> { heading, message }
```

- `status === 'pending'` → `{ PENDING_HEADING, PENDING_MESSAGE }` (Settings text ignored).
- anything else → `{ CONFIRMED_HEADING, settingsMessage?.trim() ? settingsMessage : CONFIRMED_FALLBACK }`.

Vitest `src/lib/bookingSuccessCopy.test.js`: pending ignores settings text; confirmed uses settings
text; confirmed with null / empty / whitespace settings uses the fallback.

### `src/pages/Reservations.jsx` (reservation flow only)

- Store the returned status alongside the booking id (e.g. `setBookingStatus(booking.status)`).
- Keep fetching `confirmation_message_reservation` as today, but hold the raw value (null when unset)
  rather than overwriting a pending-worded default; drop the now-unused default string.
- Render `heading` and `message` from `bookingSuccessCopy(bookingStatus, settingsMessage)` in place of
  the hard-coded "Request Received" and `{confirmationMessage}`. Styling, the time range, the manage-link
  box and everything else on the success screen stay as they are.
- The message keeps its line breaks if the existing markup already does; do not add new formatting.
- Events and Off-site pages: untouched.

### `src/pages/admin/Settings.jsx`

Only the hint line under the reservation message: change
"Shown to customers after submitting a reservation request. Available placeholders: {name}, {date},
{time}, {guests}" to "Shown to customers whose booking is confirmed straight away. Bookings that need
approval show a fixed 'we'll confirm by email' message instead." (The placeholders were never
substituted anywhere in the code, so the hint stops advertising them.) Nothing else in Settings changes.

## Gates (each repo)

`npm test`, `npm run build` green; `npm run lint` no new problems against the CLAUDE.md baseline;
invariant greps clean. `npm run test:sql` is unaffected (no SQL) but must still pass.

## Rollout (Perng)

Merge both (Vercel deploys). Then on **Round** Admin → Settings, rewrite the reservation message for
confirmed bookings, e.g. "Thank you for your reservation. Your booking is confirmed and we look forward
to seeing you." Tonda's text needs no change.
