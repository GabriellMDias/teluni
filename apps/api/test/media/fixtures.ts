import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

async function ffmpeg(args: string[]): Promise<void> {
  await run("ffmpeg", ["-hide_banner", "-v", "error", "-y", ...args], {
    timeout: 120_000,
  });
}

/**
 * Inserts an EXIF block after the JPEG start marker with an orientation
 * (6 = rotate 90° clockwise) and a GPS IFD pointer, so tests can check that
 * renditions apply the orientation and drop location metadata.
 */
function withExif(jpeg: Buffer, orientation: number): Buffer {
  const tiff = Buffer.alloc(8 + 2 + 2 * 12 + 4 + 2 + 12 + 4);
  tiff.write("MM", 0, "latin1");
  tiff.writeUInt16BE(42, 2);
  tiff.writeUInt32BE(8, 4);
  tiff.writeUInt16BE(2, 8);
  // Orientation (SHORT).
  tiff.writeUInt16BE(0x0112, 10);
  tiff.writeUInt16BE(3, 12);
  tiff.writeUInt32BE(1, 14);
  tiff.writeUInt16BE(orientation, 18);
  // GPS IFD pointer (LONG).
  const gps = 8 + 2 + 2 * 12 + 4;
  tiff.writeUInt16BE(0x8825, 22);
  tiff.writeUInt16BE(4, 24);
  tiff.writeUInt32BE(1, 26);
  tiff.writeUInt32BE(gps, 30);
  tiff.writeUInt32BE(0, 34);
  // GPS IFD with GPSLatitudeRef = "S".
  tiff.writeUInt16BE(1, gps);
  tiff.writeUInt16BE(0x0001, gps + 2);
  tiff.writeUInt16BE(2, gps + 4);
  tiff.writeUInt32BE(2, gps + 6);
  tiff.write("S\0", gps + 10, "latin1");
  tiff.writeUInt32BE(0, gps + 14);
  const payload = Buffer.concat([Buffer.from("Exif\0\0", "latin1"), tiff]);
  const segment = Buffer.alloc(4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  return Buffer.concat([
    jpeg.subarray(0, 2),
    segment,
    payload,
    jpeg.subarray(2),
  ]);
}

export type Fixtures = Readonly<
  Record<
    | "jpegRotated"
    | "pngAlpha"
    | "pngTooWide"
    | "webpAnimated"
    | "jpegTruncated"
    | "text"
    | "videoCompliant"
    | "videoVp9"
    | "videoRotated"
    | "videoTooLong",
    string
  >
>;

/** Generates synthetic media in a directory with the system FFmpeg. */
export async function createFixtures(directory: string): Promise<Fixtures> {
  const path = (name: string) => join(directory, name);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=640x480",
    "-frames:v",
    "1",
    path("plain.jpg"),
  ]);
  await writeFile(
    path("rotated.jpg"),
    withExif(await readFile(path("plain.jpg")), 6),
  );
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=red@0.5:s=100x80,format=rgba",
    "-frames:v",
    "1",
    path("alpha.png"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=blue:s=9000x8",
    "-frames:v",
    "1",
    path("wide.png"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=64x64:rate=5",
    "-t",
    "1",
    "-c:v",
    "libwebp_anim",
    "-loop",
    "0",
    path("animated.webp"),
  ]).catch(() =>
    ffmpeg([
      "-f",
      "lavfi",
      "-i",
      "testsrc=size=64x64:rate=5",
      "-t",
      "1",
      "-loop",
      "0",
      path("animated.webp"),
    ]),
  );
  const plain = await readFile(path("plain.jpg"));
  await writeFile(path("truncated.jpg"), plain.subarray(0, 400));
  await writeFile(path("text.txt"), "not an image at all\n".repeat(20));
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=30",
    "-f",
    "lavfi",
    "-i",
    "sine=frequency=440:sample_rate=48000",
    "-t",
    "2",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-shortest",
    "-movflags",
    "+faststart",
    path("compliant.mp4"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=320x240:rate=60",
    "-t",
    "1",
    "-c:v",
    "libvpx-vp9",
    "-deadline",
    "realtime",
    "-cpu-used",
    "8",
    path("vp9.webm"),
  ]);
  await ffmpeg([
    "-display_rotation",
    "90",
    "-i",
    path("compliant.mp4"),
    "-c",
    "copy",
    path("rotated.mp4"),
  ]);
  await ffmpeg([
    "-f",
    "lavfi",
    "-i",
    "testsrc=size=16x16:rate=1",
    "-t",
    "3700",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    path("long.mp4"),
  ]);
  return {
    jpegRotated: path("rotated.jpg"),
    pngAlpha: path("alpha.png"),
    pngTooWide: path("wide.png"),
    webpAnimated: path("animated.webp"),
    jpegTruncated: path("truncated.jpg"),
    text: path("text.txt"),
    videoCompliant: path("compliant.mp4"),
    videoVp9: path("vp9.webm"),
    videoRotated: path("rotated.mp4"),
    videoTooLong: path("long.mp4"),
  };
}
