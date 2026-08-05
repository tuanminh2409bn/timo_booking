export const canCustomerCancelBooking = (input: {
  bookingStatus: string;
  appointmentEpoch: number;
  cancellationNoticeHours: number;
  now?: number;
}): boolean =>
  input.bookingStatus === "requested" ||
  (["confirmed", "processing"].includes(input.bookingStatus) &&
    input.appointmentEpoch - (input.now ?? Date.now()) >=
      input.cancellationNoticeHours * 60 * 60 * 1000);
