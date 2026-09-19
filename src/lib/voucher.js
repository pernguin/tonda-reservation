export function voucherExpiry(now = new Date()) { const d = new Date(now); d.setMonth(d.getMonth() + 1); return d.toISOString() }
