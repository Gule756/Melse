import type { BookingStatus } from "./melse-store";

export const allowedStateTransitions: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: ["SEARCHING", "CANCELLED"],
  SEARCHING: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ACCEPTED", "SEARCHING", "CANCELLED"],
  ACCEPTED: ["TECHNICIAN_EN_ROUTE", "CANCELLED"],
  TECHNICIAN_EN_ROUTE: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["CUSTOMER_CONFIRMED", "DISPUTED"],
  CUSTOMER_CONFIRMED: ["PAID"],
  PAID: ["RATED"],
  RATED: [],
  CANCELLED: [],
  DISPUTED: ["PAID", "CANCELLED"],
  REFUNDED: [],
  REASSIGNED: ["ASSIGNED", "CANCELLED"],
};

export function canTransition(current: BookingStatus, next: BookingStatus) {
  return allowedStateTransitions[current]?.includes(next) ?? false;
}