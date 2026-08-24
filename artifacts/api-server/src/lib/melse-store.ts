import { randomUUID } from "node:crypto";
import { calculateEstimate } from "./pricing";

export type BookingStatus =
  | "REQUESTED"
  | "SEARCHING"
  | "ASSIGNED"
  | "ACCEPTED"
  | "TECHNICIAN_EN_ROUTE"
  | "ARRIVED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CUSTOMER_CONFIRMED"
  | "PAID"
  | "RATED"
  | "CANCELLED"
  | "DISPUTED"
  | "REFUNDED"
  | "REASSIGNED";

export const services = [
  { id: "svc-1", slug: "appliance-repair", name: "Appliance repair", description: "Fridges, washing machines, cookers and more", icon: "appliance", startingPrice: 400, priceMax: 700, arrival: "25–35 min", accent: "ochre" },
  { id: "svc-2", slug: "electrician", name: "Electrician", description: "Safe, reliable help for electrical problems", icon: "electric", startingPrice: 350, priceMax: 650, arrival: "20–30 min", accent: "gold" },
  { id: "svc-3", slug: "plumber", name: "Plumber", description: "Leaks, drains, faucets and installations", icon: "plumber", startingPrice: 400, priceMax: 700, arrival: "25–35 min", accent: "blue" },
  { id: "svc-4", slug: "ac-refrigeration", name: "AC & refrigeration", description: "Keep your home cool and comfortable", icon: "ac", startingPrice: 500, priceMax: 900, arrival: "30–45 min", accent: "mint" },
  { id: "svc-5", slug: "cleaning", name: "Cleaning", description: "A fresh, cared-for home without the hassle", icon: "cleaning", startingPrice: 500, priceMax: 1000, arrival: "Same day", accent: "coral" },
];

export const technicians = [
  { id: "tech-1", name: "Dawit Bekele", initials: "DB", rating: 4.9, reviews: 126, verified: true, distance: "2.4 km away", eta: "25 min", earnings: "ETB 340–595", specialty: "Plumbing & installations", available: true },
  { id: "tech-2", name: "Hana Tesfaye", initials: "HT", rating: 4.8, reviews: 98, verified: true, distance: "3.1 km away", eta: "30 min", earnings: "ETB 340–595", specialty: "Home repairs", available: true },
  { id: "tech-3", name: "Abel Girma", initials: "AG", rating: 4.7, reviews: 74, verified: true, distance: "4.8 km away", eta: "35 min", earnings: "ETB 340–595", specialty: "Electrical & appliances", available: true },
];

export type ServiceRequest = {
  id: string;
  serviceSlug: string;
  problem: string;
  description: string;
  address: string;
  urgency?: string;
  createdAt: string;
  priceMin: number;
  priceMax: number;
  arrival: string;
};

export type Booking = {
  id: string;
  requestId: string;
  technicianId: string;
  technicianName: string;
  serviceName: string;
  address: string;
  status: BookingStatus;
  priceMin: number;
  priceMax: number;
  eta: string;
  createdAt: string;
  progress: number;
};

export const requests: ServiceRequest[] = [
  {
    id: "req-demo",
    serviceSlug: "plumber",
    problem: "Leaking pipe",
    description: "The kitchen sink pipe is leaking.",
    address: "Bole, Addis Ababa",
    urgency: "Today",
    createdAt: new Date().toISOString(),
    priceMin: 400,
    priceMax: 700,
    arrival: "25–35 min",
  },
];

export const bookings: Booking[] = [];

export function createRequest(input: Omit<ServiceRequest, "id" | "createdAt" | "priceMin" | "priceMax" | "arrival">): ServiceRequest {
  const service = services.find((item) => item.slug === input.serviceSlug) ?? services[0];
  const estimate = calculateEstimate(
    { baseMin: service.startingPrice, baseMax: service.priceMax, emergencyFee: 150, commissionRate: 0.15 },
    { isEmergency: input.urgency === "Emergency", distanceKm: 2.4 },
  );
  const request: ServiceRequest = {
    ...input,
    id: `req-${randomUUID().slice(0, 8)}`,
    createdAt: new Date().toISOString(),
    priceMin: estimate.minPrice,
    priceMax: estimate.maxPrice,
    arrival: service.arrival,
  };
  requests.unshift(request);
  return request;
}

export function findBooking(id: string) {
  return bookings.find((booking) => booking.id === id);
}