import { jobStatusEnum } from "@workspace/db";

export type BookingStatus = (typeof jobStatusEnum.enumValues)[number];

export const allowedStateTransitions: Record<BookingStatus, BookingStatus[]> = {
  REQUESTED: ["SEARCHING", "CANCELLED"],
  SEARCHING: ["ASSIGNED", "CANCELLED"],
  ASSIGNED: ["ACCEPTED", "SEARCHING", "CANCELLED"],
  ACCEPTED: ["TECHNICIAN_EN_ROUTE", "CANCELLED"],
  TECHNICIAN_EN_ROUTE: ["ARRIVED", "CANCELLED"],
  ARRIVED: ["IN_PROGRESS", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED"],
  COMPLETED: ["CUSTOMER_CONFIRMED", "DISPUTED"],
  CUSTOMER_CONFIRMED: ["PAID", "DISPUTED"],
  PAID: ["RATED", "DISPUTED"],
  RATED: ["DISPUTED"],
  CANCELLED: [],
  DISPUTED: ["PAID", "CANCELLED"],
  REFUNDED: [],
  REASSIGNED: ["ASSIGNED", "CANCELLED"],
};

export function canTransition(current: BookingStatus, next: BookingStatus) {
  return allowedStateTransitions[current]?.includes(next) ?? false;
}