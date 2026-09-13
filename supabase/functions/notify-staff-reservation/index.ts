import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("TONDA_SERVICE_ROLE_KEY")!;
const ROUND_SUPABASE_URL = Deno.env.get("ROUND_SUPABASE_URL")!;
const ROUND_SUPABASE_ANON_KEY = Deno.env.get("ROUND_SUPABASE_ANON_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const roundSupabase = createClient(ROUND_SUPABASE_URL, ROUND_SUPABASE_ANON_KEY);

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Build from string parts; never new Date("YYYY-MM-DD") (parses as UTC).
function formatWhen(reservationDate: string, reservationTime: string | null): string {
  const [y, m, d] = String(reservationDate).split("-").map(Number);
  const local = new Date(y, m - 1, d);
  const datePart = `${DAYS[local.getDay()]} ${d} ${MONTHS[m - 1]}`;
  const time = reservationTime ? String(reservationTime).slice(0, 5) : "";
  return time ? `${datePart} ${time}` : datePart;
}

function parseRecipients(value: string | null | undefined): string[] {
  return String(value ?? "").split(",").map((s) => s.trim()).filter((s) => s.length > 0);
}

function escapeHtml(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function row(label: string, value: string): string {
  return "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;width:120px;vertical-align:top;'>" +
    label + "</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + value + "</td></tr>";
}

function buildEmail(reservation: any, customer: any, tableNumbers: string[]): { subject: string; html: string } {
  const name = customer?.full_name ?? "Unknown customer";
  const when = formatWhen(reservation.reservation_date, reservation.reservation_time);
  const pending = reservation.status === "pending";
  const noTable = reservation.needs_manual_assignment === true;
  const subject = (pending ? "ACTION NEEDED · " : "") + (noTable ? "NO TABLE · " : "") +
    "New reservation · " + when + " · " + reservation.guest_count + " pax · " + name;

  const rows = [
    row("Name", escapeHtml(name)),
    row("Phone", escapeHtml(customer?.phone ?? "—")),
    row("Email", escapeHtml(customer?.email ?? "—")),
    row("Date", escapeHtml(formatWhen(reservation.reservation_date, null))),
    row("Time", escapeHtml(String(reservation.reservation_time ?? "").slice(0, 5))),
    row("Guests", escapeHtml(reservation.guest_count)),
    noTable
      ? row("Tables", "<span style='color:#b45309;'>⚠️ No table assigned — assign manually</span>")
      : row("Tables", tableNumbers.length ? escapeHtml(tableNumbers.join(", ")) : "—"),
    reservation.baby_chairs > 0 ? row("Baby chairs", escapeHtml(reservation.baby_chairs)) : "",
    reservation.pets ? row("Pets", "Yes") : "",
    reservation.notes ? row("Notes", escapeHtml(reservation.notes)) : "",
    row("Status", pending ? "<span style='color:#b45309;'>Pending — needs approval</span>" : escapeHtml(reservation.status)),
  ].join("");

  const html = [
    "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>",
    "<body style='margin:0;padding:0;background:#F5F1EA;font-family:Georgia,serif;'>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#F5F1EA;padding:40px 0;'>",
    "<tr><td align='center'>",
    "<table width='600' cellpadding='0' cellspacing='0' style='background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;'>",
    "<tr><td style='background:#1B3A6B;padding:32px 40px;text-align:center;'>",
    "<h1 style='color:#ffffff;margin:0;font-size:22px;letter-spacing:2px;font-family:Georgia,serif;'>TONDA PIZZA ROMANA</h1>",
    "</td></tr>",
    "<tr><td style='padding:40px;'>",
    "<h2 style='color:#E8420A;font-size:20px;margin:0 0 8px;font-family:Georgia,serif;'>" + (pending ? "New reservation — needs approval" : "New reservation") + "</h2>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#F5F1EA;border-radius:6px;padding:20px;margin:20px 0 24px;'>",
    rows,
    "</table>",
    "<table cellpadding='0' cellspacing='0'><tr><td style='background:#E8420A;border-radius:4px;'>",
    "<a href='https://tonda-reservation.vercel.app/admin/bookings' style='display:inline-block;padding:12px 28px;color:#ffffff;text-decoration:none;font-size:14px;letter-spacing:0.5px;font-family:Georgia,serif;'>Open bookings</a>",
    "</td></tr></table>",
    "</td></tr>",
    "</table>",
    "</td></tr></table>",
    "</body></html>",
  ].join("");

  return { subject, html };
}

Deno.serve(async (req) => {
  try {
    if (req.headers.get("Authorization") !== "Bearer " + SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const payload = await req.json();
    const reservation = payload.record;

    if (!reservation || !reservation.customer_id) {
      return new Response(JSON.stringify({ error: "No reservation data" }), { status: 400 });
    }

    const { data: setting } = await supabase
      .from("settings")
      .select("value")
      .eq("key", "staff_alert_email")
      .maybeSingle();

    const recipients = parseRecipients(setting?.value);
    if (recipients.length === 0) {
      return new Response(JSON.stringify({ skipped: "no recipients" }), { status: 200 });
    }

    const { data: customer } = await roundSupabase
      .from("customers")
      .select("full_name, phone, email")
      .eq("id", reservation.customer_id)
      .maybeSingle();

    let tableNumbers: string[] = [];
    if (Array.isArray(reservation.table_ids) && reservation.table_ids.length > 0) {
      const { data: tables } = await supabase
        .from("restaurant_tables")
        .select("table_number")
        .in("id", reservation.table_ids);
      tableNumbers = (tables ?? []).map((t: any) => String(t.table_number)).sort();
    }

    const { subject, html } = buildEmail(reservation, customer, tableNumbers);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + RESEND_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: "Tonda Pizza Romana <reservations.tonda@roundpizzanapoletana.com>",
        to: recipients,
        subject,
        html,
      }),
    });

    const data = await res.json();
    return new Response(JSON.stringify(data), { status: res.ok ? 200 : 502 });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
