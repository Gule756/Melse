import { Router, type IRouter } from "express";
import {
  CreateBookingBody,
  CreateServiceRequestBody,
  ListTechniciansQueryParams,
  UpdateBookingStatusBody,
  GetBookingParams,
  UpdateBookingStatusParams,
} from "@workspace/api-zod";
import {
  bookings,
  createRequest,
  findBooking,
  requests,
  services,
  technicians,
  type Booking,
} from "../lib/melse-store";
import { canTransition } from "../lib/job-state";

const router: IRouter = Router();

router.get("/services", (_req, res) => res.json(services));

router.get("/technicians", (req, res) => {
  const parsed = ListTechniciansQueryParams.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: "Invalid technician filters." });
  return res.json(technicians.filter((technician) => technician.verified && technician.available));
});

router.get("/service-requests", (_req, res) => res.json(requests));

router.post("/service-requests", (req, res) => {
  const parsed = CreateServiceRequestBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Please complete the request details." });
  return res.status(201).json(createRequest(parsed.data));
});

router.post("/bookings", (req, res) => {
  const parsed = CreateBookingBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: "Choose a technician to continue." });
  const request = requests.find((item) => item.id === parsed.data.requestId);
  const technician = technicians.find((item) => item.id === parsed.data.technicianId);
  if (!request || !technician) return res.status(404).json({ error: "We couldn't find that request or technician." });
  const service = services.find((item) => item.slug === request.serviceSlug) ?? services[0];
  const booking: Booking = {
    id: `book-${Date.now()}`,
    requestId: request.id,
    technicianId: technician.id,
    technicianName: technician.name,
    serviceName: service.name,
    address: request.address,
    status: "ASSIGNED",
    priceMin: request.priceMin,
    priceMax: request.priceMax,
    eta: technician.eta,
    createdAt: new Date().toISOString(),
    progress: 25,
  };
  bookings.unshift(booking);
  return res.status(201).json(booking);
});

router.get("/bookings/:id", (req, res) => {
  const parsed = GetBookingParams.safeParse(req.params);
  const booking = parsed.success ? findBooking(parsed.data.id) : undefined;
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  return res.json(booking);
});

router.patch("/bookings/:id/status", (req, res) => {
  const params = UpdateBookingStatusParams.safeParse(req.params);
  const body = UpdateBookingStatusBody.safeParse(req.body);
  const booking = params.success ? findBooking(params.data.id) : undefined;
  if (!params.success || !body.success) return res.status(400).json({ error: "Invalid booking status." });
  if (!booking) return res.status(404).json({ error: "Booking not found." });
  if (!canTransition(booking.status, body.data.status)) {
    return res.status(409).json({ error: `A job cannot move from ${booking.status} to ${body.data.status}.` });
  }
  booking.status = body.data.status;
  booking.progress = body.data.status === "COMPLETED" ? 100 : body.data.status === "IN_PROGRESS" ? 75 : body.data.status === "ARRIVED" ? 55 : 35;
  return res.json(booking);
});

router.get("/dashboard/summary", (_req, res) => {
  res.json({
    activeBooking: bookings[0] ?? null,
    recentRequests: requests.slice(0, 3),
    savedAddress: "Bole, Addis Ababa",
    trustStats: { verifiedProfessionals: "120+", averageRating: "4.8 / 5", guarantee: "7-day guarantee" },
  });
});

export default router;