// Pure choice logic for send-confirmation-email. The template is still chosen from
// the booking's status by buildConfirmationEmail; this only decides send/skip and
// which send-once column to claim.
export type ConfirmationPlan =
  | { send: false; reason: string }
  | { send: true; claimColumn: "confirmation_sent_at" | "approval_sent_at" };

export function confirmationPlan(
  event: string | undefined,
  status: string | null | undefined,
): ConfirmationPlan {
  if (event === "approved") {
    if (status !== "confirmed") return { send: false, reason: "approval but status " + status };
    return { send: true, claimColumn: "approval_sent_at" };
  }
  if (status !== "pending" && status !== "confirmed") {
    return { send: false, reason: "status " + status };
  }
  return { send: true, claimColumn: "confirmation_sent_at" };
}
