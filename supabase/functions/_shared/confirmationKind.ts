export type ConfirmationPlan =
  | { send: false; reason: string }
  | { send: true; claimColumn: "confirmation_sent_at" | "approval_sent_at" };

// Decides whether send-confirmation-email sends, and which column it claims.
// `status` is the booking's status as re-read from the database, never the payload's.
export function confirmationPlan(
  event: string | undefined,
  status: string | null | undefined,
): ConfirmationPlan {
  if (status !== "pending" && status !== "confirmed") {
    return { send: false, reason: "status " + status };
  }
  if (event === "approved") {
    if (status !== "confirmed") return { send: false, reason: "not confirmed" };
    return { send: true, claimColumn: "approval_sent_at" };
  }
  return { send: true, claimColumn: "confirmation_sent_at" };
}
