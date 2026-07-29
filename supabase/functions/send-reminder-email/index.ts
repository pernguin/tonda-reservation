import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ROUND_SUPABASE_URL = Deno.env.get("ROUND_SUPABASE_URL")!;
const ROUND_SUPABASE_ANON_KEY = Deno.env.get("ROUND_SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const roundSupabase = createClient(ROUND_SUPABASE_URL, ROUND_SUPABASE_ANON_KEY);

function buildEmail(reservation: any, customer: any): string {
  const d = new Date(reservation.reservation_date + "T00:00:00");
  const date = d.toLocaleDateString("en-MY", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  const time = (reservation.reservation_time ?? "").slice(0, 5);
  const firstName = (customer.full_name ?? "there").split(" ")[0];
  const manageUrl = "https://tonda-reservation.vercel.app/booking/" + reservation.id;

  return [
    "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>",
    "<body style='margin:0;padding:0;background:#f5f7fa;font-family:Georgia,serif;'>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#f5f7fa;padding:40px 0;'>",
    "<tr><td align='center'>",
    "<table width='600' cellpadding='0' cellspacing='0' style='background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;'>",
    "<tr><td style='background:#1B3A6B;padding:32px 40px;text-align:center;'>",
    "<h1 style='color:#ffffff;margin:0;font-size:22px;letter-spacing:2px;font-family:Georgia,serif;'>TONDA PIZZA ROMANA</h1>",
    "</td></tr>",
    "<tr><td style='padding:40px;'>",
    "<h2 style='color:#E8420A;font-size:20px;margin:0 0 8px;font-family:Georgia,serif;'>See you soon, " + firstName + "!</h2>",
    "<p style='color:#333;font-size:15px;margin:0 0 28px;'>This is a friendly reminder about your reservation today.</p>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#f5f7fa;border-radius:6px;padding:20px;margin-bottom:24px;'>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;width:100px;'>Date</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + date + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Time</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + time + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Guests</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + reservation.guest_count + "</td></tr>",
    "</table>",
    "<p style='color:#E8420A;font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;'>Where to find us</p>",
    "<p style='color:#555;font-size:14px;margin:0 0 28px;line-height:1.6;'>28, Jalan 2/109e, Taman Desa Business Park<br>58100 Kuala Lumpur, Wilayah Persekutuan</p>",
    "<table cellpadding='0' cellspacing='0' style='margin-bottom:20px;'><tr><td style='background:#E8420A;border-radius:4px;'>",
    "<a href='https://drive.google.com/file/d/1K4WLt3PYV3fd3ve91p94lZFLPCd_osap/view' style='display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:14px;letter-spacing:0.5px;font-family:Georgia,serif;'>View Our Menu</a>",
    "</td></tr></table>",
    "<p style='color:#555;font-size:14px;margin:0 0 20px;'>Need to cancel or make changes?</p>",
    "<table cellpadding='0' cellspacing='0'><tr><td style='background:#E8420A;border-radius:4px;'>",
    "<a href='" + manageUrl + "' style='display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:14px;letter-spacing:0.5px;font-family:Georgia,serif;'>Manage My Booking</a>",
    "</td></tr></table>",
    "</td></tr>",
    "<tr><td style='background:#1B3A6B;padding:20px 40px;text-align:center;'>",
    "<p style='color:#ffffff;opacity:0.7;font-size:12px;margin:0;'>Tonda Pizza Romana &nbsp;&bull;&nbsp; Taman Desa Business Park, Kuala Lumpur</p>",
    "</td></tr>",
    "</table>",
    "</td></tr></table>",
    "</body></html>"
  ].join("");
}

Deno.serve(async (req) => {
  try {
    const now = new Date();
    const targetTime = new Date(now.getTime() + 12 * 60 * 60 * 1000);
    const targetDate = targetTime.toISOString().slice(0, 10);
    const targetHour = targetTime.getUTCHours();
    const targetMinute = targetTime.getUTCMinutes();

    const { data: reservations, error } = await supabase
      .from("reservations")
      .select("*")
      .eq("reservation_date", targetDate)
      .eq("status", "confirmed")
      .eq("reminder_sent", false);

    if (error) {
      return new Response(JSON.stringify({ error: error.message }), { status: 500 });
    }

    const results = [];

    for (const reservation of reservations ?? []) {
      const [resHour, resMinute] = (reservation.reservation_time ?? "00:00").split(":").map(Number);
      const diff = Math.abs((resHour * 60 + resMinute) - (targetHour * 60 + targetMinute));
      if (diff > 60) continue;

      const { data: customer } = await roundSupabase
        .from("customers")
        .select("full_name, email")
        .eq("id", reservation.customer_id)
        .single();

      if (!customer?.email) continue;

      const html = buildEmail(reservation, customer);

      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + RESEND_API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: "Tonda Pizza Romana <reservations.tonda@roundpizzanapoletana.com>",
          to: [customer.email],
          subject: "Reminder: Your reservation at Tonda Pizza Romana is today",
          html: html,
        }),
      });

      const data = await res.json();

      await supabase
        .from("reservations")
        .update({ reminder_sent: true })
        .eq("id", reservation.id);

      results.push({ id: reservation.id, resend: data });
    }

    return new Response(JSON.stringify({ sent: results.length, results }), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});