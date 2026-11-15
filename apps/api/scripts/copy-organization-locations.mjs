import { URL } from "node:url";
import { copyFile } from "node:fs/promises";

await copyFile(
  new URL("../src/features/organizations/locations.tsv.gz", import.meta.url),
  new URL("../dist/features/organizations/locations.tsv.gz", import.meta.url),
);
