import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildReminderEmail } from "../_shared/emails.ts";
import { klDateString, reminderDayWord } from "../_shared/klTime.ts";
import { createRoundClient } from "../_shared/roundClient.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("TONDA_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const roundSupabase = createRoundClient();

Deno.serve(async (req) => {
  try {
    if (req.headers.get("Authorization") !== "Bearer " + SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const now = new Date();
    const targetTime = new Date(now.getTime() + 12 * 60 * 60 * 1000);

    // Restaurant-local parts; reservation_date/time are stored in Malaysia local time.
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "Asia/Kuala_Lumpur", hour: "2-digit", minute: "2-digit", hour12: false,
      }).formatToParts(targetTime).map((p) => [p.type, p.value]),
    );
    const targetDate = klDateString(targetTime);
    const targetHour = Number(parts.hour) % 24;
    const targetMinute = Number(parts.minute);

    const { data: reservations, error } = await supabase
      .from("reservations")
      .select("*")
      .eq("reservation_date", targetDate)
      .eq("status", "confirmed")
      .eq("reminder_sent", false);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const results: Array<Record<string, unknown>> = [];
    let sent = 0;

    for (const reservation of reservations ?? []) {
      const [resHour, resMinute] = (reservation.reservation_time ?? "00:00").split(":").map(Number);
      const diff = Math.abs((resHour * 60 + resMinute) - (targetHour * 60 + targetMinute));
      if (diff > 60) continue;

      try {
        // Claim first so an overlapping run cannot send a duplicate.
        const { data: claimed, error: claimError } = await supabase
          .from("reservations")
          .update({ reminder_sent: true })
          .eq("id", reservation.id)
          .eq("reminder_sent", false)
          .select("id");

        if (claimError) {
          results.push({ id: reservation.id, error: claimError.message });
          continue;
        }
        if (!claimed || claimed.length === 0) continue;

        const { data: customer, error: customerError } = await roundSupabase
          .from("customers")
          .select("full_name, email")
          .eq("id", reservation.customer_id)
          .maybeSingle();

        if (customerError) {
          await supabase.from("reservations").update({ reminder_sent: false }).eq("id", reservation.id);
          results.push({ id: reservation.id, error: customerError.message });
          continue;
        }
        // No customer row or no email: stay marked sent so it is not re-queried.
        if (!customer?.email) continue;

        const dayWord = reminderDayWord(reservation.reservation_date, new Date());
        const { subject, html } = buildReminderEmail(reservation, customer, dayWord);

        const res = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            "Authorization": "Bearer " + RESEND_API_KEY,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from: "Tonda Pizza Romana <reservations.tonda@roundpizzanapoletana.com>",
            to: [customer.email],
            subject,
            html,
          }),
        });

        const data = await res.json();
        if (!res.ok) {
          await supabase.from("reservations").update({ reminder_sent: false }).eq("id", reservation.id);
          results.push({ id: reservation.id, error: data });
          continue;
        }

        sent++;
        results.push({ id: reservation.id, resend: data });
      } catch (err) {
        await supabase.from("reservations").update({ reminder_sent: false }).eq("id", reservation.id);
        results.push({ id: reservation.id, error: String(err) });
      }
    }

    return new Response(JSON.stringify({ sent, results }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
