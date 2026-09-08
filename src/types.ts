export interface Location {
  latitude: number;
  longitude: number;
  height: number;
}

export interface SolarPosition {
  azimuthDeg: number;
  altitudeDeg: number;
  sunriseMinutes: number;
  sunsetMinutes: number;
}

export interface HouseInstance {
  latitude: number;
  longitude: number;
  height: number;
  headingDeg: number;
  scale: number;
}