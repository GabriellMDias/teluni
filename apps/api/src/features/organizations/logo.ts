import { PNG } from "pngjs";
import { OrganizationFailure } from "./domain.js";

export const logoMaxLength = 350_000;
const prefix = "data:image/png;base64,";

/** Small raster branding is metadata, never executable SVG or a remote URL. */
export function normalizeLogo(value: string | null): string | null {
  if (value === null) return null;
  try {
    if (value.length > logoMaxLength || !value.startsWith(prefix))
      throw new Error("Invalid logo encoding");
    const encoded = value.slice(prefix.length);
    const bytes = Buffer.from(encoded, "base64");
    if (
      bytes.toString("base64") !== encoded ||
      bytes.length < 33 ||
      !bytes.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex")) ||
      bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("ascii", 12, 16) !== "IHDR"
    )
      throw new Error("Invalid PNG header");
    // Bound decompression before invoking the decoder, including 16-bit input.
    const width = bytes.readUInt32BE(16);
    const height = bytes.readUInt32BE(20);
    if (
      width < 1 ||
      height < 1 ||
      width > 256 ||
      height > 256 ||
      bytes[24] !== 8 ||
      bytes[28] !== 0
    )
      throw new Error("Invalid logo dimensions");
    // pngjs bounds non-interlaced inflation by the header dimensions. Reject
    // duplicate headers before parsing so a later header cannot change them.
    let offset = 8;
    let headers = 0;
    while (offset < bytes.length) {
      if (offset + 12 > bytes.length) throw new Error("Incomplete PNG chunk");
      const size = bytes.readUInt32BE(offset);
      const type = bytes.toString("ascii", offset + 4, offset + 8);
      if (type === "IHDR" && ++headers !== 1)
        throw new Error("Duplicate PNG header");
      if (type === "acTL") throw new Error("Animated logo");
      offset += size + 12;
      if (offset > bytes.length) throw new Error("Incomplete PNG data");
    }
    const image = PNG.sync.read(bytes, { checkCRC: true });
    const result = prefix + PNG.sync.write(image).toString("base64");
    if (result.length > logoMaxLength) throw new Error("Logo too large");
    return result;
  } catch {
    throw new OrganizationFailure("VALIDATION_FAILED");
  }
}
