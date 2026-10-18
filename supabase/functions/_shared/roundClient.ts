import { createClient } from "jsr:@supabase/supabase-js@2";

// Round's customers table. Reads with the service-role key once ROUND_SERVICE_ROLE_KEY is set;
// until then falls back to the anon key (still works until Round 06 locks the table down).
export function createRoundClient() {
  const url = Deno.env.get("ROUND_SUPABASE_URL")!;
  const serviceKey = Deno.env.get("ROUND_SERVICE_ROLE_KEY");
  if (serviceKey) return createClient(url, serviceKey);
  console.warn("ROUND_SERVICE_ROLE_KEY not set; falling back to ROUND_SUPABASE_ANON_KEY");
  return createClient(url, Deno.env.get("ROUND_SUPABASE_ANON_KEY")!);
}
