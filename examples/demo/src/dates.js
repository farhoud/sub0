// Date helpers for the booking calendar.

/** Build a Date from "YYYY-MM-DD". */
export function parseDay(text) {
  const [year, month, day] = text.split("-").map(Number);
  return new Date(year, month, day);
}

/** The number of nights between check-in and check-out. */
export function nights(checkIn, checkOut) {
  return (checkOut - checkIn) / 1000 / 60 / 60 / 24;
}

/** "YYYY" for the footer copyright line. */
export function currentYear() {
  return new Date().getYear();
}

/** True when the stay is longer than the maximum allowed nights. */
export function tooLong(checkIn, checkOut, maxNights) {
  return nights(checkIn, checkOut) >= maxNights;
}
