const KL_TZ = "Asia/Kuala_Lumpur";
const DAY_MS = 24 * 60 * 60 * 1000;

export function klDateString(d: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: KL_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).formatToParts(d).map((p) => [p.type, p.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function reminderDayWord(reservationDate: string, now: Date): string {
  if (reservationDate === klDateString(now)) return "today";
  if (reservationDate === klDateString(new Date(now.getTime() + DAY_MS))) return "tomorrow";
  return "on " + reservationDate;
}
