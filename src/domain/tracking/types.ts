export type VehicleStatus = "moving" | "idle" | "offline";

export type Vehicle = {
  id: string;
  registrationNumber: string;
  status: VehicleStatus;
  lastKnownLat: number | null;
  lastKnownLng: number | null;
  updatedAt: string;
};
