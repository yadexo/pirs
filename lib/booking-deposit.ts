/**
 * What a clinic asks for up front to hold an appointment.
 *
 * Both settings default to 0, which means booking is free and the treatment is
 * paid at the clinic. A fixed amount wins over the percentage, and neither can
 * ask for more than the treatment costs.
 */
export function bookingDepositCents(
  settings: { bookingDepositPercent: number; bookingDepositFixedCents: number } | null,
  servicePriceCents: number,
): number {
  if (!settings || servicePriceCents <= 0) return 0;
  if (settings.bookingDepositFixedCents > 0) return Math.min(settings.bookingDepositFixedCents, servicePriceCents);
  if (settings.bookingDepositPercent > 0) {
    return Math.min(Math.round((servicePriceCents * Math.min(settings.bookingDepositPercent, 100)) / 100), servicePriceCents);
  }
  return 0;
}
