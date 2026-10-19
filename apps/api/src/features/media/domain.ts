// Framework-independent media rules from the media library design
// (docs/project/media-library-design.md): ingestion bounds (AT-02/AT-03),
// accepted signatures and codecs, the display rendition profile and the
// asset lifecycle.

export type MediaKind = "IMAGE" | "VIDEO";
export type MediaStatus =
  | "UPLOADING"
  | "PROCESSING"
  | "READY"
  | "REJECTED"
  | "FAILED"
  | "ARCHIVED"
  | "DELETED"
  | "PURGED";
export type MediaVariant = "thumbnail" | "display" | "original";
export type ProcessingStage = "probing" | "converting" | "verifying";

/** Closed enumeration of why an upload was rejected after inspection. */
export type RejectionReason =
  | "MEDIA_TYPE_MISMATCH"
  | "MEDIA_TYPE_UNSUPPORTED"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_DIMENSIONS_EXCEEDED"
  | "MEDIA_DURATION_EXCEEDED"
  | "MEDIA_UNREADABLE"
  | "MEDIA_CONVERSION_FAILED";

/** Engineering defaults; changing one is a reviewed code change. */
export const mediaPolicy = Object.freeze({
  maxImageBytes: 20 * 1024 * 1024,
  maxImageAxis: 8192,
  maxImagePixels: 32_000_000,
  maxVideoBytes: 1024 * 1024 * 1024,
  maxVideoSeconds: 3600,
  maxVideoAxis: 8192,
  maxVideoFps: 120,
  maxRenditionBytes: 2 * 1024 * 1024 * 1024,
  uploadIdleSeconds: 60,
  uploadExpirySeconds: 60 * 60,
  trashDays: 30,
  maxOpenUploadsPerPrincipal: 5,
  maxOpenUploadsPerCompany: 20,
  maxCreationsPerCompanyPerDay: 200,
  maxProcessingPerCompany: 20,
  maxAttempts: 3,
  leaseSeconds: 15 * 60,
  reserveMinimumBytes: 2 * 1024 * 1024 * 1024,
  reserveFraction: 0.1,
  maxTags: 10,
});

export type MediaFailureCode =
  | "RESOURCE_NOT_FOUND"
  | "VALIDATION_FAILED"
  | "RESOURCE_VERSION_CONFLICT"
  | "RATE_LIMITED"
  | "MEDIA_TYPE_UNSUPPORTED"
  | "MEDIA_TOO_LARGE"
  | "MEDIA_UPLOAD_INCOMPLETE"
  | "MEDIA_NOT_UPLOADING"
  | "MEDIA_NOT_READY"
  | "MEDIA_IN_USE"
  | "MEDIA_STORAGE_FULL"
  | "MEDIA_INVALID_STATE";

export class MediaFailure extends Error {
  readonly code: MediaFailureCode;
  constructor(code: MediaFailureCode) {
    super(`Media failure: ${code}`);
    this.name = "MediaFailure";
    this.code = code;
  }
}

/** A rejection decided while inspecting or converting; final for the asset. */
export class MediaRejection extends Error {
  readonly reason: RejectionReason;
  constructor(reason: RejectionReason) {
    super(`Media rejected: ${reason}`);
    this.name = "MediaRejection";
    this.reason = reason;
  }
}

/** Declared upload types; the signature decides the actual format. */
export const declaredTypes = Object.freeze({
  "image/jpeg": { kind: "IMAGE", format: "jpeg" },
  "image/png": { kind: "IMAGE", format: "png" },
  "image/webp": { kind: "IMAGE", format: "webp" },
  "video/mp4": { kind: "VIDEO", format: "isobmff" },
  "video/quicktime": { kind: "VIDEO", format: "isobmff" },
  "video/x-m4v": { kind: "VIDEO", format: "isobmff" },
  "video/webm": { kind: "VIDEO", format: "matroska" },
  "video/x-matroska": { kind: "VIDEO", format: "matroska" },
} as const satisfies Record<string, { kind: MediaKind; format: Format }>);

export type DeclaredType = keyof typeof declaredTypes;
export type Format = "jpeg" | "png" | "webp" | "isobmff" | "matroska";

/** Admission of a declared upload before any byte arrives. */
export function admitDeclared(
  contentType: string,
  size: number,
): { kind: MediaKind; format: Format } {
  const declared = (
    declaredTypes as Record<string, (typeof declaredTypes)[DeclaredType]>
  )[contentType];
  if (!declared) throw new MediaFailure("MEDIA_TYPE_UNSUPPORTED");
  const limit =
    declared.kind === "IMAGE"
      ? mediaPolicy.maxImageBytes
      : mediaPolicy.maxVideoBytes;
  if (!Number.isSafeInteger(size) || size < 1)
    throw new MediaFailure("VALIDATION_FAILED");
  if (size > limit) throw new MediaFailure("MEDIA_TOO_LARGE");
  return declared;
}

/** Identifies an allowed format from the first bytes of a file. */
export function detectFormat(head: Buffer): Format | null {
  if (
    head.length >= 3 &&
    head[0] === 0xff &&
    head[1] === 0xd8 &&
    head[2] === 0xff
  )
    return "jpeg";
  if (
    head.length >= 8 &&
    head
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return "png";
  if (
    head.length >= 12 &&
    head.toString("latin1", 0, 4) === "RIFF" &&
    head.toString("latin1", 8, 12) === "WEBP"
  )
    return "webp";
  if (head.length >= 12 && head.toString("latin1", 4, 8) === "ftyp")
    return "isobmff";
  if (
    head.length >= 4 &&
    head.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
  )
    return "matroska";
  return null;
}

/** The detected format must be the declared one (same family for video). */
export function requireDeclaredFormat(
  declared: Format,
  detected: Format | null,
): void {
  if (detected === null) throw new MediaRejection("MEDIA_TYPE_UNSUPPORTED");
  if (detected !== declared) throw new MediaRejection("MEDIA_TYPE_MISMATCH");
}

/** The demuxer each signature forces, so ffprobe never guesses a format. */
export const demuxers: Readonly<Record<Format, string>> = {
  jpeg: "jpeg_pipe",
  png: "png_pipe",
  webp: "webp_pipe",
  isobmff: "mov",
  matroska: "matroska",
};

const imageCodecs: Readonly<Record<string, Format>> = {
  mjpeg: "jpeg",
  png: "png",
  webp: "webp",
};
const videoCodecs = new Set(["h264", "hevc", "vp8", "vp9", "av1", "mpeg4"]);
const audioCodecs = new Set(["aac", "mp3", "opus", "vorbis", "flac", "ac3"]);

/** The subset of ffprobe's JSON this module reads. */
export type ProbeOutput = Readonly<{
  streams?: readonly Readonly<{
    codec_type?: string;
    codec_name?: string;
    profile?: string;
    level?: number;
    pix_fmt?: string;
    width?: number;
    height?: number;
    avg_frame_rate?: string;
    r_frame_rate?: string;
    nb_frames?: string;
    nb_read_frames?: string;
    duration?: string;
    side_data_list?: readonly Readonly<{ rotation?: number }>[];
    tags?: Readonly<Record<string, string>>;
  }>[];
  frames?: readonly Readonly<{
    side_data_list?: readonly Readonly<{ rotation?: number }>[];
  }>[];
  format?: Readonly<{ duration?: string; nb_streams?: number }>;
}>;

export type Inspection = Readonly<{
  kind: MediaKind;
  /** Width and height as displayed, after rotation or EXIF orientation. */
  width: number;
  height: number;
  durationMs: number | null;
  hasAudio: boolean;
  /** Frames per second of a video; zero for an image. */
  fps: number;
  alpha: boolean;
  /** Whether the video already matches the display profile. */
  compliant: boolean;
  rotation: number;
}>;

function rate(value: string | undefined): number {
  if (!value) return 0;
  const [numerator, denominator] = value.split("/").map(Number);
  if (!denominator || !Number.isFinite(numerator)) return 0;
  return numerator / denominator;
}

function rotationOf(
  sideData: readonly Readonly<{ rotation?: number }>[] | undefined,
): number {
  const raw = sideData?.find(
    (entry) => typeof entry.rotation === "number",
  )?.rotation;
  if (raw === undefined) return 0;
  return ((Math.round(raw) % 360) + 360) % 360;
}

const alphaFormats = /^(rgba|bgra|argb|abgr|ya|yuva|gbrap|pal8|la)/;

/** Applies the image and video bounds to a probe of the original. */
export function inspect(format: Format, probe: ProbeOutput): Inspection {
  const streams = probe.streams ?? [];
  const video = streams.filter((stream) => stream.codec_type === "video");
  if (video.length === 0) throw new MediaRejection("MEDIA_UNREADABLE");
  if (format === "jpeg" || format === "png" || format === "webp") {
    const [picture] = video;
    if (video.length !== 1 || imageCodecs[picture.codec_name ?? ""] !== format)
      throw new MediaRejection("MEDIA_TYPE_UNSUPPORTED");
    // ffprobe counts frames of animated images; a still has one or none.
    const frames = Number(picture.nb_read_frames ?? picture.nb_frames ?? "1");
    if (Number.isFinite(frames) && frames > 1)
      throw new MediaRejection("MEDIA_TYPE_UNSUPPORTED");
    const rotation = rotationOf(
      probe.frames?.[0]?.side_data_list ?? picture.side_data_list,
    );
    const { width, height } = oriented(picture.width, picture.height, rotation);
    if (
      width > mediaPolicy.maxImageAxis ||
      height > mediaPolicy.maxImageAxis ||
      width * height > mediaPolicy.maxImagePixels
    )
      throw new MediaRejection("MEDIA_DIMENSIONS_EXCEEDED");
    return {
      kind: "IMAGE",
      width,
      height,
      durationMs: null,
      hasAudio: false,
      fps: 0,
      alpha: alphaFormats.test(picture.pix_fmt ?? ""),
      compliant: false,
      rotation,
    };
  }
  const [main] = video;
  if (!videoCodecs.has(main.codec_name ?? ""))
    throw new MediaRejection("MEDIA_TYPE_UNSUPPORTED");
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  if (audio.some((stream) => !audioCodecs.has(stream.codec_name ?? "")))
    throw new MediaRejection("MEDIA_TYPE_UNSUPPORTED");
  const rotation = rotationOf(main.side_data_list);
  const { width, height } = oriented(main.width, main.height, rotation);
  const fps = rate(main.avg_frame_rate) || rate(main.r_frame_rate);
  if (
    width > mediaPolicy.maxVideoAxis ||
    height > mediaPolicy.maxVideoAxis ||
    fps > mediaPolicy.maxVideoFps
  )
    throw new MediaRejection("MEDIA_DIMENSIONS_EXCEEDED");
  const seconds = Number(probe.format?.duration ?? main.duration ?? "NaN");
  if (!Number.isFinite(seconds) || seconds <= 0)
    throw new MediaRejection("MEDIA_UNREADABLE");
  if (seconds > mediaPolicy.maxVideoSeconds)
    throw new MediaRejection("MEDIA_DURATION_EXCEEDED");
  const landscape = width >= height;
  const compliant =
    format === "isobmff" &&
    main.codec_name === "h264" &&
    ["High", "Main", "Constrained Baseline", "Baseline"].includes(
      main.profile ?? "",
    ) &&
    (main.level ?? 99) <= 41 &&
    main.pix_fmt === "yuv420p" &&
    rotation === 0 &&
    (landscape
      ? width <= 1920 && height <= 1080
      : width <= 1080 && height <= 1920) &&
    fps > 0 &&
    fps <= 30.01 &&
    audio.length <= 1 &&
    audio.every((stream) => stream.codec_name === "aac");
  return {
    kind: "VIDEO",
    width,
    height,
    durationMs: Math.round(seconds * 1000),
    hasAudio: audio.length > 0,
    fps,
    alpha: false,
    compliant,
    rotation,
  };
}

function oriented(
  width: number | undefined,
  height: number | undefined,
  rotation: number,
): { width: number; height: number } {
  if (!width || !height || width < 1 || height < 1)
    throw new MediaRejection("MEDIA_UNREADABLE");
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

/** The display rendition box for an oriented size: landscape or portrait. */
export function displayBox(
  kind: MediaKind,
  width: number,
  height: number,
): { width: number; height: number } {
  const [long, short] = kind === "IMAGE" ? [3840, 2160] : [1920, 1080];
  return width >= height
    ? { width: long, height: short }
    : { width: short, height: long };
}

/** Verifies a produced display rendition against the profile. */
export function verifyDisplay(
  kind: MediaKind,
  probe: ProbeOutput,
  expectAudio: boolean,
): { width: number; height: number } {
  const streams = probe.streams ?? [];
  const video = streams.filter((stream) => stream.codec_type === "video");
  const audio = streams.filter((stream) => stream.codec_type === "audio");
  const [main] = video;
  if (video.length !== 1 || !main.width || !main.height)
    throw new MediaRejection("MEDIA_CONVERSION_FAILED");
  const box = displayBox(kind, main.width, main.height);
  if (main.width > box.width || main.height > box.height)
    throw new MediaRejection("MEDIA_CONVERSION_FAILED");
  if (kind === "IMAGE") {
    if (!["mjpeg", "png"].includes(main.codec_name ?? "") || audio.length > 0)
      throw new MediaRejection("MEDIA_CONVERSION_FAILED");
    return { width: main.width, height: main.height };
  }
  const fps = rate(main.avg_frame_rate) || rate(main.r_frame_rate);
  if (
    main.codec_name !== "h264" ||
    main.pix_fmt !== "yuv420p" ||
    (main.level ?? 99) > 41 ||
    fps > 30.01 ||
    rotationOf(main.side_data_list) !== 0 ||
    audio.length !== (expectAudio ? 1 : 0) ||
    audio.some((stream) => stream.codec_name !== "aac")
  )
    throw new MediaRejection("MEDIA_CONVERSION_FAILED");
  return { width: main.width, height: main.height };
}

/** Trims and bounds an asset name; never interpreted as a path. */
export function mediaName(value: string): string {
  const name = value.normalize("NFC").replace(/\s+/g, " ").trim();
  if (
    name.length < 1 ||
    name.length > 120 ||
    // Control characters are never part of a name.
    // eslint-disable-next-line no-control-regex
    /[\u0000-\u001f\u007f]/.test(name)
  )
    throw new MediaFailure("VALIDATION_FAILED");
  return name;
}

/** Normalizes tags: trimmed, lower-cased, unique, sorted, at most ten. */
export function mediaTags(values: readonly string[]): string[] {
  const tags = new Set<string>();
  for (const value of values) {
    const tag = value
      .normalize("NFC")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    // eslint-disable-next-line no-control-regex
    if (tag.length < 1 || tag.length > 40 || /[\u0000-\u001f\u007f]/.test(tag))
      throw new MediaFailure("VALIDATION_FAILED");
    tags.add(tag);
  }
  if (tags.size > mediaPolicy.maxTags)
    throw new MediaFailure("VALIDATION_FAILED");
  return [...tags].sort();
}

/** Free space the media volume must keep after an admitted upload. */
export function reserveBytes(totalBytes: number): number {
  return Math.max(
    mediaPolicy.reserveMinimumBytes,
    Math.ceil(totalBytes * mediaPolicy.reserveFraction),
  );
}

/** Wall-clock limit of converting one asset, in milliseconds. */
export function conversionTimeoutMs(
  kind: MediaKind,
  durationMs: number | null,
): number {
  if (kind === "IMAGE") return 120_000;
  return Math.min(4 * 60 * 60_000, 120_000 + 4 * (durationMs ?? 0));
}

/** A file name safe for Content-Disposition, derived from the asset name. */
export function downloadName(name: string, extension: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/["\\/:*?<>|;]/g, "_")
    .trim()
    .slice(0, 80);
  return `${base || "media"}.${extension}`;
}
