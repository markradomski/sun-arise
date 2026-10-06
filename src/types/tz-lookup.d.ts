declare module "tz-lookup" {
  /** Returns the IANA timezone identifier for a coordinate. */
  export default function tzLookup(latitude: number, longitude: number): string;
}
