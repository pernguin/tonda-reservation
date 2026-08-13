import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("TONDA_SERVICE_ROLE_KEY")!;
const ROUND_SUPABASE_URL = Deno.env.get("ROUND_SUPABASE_URL")!;
const ROUND_SUPABASE_ANON_KEY = Deno.env.get("ROUND_SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const roundSupabase = createClient(ROUND_SUPABASE_URL, ROUND_SUPABASE_ANON_KEY);

const FEEDBACK_BASE_URL = "https://tonda-reservation.vercel.app/feedback";

function buildEmail(customer: any, feedbackUrl: string): string {
  const firstName = (customer.full_name ?? "there").split(" ")[0];

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
    "<h2 style='color:#E8420A;font-size:20px;margin:0 0 8px;font-family:Georgia,serif;'>Thank you for dining with us!</h2>",
    "<p style='color:#333;font-size:15px;margin:0 0 16px;'>Hi " + firstName + ", it was a pleasure having you at Tonda Pizza Romana.</p>",
    "<p style='color:#555;font-size:14px;margin:0 0 28px;line-height:1.6;'>We hope you enjoyed your meal. If you have a moment, we'd love to hear about your experience — it means the world to a small restaurant like ours.</p>",
    "<table cellpadding='0' cellspacing='0' style='margin-bottom:32px;'><tr><td style='background:#E8420A;border-radius:4px;'>",
    "<a href='" + feedbackUrl + "' style='display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;letter-spacing:0.5px;font-family:Georgia,serif;'>Share your feedback</a>",
    "</td></tr></table>",
    "<p style='color:#999;font-size:13px;margin:0;line-height:1.6;'>We look forward to welcoming you back soon.</p>",
    "<p style='color:#999;font-size:13px;margin:8px 0 0;'>— Tonda Pizza Romana</p>",
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
    const oldRecord = payload.old_record;

    if (!reservation || reservation.status !== "completed") {
      return new Response(JSON.stringify({ skipped: "not completed" }), { status: 200 });
    }
    if (oldRecord?.status === "completed") {
      return new Response(JSON.stringify({ skipped: "already was completed" }), { status: 200 });
    }

    if (!reservation.customer_id) {
      return new Response(JSON.stringify({ error: "No customer_id" }), { status: 200 });
    }

    const { data: customer, error: customerError } = await roundSupabase
      .from("customers")
      .select("full_name, email")
      .eq("id", reservation.customer_id)
      .single();

    if (customerError || !customer?.email) {
      return new Response(JSON.stringify({ error: "No email" }), { status: 200 });
    }

    const feedbackUrl = `${FEEDBACK_BASE_URL}?reservation=${reservation.id}&restaurant=tonda`;
    const html = buildEmail(customer, feedbackUrl);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Tonda Pizza Romana <reservations.tonda@roundpizzanapoletana.com>",
        to: [customer.email],
        subject: "Thank you for dining with us at Tonda Pizza Romana",
        html: html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { status: 200 });

  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});