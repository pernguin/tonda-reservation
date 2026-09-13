import { timeToMinutes } from './tableAvailability'

export const AXIS_START = 11 * 60   // 11:00
export const AXIS_END = 23 * 60     // 23:00

// Pure: lays out one table's day as percentage segments on a time axis.
// reservations: rows assigned to this table ({ id, reservation_time, status, guest_count, customers? })
// blocks: this table's blocks for the date ({ id, start_time, end_time, reason })
// Returns { axisStart, axisEnd, segments: [{ kind:'reservation'|'block', id, startMin, endMin, left, width, label, status }] }
export function buildTimeline({ reservations = [], blocks = [], holdMinutes = 120 }) {
  const res = reservations
    .map(r => {
      const startMin = timeToMinutes(r.reservation_time)
      return startMin == null ? null : { r, startMin, endMin: startMin + holdMinutes }
    })
    .filter(Boolean)
  const blk = blocks.map(b => ({
    b,
    startMin: timeToMinutes(b.start_time) ?? 0,
    endMin: timeToMinutes(b.end_time) ?? 24 * 60
  }))
  let axisStart = AXIS_START, axisEnd = AXIS_END
  for (const x of res) { axisStart = Math.min(axisStart, x.startMin); axisEnd = Math.max(axisEnd, x.endMin) }
  for (const x of blk) {
    if (x.startMin > 0) axisStart = Math.min(axisStart, x.startMin)
    if (x.endMin < 24 * 60) axisEnd = Math.max(axisEnd, x.endMin)
  }
  const span = axisEnd - axisStart
  const pct = m => Math.max(0, Math.min(100, ((m - axisStart) / span) * 100))
  const segments = [
    ...blk.map(x => ({
      kind: 'block', id: x.b.id, startMin: x.startMin, endMin: x.endMin,
      left: pct(x.startMin), width: pct(x.endMin) - pct(x.startMin),
      label: x.b.reason || 'Blocked', status: 'blocked'
    })),
    ...res.map(x => ({
      kind: 'reservation', id: x.r.id, startMin: x.startMin, endMin: x.endMin,
      left: pct(x.startMin), width: pct(x.endMin) - pct(x.startMin),
      label: `${formatClock(x.startMin)} — ${x.r.customers?.full_name?.split(' ')[0] || '?'} (${x.r.guest_count})`,
      status: x.r.status
    }))
  ].sort((a, b) => a.startMin - b.startMin)
  return { axisStart, axisEnd, segments }
}

export function formatClock(mins) {
  const h = Math.floor(mins / 60), m = mins % 60
  const ampm = h >= 12 ? 'pm' : 'am'
  const hour = h % 12 === 0 ? 12 : h % 12
  return `${hour}:${String(m).padStart(2, '0')}${ampm}`
}
