import { URL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

// Explicit maintenance command; download and extract the attributed GeoNames
// inputs first. Runtime and validation never call an external geocoding service.
const [citiesPath, regionsPath] = process.argv.slice(2);
if (!citiesPath || !regionsPath)
  throw new Error("Expected cities500.txt and admin1CodesASCII.txt paths");
const [cities, regions] = await Promise.all([
  readFile(citiesPath),
  readFile(regionsPath),
]);
const regionNames = new Map(
  regions
    .toString("utf8")
    .trimEnd()
    .split("\n")
    .map((line) => {
      const [id, name] = line.split("\t");
      return [id, name];
    }),
);
const rows = cities
  .toString("utf8")
  .trimEnd()
  .split("\n")
  .flatMap((line) => {
    const columns = line.split("\t");
    const [
      id,
      name,
      ascii,
      ,
      latitude,
      longitude,
      featureClass,
      ,
      countryCode,
      ,
      region,
      ,
      ,
      ,
      population,
      ,
      ,
      timeZone,
    ] = columns;
    if (featureClass !== "P" || !timeZone) return [];
    try {
      new Intl.DateTimeFormat("en", { timeZone });
    } catch {
      return [];
    }
    return [
      [
        id,
        name,
        regionNames.get(`${countryCode}.${region}`) ?? region,
        countryCode,
        latitude,
        longitude,
        timeZone,
        population,
        ascii,
      ].join("\t"),
    ];
  });
rows.sort((a, b) => Number(a.split("\t", 1)[0]) - Number(b.split("\t", 1)[0]));
const data = gzipSync(rows.join("\n") + "\n", { level: 9 });
await writeFile(
  new URL("../src/features/organizations/locations.tsv.gz", import.meta.url),
  data,
);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
await writeFile(
  new URL(
    "../src/features/organizations/locations-source.json",
    import.meta.url,
  ),
  JSON.stringify(
    {
      source: "https://download.geonames.org/export/dump/",
      license: "CC-BY-4.0",
      attribution: "GeoNames",
      inputs: {
        "cities500.txt": hash(cities),
        "admin1CodesASCII.txt": hash(regions),
      },
      count: rows.length,
      sha256: hash(data),
    },
    null,
    2,
  ) + "\n",
);
