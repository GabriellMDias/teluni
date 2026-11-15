import { find } from "geo-tz";
import { readFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { OrganizationFailure, isTimeZone } from "./domain.js";

export type CityLocation = Readonly<{
  id: string;
  name: string;
  region: string;
  countryCode: string;
  latitude: number;
  longitude: number;
}>;
export type BranchLocation = Readonly<{ latitude: number; longitude: number }>;
type Entry = CityLocation & {
  timeZone: string;
  search: string;
  population: number;
};
const fold = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const countryNames = new Map<string, string>();
const names = [
  new Intl.DisplayNames(["pt-BR"], { type: "region" }),
  new Intl.DisplayNames(["en-US"], { type: "region" }),
];
let entries: Entry[] | undefined;
function catalog(): Entry[] {
  if (!entries) {
    entries = gunzipSync(
      readFileSync(new URL("./locations.tsv.gz", import.meta.url)),
    )
      .toString("utf8")
      .trimEnd()
      .split("\n")
      .map((line) => {
        const [
          id,
          name,
          region,
          countryCode,
          latitude,
          longitude,
          timeZone,
          population,
          aliases,
        ] = line.split("\t");
        if (!countryNames.has(countryCode))
          countryNames.set(
            countryCode,
            names.map((display) => display.of(countryCode)).join(" "),
          );
        return {
          id,
          name,
          region,
          countryCode,
          latitude: Number(latitude),
          longitude: Number(longitude),
          timeZone,
          population: Number(population),
          search: fold(
            `${name} ${region} ${countryCode} ${countryNames.get(countryCode)} ${aliases}`,
          ),
        };
      });
  }
  return entries;
}
const view = ({
  id,
  name,
  region,
  countryCode,
  latitude,
  longitude,
}: Entry): CityLocation => ({
  id,
  name,
  region,
  countryCode,
  latitude,
  longitude,
});

/** Coordinates are untrusted input; geographic boundaries own the zone. */
export function resolveLocation(point: BranchLocation): {
  location: BranchLocation;
  timeZone: string;
} {
  if (
    !Number.isFinite(point.latitude) ||
    !Number.isFinite(point.longitude) ||
    Math.abs(point.latitude) > 90 ||
    Math.abs(point.longitude) > 180
  )
    throw new OrganizationFailure("VALIDATION_FAILED");
  const location = {
    latitude: Math.round(point.latitude * 1e6) / 1e6,
    longitude: Math.round(point.longitude * 1e6) / 1e6,
  };
  const zones = find(location.latitude, location.longitude);
  if (zones.length !== 1 || !isTimeZone(zones[0]))
    throw new OrganizationFailure("LOCATION_TIME_ZONE_UNRESOLVED");
  return { location, timeZone: zones[0] };
}

export function searchLocations(query: string): CityLocation[] {
  const terms = fold(query.trim()).split(/\s+/u).filter(Boolean);
  if (query.trim().length < 2 || terms.length === 0) return [];
  return catalog()
    .filter((item) => terms.every((term) => item.search.includes(term)))
    .sort((a, b) => {
      const exact = (item: Entry) =>
        fold(item.name) === fold(query.trim()) ? 1 : 0;
      return (
        exact(b) - exact(a) ||
        b.population - a.population ||
        a.id.localeCompare(b.id)
      );
    })
    .slice(0, 20)
    .map(view);
}
