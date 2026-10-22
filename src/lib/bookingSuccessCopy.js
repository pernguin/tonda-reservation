export const PENDING_HEADING = 'Request Received'
export const PENDING_MESSAGE = "Thank you for your reservation request. Our team will review it and email you once your booking is confirmed."
export const CONFIRMED_HEADING = 'Booking Confirmed'
export const CONFIRMED_FALLBACK = 'Your booking is confirmed. We look forward to welcoming you.'

// status: the status create_reservation_atomic returned. settingsMessage: confirmation_message_reservation or null.
export function bookingSuccessCopy(status, settingsMessage) {
  if (status === 'pending') return { heading: PENDING_HEADING, message: PENDING_MESSAGE }
  return {
    heading: CONFIRMED_HEADING,
    message: settingsMessage?.trim() ? settingsMessage : CONFIRMED_FALLBACK,
  }
}
