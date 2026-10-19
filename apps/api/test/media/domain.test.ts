import { describe, expect, it } from "vitest";
import {
  admitDeclared,
  conversionTimeoutMs,
  detectFormat,
  displayBox,
  downloadName,
  inspect,
  MediaFailure,
  MediaRejection,
  mediaName,
  mediaPolicy,
  mediaTags,
  requireDeclaredFormat,
  reserveBytes,
  verifyDisplay,
  type ProbeOutput,
} from "../../src/features/media/domain.js";

const failure = (run: () => unknown) => {
  try {
    run();
  } catch (error) {
    if (error instanceof MediaFailure) return error.code;
    if (error instanceof MediaRejection) return error.reason;
    throw error;
  }
  return null;
};

const video = (
  overrides: Record<string, unknown> = {},
  extra: ProbeOutput["streams"] = [],
): ProbeOutput => ({
  streams: [
    {
      codec_type: "video",
      codec_name: "h264",
      profile: "High",
      level: 40,
      pix_fmt: "yuv420p",
      width: 1920,
      height: 1080,
      avg_frame_rate: "30/1",
      ...overrides,
    },
    ...extra,
  ],
  format: { duration: "12.5" },
});

describe("media admission", () => {
  it("admits allowed types within their size limits", () => {
    expect(admitDeclared("image/png", 10)).toEqual({
      kind: "IMAGE",
      format: "png",
    });
    expect(admitDeclared("video/quicktime", 10).format).toBe("isobmff");
    expect(failure(() => admitDeclared("image/gif", 10))).toBe(
      "MEDIA_TYPE_UNSUPPORTED",
    );
    expect(
      failure(() => admitDeclared("image/jpeg", mediaPolicy.maxImageBytes + 1)),
    ).toBe("MEDIA_TOO_LARGE");
    expect(failure(() => admitDeclared("video/mp4", 0))).toBe(
      "VALIDATION_FAILED",
    );
  });

  it("detects formats by signature and requires the declared one", () => {
    expect(detectFormat(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(
      detectFormat(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      ),
    ).toBe("png");
    expect(detectFormat(Buffer.from("RIFF\0\0\0\0WEBPVP8 ", "latin1"))).toBe(
      "webp",
    );
    expect(detectFormat(Buffer.from("\0\0\0\x18ftypmp42", "latin1"))).toBe(
      "isobmff",
    );
    expect(detectFormat(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))).toBe(
      "matroska",
    );
    expect(detectFormat(Buffer.from("<svg>", "latin1"))).toBeNull();
    expect(failure(() => requireDeclaredFormat("png", null))).toBe(
      "MEDIA_TYPE_UNSUPPORTED",
    );
    expect(failure(() => requireDeclaredFormat("png", "jpeg"))).toBe(
      "MEDIA_TYPE_MISMATCH",
    );
  });
});

describe("media inspection", () => {
  it("orients images and bounds their size", () => {
    const rotated = inspect("jpeg", {
      streams: [
        { codec_type: "video", codec_name: "mjpeg", width: 640, height: 480 },
      ],
      frames: [{ side_data_list: [{ rotation: -90 }] }],
    });
    expect(rotated).toMatchObject({ width: 480, height: 640, rotation: 270 });
    expect(
      failure(() =>
        inspect("png", {
          streams: [
            { codec_type: "video", codec_name: "png", width: 9000, height: 8 },
          ],
        }),
      ),
    ).toBe("MEDIA_DIMENSIONS_EXCEEDED");
    expect(
      failure(() =>
        inspect("png", {
          streams: [
            { codec_type: "video", codec_name: "mjpeg", width: 8, height: 8 },
          ],
        }),
      ),
    ).toBe("MEDIA_TYPE_UNSUPPORTED");
    expect(
      failure(() =>
        inspect("webp", {
          streams: [
            {
              codec_type: "video",
              codec_name: "webp",
              width: 8,
              height: 8,
              nb_read_frames: "5",
            },
          ],
        }),
      ),
    ).toBe("MEDIA_TYPE_UNSUPPORTED");
    expect(failure(() => inspect("jpeg", { streams: [] }))).toBe(
      "MEDIA_UNREADABLE",
    );
  });

  it("marks only the playback profile as compliant", () => {
    expect(
      inspect(
        "isobmff",
        video({}, [{ codec_type: "audio", codec_name: "aac" }]),
      ),
    ).toMatchObject({ compliant: true, hasAudio: true, durationMs: 12_500 });
    expect(
      inspect("isobmff", video({ avg_frame_rate: "60/1" })).compliant,
    ).toBe(false);
    expect(
      inspect("isobmff", video({ width: 3840, height: 2160 })).compliant,
    ).toBe(false);
    expect(inspect("isobmff", video({ level: 51 })).compliant).toBe(false);
    expect(inspect("matroska", video()).compliant).toBe(false);
    expect(
      inspect("isobmff", video({ side_data_list: [{ rotation: 90 }] })),
    ).toMatchObject({ compliant: false, width: 1080, height: 1920 });
    expect(
      inspect(
        "isobmff",
        video({}, [{ codec_type: "audio", codec_name: "mp3" }]),
      ).compliant,
    ).toBe(false);
  });

  it("rejects unsupported codecs, frame rates and durations", () => {
    expect(
      failure(() => inspect("isobmff", video({ codec_name: "prores" }))),
    ).toBe("MEDIA_TYPE_UNSUPPORTED");
    expect(
      failure(() =>
        inspect(
          "isobmff",
          video({}, [{ codec_type: "audio", codec_name: "pcm_s16le" }]),
        ),
      ),
    ).toBe("MEDIA_TYPE_UNSUPPORTED");
    expect(
      failure(() => inspect("isobmff", video({ avg_frame_rate: "240/1" }))),
    ).toBe("MEDIA_DIMENSIONS_EXCEEDED");
    expect(
      failure(() =>
        inspect("isobmff", { ...video(), format: { duration: "3600.5" } }),
      ),
    ).toBe("MEDIA_DURATION_EXCEEDED");
    expect(
      failure(() =>
        inspect("isobmff", { ...video(), format: { duration: "0" } }),
      ),
    ).toBe("MEDIA_UNREADABLE");
  });

  it("verifies renditions against the display profile", () => {
    expect(displayBox("IMAGE", 100, 200)).toEqual({
      width: 2160,
      height: 3840,
    });
    expect(displayBox("VIDEO", 200, 100)).toEqual({
      width: 1920,
      height: 1080,
    });
    expect(
      verifyDisplay(
        "VIDEO",
        video({}, [{ codec_type: "audio", codec_name: "aac" }]),
        true,
      ),
    ).toEqual({ width: 1920, height: 1080 });
    expect(failure(() => verifyDisplay("VIDEO", video(), true))).toBe(
      "MEDIA_CONVERSION_FAILED",
    );
    expect(
      failure(() =>
        verifyDisplay("VIDEO", video({ width: 3840, height: 2160 }), false),
      ),
    ).toBe("MEDIA_CONVERSION_FAILED");
    expect(
      failure(() =>
        verifyDisplay(
          "IMAGE",
          {
            streams: [
              { codec_type: "video", codec_name: "webp", width: 8, height: 8 },
            ],
          },
          false,
        ),
      ),
    ).toBe("MEDIA_CONVERSION_FAILED");
  });
});

describe("media names, tags and limits", () => {
  it("normalizes names and tags", () => {
    expect(mediaName("  Logo   da\tempresa ")).toBe("Logo da empresa");
    expect(failure(() => mediaName("   "))).toBe("VALIDATION_FAILED");
    expect(failure(() => mediaName("a".repeat(121)))).toBe("VALIDATION_FAILED");
    expect(failure(() => mediaName("bad\u0007name"))).toBe("VALIDATION_FAILED");
    expect(mediaTags([" Promo ", "promo", "Verão"])).toEqual([
      "promo",
      "verão",
    ]);
    expect(
      failure(() => mediaTags(Array.from({ length: 11 }, (_, i) => `t${i}`))),
    ).toBe("VALIDATION_FAILED");
    expect(failure(() => mediaTags([""]))).toBe("VALIDATION_FAILED");
  });

  it("derives safe download names, reserves and timeouts", () => {
    expect(downloadName('Café "x"/y', "jpg")).toBe("Cafe _x__y.jpg");
    expect(downloadName("日本", "png")).toBe("media.png");
    expect(reserveBytes(1024)).toBe(mediaPolicy.reserveMinimumBytes);
    expect(reserveBytes(100 * 1024 ** 3)).toBe(10 * 1024 ** 3);
    expect(conversionTimeoutMs("IMAGE", null)).toBe(120_000);
    expect(conversionTimeoutMs("VIDEO", 60_000)).toBe(360_000);
    expect(conversionTimeoutMs("VIDEO", 3_600_000)).toBe(4 * 60 * 60_000);
  });
});
