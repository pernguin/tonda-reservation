import { escapeHtml } from "./escapeHtml.ts";

export interface Reservation {
  id: string;
  status?: string | null;
  reservation_date: string;
  reservation_time?: string | null;
  guest_count: number;
  baby_chairs?: number | null;
  pets?: boolean | null;
}

export interface Customer {
  full_name?: string | null;
  email?: string | null;
}

export interface BuiltEmail {
  subject: string;
  html: string;
}

const MANAGE_BASE_URL = "https://tonda-reservation.vercel.app/booking/";

function firstNameOf(customer: Customer): string {
  return (customer.full_name ?? "there").split(" ")[0];
}

function formatDate(reservationDate: string): string {
  const d = new Date(reservationDate + "T00:00:00");
  return d.toLocaleDateString("en-MY", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
}

export function buildConfirmationEmail(reservation: Reservation, customer: Customer): BuiltEmail {
  const pending = reservation.status === "pending";
  const date = escapeHtml(formatDate(reservation.reservation_date));
  const time = escapeHtml((reservation.reservation_time ?? "").slice(0, 5));
  const firstName = escapeHtml(firstNameOf(customer));
  const manageUrl = escapeHtml(MANAGE_BASE_URL + reservation.id);

  let extras = "";
  if ((reservation.baby_chairs ?? 0) > 0) extras += "Baby chairs: " + escapeHtml(reservation.baby_chairs) + "  ";
  if (reservation.pets) extras += "Pets: Yes";
  const extrasRow = extras ? "<tr><td colspan='2' style='padding:6px 0;color:#555;font-size:14px;'>" + extras + "</td></tr>" : "";

  const heading = pending ? "Reservation Request Received" : "Reservation Confirmed";
  const intro = pending
    ? "Hi " + firstName + ", thanks for your request. Our team will confirm your booking shortly."
    : "Hi " + firstName + ", we look forward to seeing you!";
  const subject = pending
    ? "We've received your reservation request at Tonda Pizza Romana"
    : "Your reservation at Tonda Pizza Romana is confirmed";

  const html = [
    "<!DOCTYPE html><html><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'></head>",
    "<body style='margin:0;padding:0;background:#f5f7fa;font-family:Georgia,serif;'>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#f5f7fa;padding:40px 0;'>",
    "<tr><td align='center'>",
    "<table width='600' cellpadding='0' cellspacing='0' style='background:#ffffff;border-radius:8px;overflow:hidden;max-width:600px;'>",
    "<tr><td style='background:#1B3A6B;padding:32px 40px;text-align:center;'>",
    "<h1 style='color:#ffffff;margin:0;font-size:22px;letter-spacing:2px;font-family:Georgia,serif;'>TONDA PIZZA ROMANA</h1>",
    "</td></tr>",
    "<tr><td style='padding:40px;'>",
    "<h2 style='color:#E8420A;font-size:20px;margin:0 0 8px;font-family:Georgia,serif;'>" + heading + "</h2>",
    "<p style='color:#333;font-size:15px;margin:0 0 28px;'>" + intro + "</p>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#f5f7fa;border-radius:6px;padding:20px;margin-bottom:24px;'>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;width:100px;'>Date</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + date + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Time</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + time + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Guests</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + escapeHtml(reservation.guest_count) + "</td></tr>",
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
    "</body></html>",
  ].join("");

  return { subject, html };
}

export function buildThankyouEmail(customer: Customer, feedbackUrl: string): BuiltEmail {
  const firstName = escapeHtml(firstNameOf(customer));

  const html = [
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
    "<a href='" + escapeHtml(feedbackUrl) + "' style='display:inline-block;padding:14px 32px;color:#ffffff;text-decoration:none;font-size:15px;letter-spacing:0.5px;font-family:Georgia,serif;'>Share your feedback</a>",
    "</td></tr></table>",
    "<p style='color:#999;font-size:13px;margin:0;line-height:1.6;'>We look forward to welcoming you back soon.</p>",
    "<p style='color:#999;font-size:13px;margin:8px 0 0;'>— Tonda Pizza Romana</p>",
    "</td></tr>",
    "<tr><td style='background:#1B3A6B;padding:20px 40px;text-align:center;'>",
    "<p style='color:#ffffff;opacity:0.7;font-size:12px;margin:0;'>Tonda Pizza Romana &nbsp;&bull;&nbsp; Taman Desa Business Park, Kuala Lumpur</p>",
    "</td></tr>",
    "</table>",
    "</td></tr></table>",
    "</body></html>",
  ].join("");

  return { subject: "Thank you for dining with us at Tonda Pizza Romana", html };
}

export function buildReminderEmail(reservation: Reservation, customer: Customer, dayWord: string): BuiltEmail {
  const date = escapeHtml(formatDate(reservation.reservation_date));
  const time = escapeHtml((reservation.reservation_time ?? "").slice(0, 5));
  const firstName = escapeHtml(firstNameOf(customer));
  const manageUrl = escapeHtml(MANAGE_BASE_URL + reservation.id);

  const html = [
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
    "<p style='color:#333;font-size:15px;margin:0 0 28px;'>This is a friendly reminder about your reservation " + escapeHtml(dayWord) + ".</p>",
    "<table width='100%' cellpadding='0' cellspacing='0' style='background:#f5f7fa;border-radius:6px;padding:20px;margin-bottom:24px;'>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;width:100px;'>Date</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + date + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Time</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + time + "</td></tr>",
    "<tr><td style='padding:6px 0;color:#777;font-size:13px;text-transform:uppercase;letter-spacing:1px;'>Guests</td><td style='color:#333;font-size:14px;font-weight:bold;'>" + escapeHtml(reservation.guest_count) + "</td></tr>",
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
    "</body></html>",
  ].join("");

  return { subject: "Reminder: Your reservation at Tonda Pizza Romana is " + dayWord, html };
}
