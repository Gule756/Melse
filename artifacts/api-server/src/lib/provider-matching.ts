import { and, eq, inArray } from "drizzle-orm";
import {
  bookingsTable,
  db,
  providerAvailabilityTable,
  providerOffersTable,
  serviceRequestsTable,
  technicianProfilesTable,
  technicianServicePricingTable,
  technicianSkillsTable,
  usersTable,
} from "@workspace/db";

export type ProviderMatchRequest = Pick<typeof serviceRequestsTable.$inferSelect,
  "categoryId" | "latitude" | "longitude" | "preferredAt" | "budgetMin" | "budgetMax" | "isEmergency"
>;

export type ProviderMatch = {
  profile: typeof technicianProfilesTable.$inferSelect;
  name: string;
  distanceKm: number | null;
  completionRate: number;
  cancellationRate: number;
  responseRate: number;
  price: number | null;
};

const weekdayNumbers: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};

function localScheduleTime(date: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Addis_Ababa",
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return {
    dayOfWeek: weekdayNumbers[values.weekday],
    time: `${values.hour}:${values.minute}`,
  };
}

function distanceBetweenKm(latitudeA: number, longitudeA: number, latitudeB: number, longitudeB: number) {
  const radians = (degrees: number) => degrees * Math.PI / 180;
  const latitudeDelta = radians(latitudeB - latitudeA);
  const longitudeDelta = radians(longitudeB - longitudeA);
  const haversine = Math.sin(latitudeDelta / 2) ** 2
    + Math.cos(radians(latitudeA)) * Math.cos(radians(latitudeB)) * Math.sin(longitudeDelta / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export class ProviderMatchingService {
  async findMatches(request: ProviderMatchRequest): Promise<ProviderMatch[]> {
    const providers = await db.select({ profile: technicianProfilesTable, name: usersTable.fullName })
      .from(technicianProfilesTable)
      .innerJoin(usersTable, eq(usersTable.id, technicianProfilesTable.userId))
      .innerJoin(technicianSkillsTable, eq(technicianSkillsTable.technicianId, technicianProfilesTable.id))
      .where(and(
        eq(technicianSkillsTable.categoryId, request.categoryId),
        eq(technicianProfilesTable.verificationStatus, "VERIFIED"),
        eq(technicianProfilesTable.isAvailable, true),
        eq(usersTable.isActive, true),
        ...(request.isEmergency ? [eq(technicianProfilesTable.emergencyEligible, true)] : []),
      ));
    if (!providers.length) return [];

    const providerIds = [...new Set(providers.map(({ profile }) => profile.id))];
    const [bookings, offers, prices] = await Promise.all([
      db.select().from(bookingsTable).where(inArray(bookingsTable.technicianId, providerIds)),
      db.select().from(providerOffersTable).where(inArray(providerOffersTable.technicianId, providerIds)),
      db.select().from(technicianServicePricingTable).where(and(
        inArray(technicianServicePricingTable.technicianId, providerIds),
        eq(technicianServicePricingTable.categoryId, request.categoryId),
      )),
    ]);
    const slots = request.preferredAt
      ? await db.select().from(providerAvailabilityTable).where(inArray(providerAvailabilityTable.technicianId, providerIds))
      : [];
    const bookingsByProvider = new Map<string, typeof bookings>();
    for (const booking of bookings) bookingsByProvider.set(booking.technicianId, [...(bookingsByProvider.get(booking.technicianId) ?? []), booking]);
    const offersByProvider = new Map<string, typeof offers>();
    for (const offer of offers) offersByProvider.set(offer.technicianId, [...(offersByProvider.get(offer.technicianId) ?? []), offer]);
    const slotsByProvider = new Map<string, typeof slots>();
    for (const slot of slots) slotsByProvider.set(slot.technicianId, [...(slotsByProvider.get(slot.technicianId) ?? []), slot]);
    const priceByProvider = new Map(prices.map((price) => [price.technicianId, price]));

    const scheduled = request.preferredAt ? localScheduleTime(request.preferredAt) : undefined;
    const matches: ProviderMatch[] = [];
    for (const { profile, name } of providers) {
      const distanceKm = request.latitude === null || request.longitude === null
        ? null
        : profile.currentLatitude === null || profile.currentLongitude === null || !profile.locationUpdatedAt
          ? Number.POSITIVE_INFINITY
          : distanceBetweenKm(
            Number(request.latitude),
            Number(request.longitude),
            Number(profile.currentLatitude),
            Number(profile.currentLongitude),
          );
      if (distanceKm !== null && (!Number.isFinite(distanceKm) || distanceKm > Number(profile.serviceRadiusKm))) continue;
      const providerSlots = slotsByProvider.get(profile.id) ?? [];
      if (scheduled && providerSlots.length > 0 && !providerSlots.some((slot) =>
        slot.dayOfWeek === scheduled.dayOfWeek
        && slot.isAvailable
        && slot.startsAt <= scheduled.time
        && slot.endsAt > scheduled.time
      )) continue;

      const pricing = priceByProvider.get(profile.id);
      const price = pricing?.amount === null || pricing?.amount === undefined ? null : Number(pricing.amount);
      if (pricing?.pricingModel === "FIXED" && price !== null && request.budgetMax !== null && price > Number(request.budgetMax)) continue;

      const providerBookings = bookingsByProvider.get(profile.id) ?? [];
      const completed = providerBookings.filter((booking) => ["COMPLETED", "CUSTOMER_CONFIRMED", "PAID", "RATED"].includes(booking.status)).length;
      const cancelled = providerBookings.filter((booking) => booking.status === "CANCELLED").length;
      const totalJobs = providerBookings.length;
      const providerOffers = offersByProvider.get(profile.id) ?? [];
      const answeredOffers = providerOffers.filter((offer) => ["ACCEPTED", "DECLINED"].includes(offer.status)).length;
      const responseRate = providerOffers.length === 0 ? 0 : answeredOffers / providerOffers.length;
      matches.push({
        profile,
        name,
        distanceKm,
        completionRate: totalJobs === 0 ? 0 : completed / totalJobs,
        cancellationRate: totalJobs === 0 ? 0 : cancelled / totalJobs,
        responseRate,
        price,
      });
    }
    return matches.sort((left, right) =>
      (left.distanceKm ?? Number.POSITIVE_INFINITY) - (right.distanceKm ?? Number.POSITIVE_INFINITY)
      || Number(right.profile.ratingAvg) - Number(left.profile.ratingAvg)
      || right.completionRate - left.completionRate
      || left.cancellationRate - right.cancellationRate
      || right.responseRate - left.responseRate
      || (left.price ?? Number.POSITIVE_INFINITY) - (right.price ?? Number.POSITIVE_INFINITY)
      || left.profile.createdAt.getTime() - right.profile.createdAt.getTime(),
    );
  }
}
