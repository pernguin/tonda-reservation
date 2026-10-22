import { createClient } from "jsr:@supabase/supabase-js@2";
import { buildConfirmationEmail } from "../_shared/emails.ts";
import { confirmationPlan } from "../_shared/confirmationKind.ts";
import { createRoundClient } from "../_shared/roundClient.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("TONDA_SERVICE_ROLE_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
const roundSupabase = createRoundClient();

Deno.serve(async (req) => {
  let claimed = false;
  let delivered = false;
  let reservationId: string | null = null;
  let claimColumn: "confirmation_sent_at" | "approval_sent_at" = "confirmation_sent_at";

  const releaseClaim = async () => {
    try {
      const { error } = await supabase
        .from("reservations").update({ [claimColumn]: null }).eq("id", reservationId);
      if (error) console.error("failed to release " + claimColumn, reservationId, error.message);
    } catch (e) {
      console.error("failed to release " + claimColumn, reservationId, e);
    }
  };

  try {
    if (req.headers.get("Authorization") !== "Bearer " + SUPABASE_SERVICE_ROLE_KEY) {
      return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401 });
    }

    const payload = await req.json();
    const id = payload.record?.id;

    if (!id) {
      return new Response(JSON.stringify({ error: "No reservation id" }), { status: 400 });
    }

    reservationId = id;

    // Never trust the payload body: re-read the booking from the database.
    const { data: reservation, error: reservationError } = await supabase
      .from("reservations")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (reservationError) {
      return new Response(JSON.stringify({ error: reservationError.message }), { status: 500 });
    }
    if (!reservation) {
      return new Response(JSON.stringify({ error: "Reservation not found" }), { status: 404 });
    }
    const plan = confirmationPlan(payload.event, reservation.status);
    if (!plan.send) {
      return new Response(JSON.stringify({ skipped: plan.reason }), { status: 200 });
    }
    claimColumn = plan.claimColumn;

    // Look up customer in Round's Supabase (shared customer DB)
    const { data: customer, error: customerError } = await roundSupabase
      .from("customers")
      .select("full_name, email")
      .eq("id", reservation.customer_id)
      .single();

    if (customerError || !customer?.email) {
      return new Response(JSON.stringify({ error: "No email" }), { status: 200 });
    }

    // Build first: a template error must not leave a claim behind.
    const { subject, html } = buildConfirmationEmail(reservation, customer);

    // Claim before sending so a second call cannot send a duplicate.
    const { data: claimedRows, error: claimError } = await supabase
      .from("reservations")
      .update({ [claimColumn]: new Date().toISOString() })
      .eq("id", id)
      .is(claimColumn, null)
      .select("id");

    if (claimError) {
      return new Response(JSON.stringify({ error: claimError.message }), { status: 500 });
    }
    if (!claimedRows || claimedRows.length === 0) {
      return new Response(JSON.stringify({ skipped: "already sent" }), { status: 200 });
    }
    claimed = true;

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
    delivered = res.ok;

    const data = await res.json().catch(() => ({ error: "non-JSON response", status: res.status }));
    if (!res.ok) {
      await releaseClaim();
      return new Response(JSON.stringify(data), { status: 502 });
    }
    return new Response(JSON.stringify(data), { status: 200 });

  } catch (err) {
    if (claimed && !delivered) await releaseClaim();
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});
