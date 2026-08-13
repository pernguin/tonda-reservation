import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("TONDA_SERVICE_ROLE_KEY")!;
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

  let extras = "";
  if (reservation.baby_chairs > 0) extras += "Baby chairs: " + reservation.baby_chairs + "  ";
  if (reservation.pets) extras += "Pets: Yes";
  const extrasRow = extras ? "<tr><td colspan='2' style='padding:6px 0;color:#555;font-size:14px;'>" + extras + "</td></tr>" : "";

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
    "<h2 style='color:#E8420A;font-size:20px;margin:0 0 8px;font-family:Georgia,serif;'>Reservation Confirmed</h2>",
    "<p style='color:#333;font-size:15px;margin:0 0 28px;'>Hi " + firstName + ", we look forward to seeing you!</p>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#f5f7fa;border-radius:6px;padding:20px;margin-bottom:24px;'>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;width:100px;'>Date</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + date + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Time</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + time + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Guests</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + reservation.guest_count + "</td></tr>",
    extrasRow,
    "</table>",
    "<p style='color:#E8420A;font-size:14px;font-weight:bold;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px;'>Where to find us</p>",
    "<p style='color:#555;font-size:14px;margin:0 0 28px;line-height:1.6;'>28, Jalan 2/109e, Taman Desa Business Park<br>58100 Kuala Lumpur, Wilayah Persekutuan</p>",
    "<p style='color:#555;font-size:14px;margin:0 0 20px;'>Need to cancel or make changes to your booking?</p>",
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
    const payload = await req.json();
    const reservation = payload.record;

    if (!reservation || !reservation.id) {
      return new Response(JSON.stringify({ error: "No reservation data" }), { status: 400 });
    }

    // Look up customer in Round's Supabase (shared customer DB)
    const { data: customer, error: customerError } = await roundSupabase
      .from("customers")
      .select("full_name, email")
      .eq("id", reservation.customer_id)
      .single();

    if (customerError || !customer?.email) {
      return new Response(JSON.stringify({ error: "No email" }), { status: 200 });
    }

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
        subject: "Your reservation at Tonda Pizza Romana is confirmed",
        html: html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});