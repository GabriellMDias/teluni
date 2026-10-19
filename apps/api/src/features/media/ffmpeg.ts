import { spawn } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { join } from "node:path";
import {
  conversionTimeoutMs,
  demuxers,
  displayBox,
  MediaRejection,
  mediaPolicy,
  type Format,
  type Inspection,
  type ProbeOutput,
} from "./domain.js";

/** Where the FFmpeg executables are and whether resource limits apply. */
export type MediaTools = Readonly<{
  ffmpegPath: string;
  ffprobePath: string;
}>;

/** A child process ended without producing a usable result. */
export class ToolFailure extends Error {
  readonly kind: "timeout" | "exit" | "spawn" | "output";
  constructor(kind: ToolFailure["kind"]) {
    super(`Media tool failure: ${kind}`);
    this.name = "ToolFailure";
    this.kind = kind;
  }
}

const prlimitPath = "/usr/bin/prlimit";

/**
 * Runs one FFmpeg executable as an isolated child process (ADR-0028): no
 * shell, an environment holding only PATH, stdin closed, its own process
 * group killed on timeout, bounded output and, where the host has
 * `prlimit`, address-space and CPU-time limits. Output is never logged.
 */
async function run(
  executable: string,
  args: readonly string[],
  options: {
    cwd: string;
    timeoutMs: number;
    maxStdout?: number;
    onStdoutLine?: (line: string) => void;
  },
): Promise<string> {
  const limited = await access(prlimitPath, constants.X_OK).then(
    () => true,
    () => false,
  );
  const cpuSeconds = Math.ceil(options.timeoutMs / 1000) * 2;
  const [command, argv] = limited
    ? [
        prlimitPath,
        [
          `--as=${4 * 1024 * 1024 * 1024}`,
          `--cpu=${cpuSeconds}`,
          `--fsize=${mediaPolicy.maxRenditionBytes + 1024 * 1024}`,
          "--",
          executable,
          ...args,
        ],
      ]
    : [executable, [...args]];
  const maxStdout = options.maxStdout ?? 1024 * 1024;
  return new Promise((resolve, reject) => {
    const child = spawn(command, argv, {
      cwd: options.cwd,
      env: { PATH: process.env.PATH ?? "/usr/bin:/bin" },
      stdio: ["ignore", "pipe", "pipe"],
      detached: true,
      shell: false,
    });
    let stdout = "";
    let pending = "";
    let overflow = false;
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      kill(child.pid);
    }, options.timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      if (options.onStdoutLine) {
        pending += chunk;
        const lines = pending.split("\n");
        pending = lines.pop() ?? "";
        for (const line of lines) options.onStdoutLine(line);
        return;
      }
      if (stdout.length + chunk.length > maxStdout) {
        overflow = true;
        kill(child.pid);
        return;
      }
      stdout += chunk;
    });
    // Diagnostics stay in the child: stderr is drained and discarded.
    child.stderr.resume();
    child.once("error", () => {
      clearTimeout(timer);
      reject(new ToolFailure("spawn"));
    });
    child.once("close", (code) => {
      clearTimeout(timer);
      if (timedOut) reject(new ToolFailure("timeout"));
      else if (overflow) reject(new ToolFailure("output"));
      else if (code !== 0) reject(new ToolFailure("exit"));
      else resolve(stdout);
    });
  });
}

function kill(pid: number | undefined): void {
  if (pid === undefined) return;
  try {
    process.kill(-pid, "SIGKILL");
  } catch {
    // The group already exited.
  }
}

const inputOptions = (format: Format) => [
  "-hide_banner",
  "-v",
  "error",
  "-protocol_whitelist",
  "file",
  "-f",
  demuxers[format],
];

/** Checks that both executables run and are FFmpeg 6.1 or later. */
export async function verifyTools(
  tools: MediaTools,
  cwd: string,
): Promise<boolean> {
  try {
    for (const executable of [tools.ffmpegPath, tools.ffprobePath]) {
      const output = await run(executable, ["-hide_banner", "-version"], {
        cwd,
        timeoutMs: 10_000,
      });
      const match = /version n?(\d+)\.(\d+)/.exec(output);
      if (!match) return false;
      const [major, minor] = [Number(match[1]), Number(match[2])];
      if (major < 6 || (major === 6 && minor < 1)) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Probes a file with its demuxer forced to the detected format. */
export async function probe(
  tools: MediaTools,
  input: string,
  format: Format,
  cwd: string,
): Promise<ProbeOutput> {
  const still = format === "jpeg" || format === "png" || format === "webp";
  let output: string;
  try {
    output = await run(
      tools.ffprobePath,
      [
        ...inputOptions(format),
        ...(still ? ["-count_frames", "-show_frames"] : []),
        "-show_streams",
        "-show_format",
        "-of",
        "json",
        "file:" + input,
      ],
      { cwd, timeoutMs: 30_000 },
    );
  } catch (error) {
    if (error instanceof ToolFailure && error.kind !== "spawn")
      throw new MediaRejection("MEDIA_UNREADABLE");
    throw error;
  }
  try {
    return JSON.parse(output) as ProbeOutput;
  } catch {
    throw new MediaRejection("MEDIA_UNREADABLE");
  }
}

/** Probes a produced rendition, whose format the module chose. */
export function probeOutput(
  tools: MediaTools,
  input: string,
  cwd: string,
): Promise<ProbeOutput> {
  return run(
    tools.ffprobePath,
    [
      "-hide_banner",
      "-v",
      "error",
      "-protocol_whitelist",
      "file",
      "-show_streams",
      "-show_format",
      "-of",
      "json",
      "file:" + input,
    ],
    { cwd, timeoutMs: 30_000 },
  ).then((output) => JSON.parse(output) as ProbeOutput);
}

export type Rendered = Readonly<{
  display: { path: string; contentType: string };
  thumbnail: { path: string; contentType: string };
}>;

const fit = (width: number, height: number) =>
  `scale=w='min(${width},iw)':h='min(${height},ih)':force_original_aspect_ratio=decrease`;

/**
 * Produces the display rendition and thumbnail of an image: orientation
 * applied, every metadata block removed, scaled down to the profile box.
 */
export async function renderImage(
  tools: MediaTools,
  input: string,
  format: Format,
  inspection: Inspection,
  directory: string,
): Promise<Rendered> {
  const box = displayBox("IMAGE", inspection.width, inspection.height);
  const extension = inspection.alpha ? "png" : "jpg";
  const display = join(directory, `display.${extension}`);
  const thumbnail = join(directory, `thumbnail.${extension}`);
  const encode = inspection.alpha
    ? ["-c:v", "png", "-pix_fmt", "rgba"]
    : ["-c:v", "mjpeg", "-pix_fmt", "yuvj420p", "-q:v", "2"];
  const timeoutMs = conversionTimeoutMs("IMAGE", null);
  try {
    for (const [target, width, height] of [
      [display, box.width, box.height],
      [thumbnail, 320, 320],
    ] as const)
      await run(
        tools.ffmpegPath,
        [
          ...inputOptions(format),
          "-nostdin",
          "-i",
          "file:" + input,
          "-map",
          "0:v:0",
          "-frames:v",
          "1",
          "-vf",
          fit(width, height),
          "-map_metadata",
          "-1",
          ...encode,
          "-f",
          "image2",
          "-update",
          "1",
          "-y",
          "file:" + target,
        ],
        { cwd: directory, timeoutMs },
      );
  } catch (error) {
    if (error instanceof ToolFailure && error.kind !== "spawn")
      throw new MediaRejection(
        error.kind === "timeout"
          ? "MEDIA_CONVERSION_FAILED"
          : "MEDIA_UNREADABLE",
      );
    throw error;
  }
  const contentType = inspection.alpha ? "image/png" : "image/jpeg";
  return {
    display: { path: display, contentType },
    thumbnail: { path: thumbnail, contentType },
  };
}

/**
 * Produces the display rendition of a video, remuxing a compliant file and
 * transcoding anything else to H.264 High 4.1 / AAC-LC, and its thumbnail.
 */
export async function renderVideo(
  tools: MediaTools,
  input: string,
  format: Format,
  inspection: Inspection,
  directory: string,
  onProgress: (percent: number) => void,
): Promise<Rendered> {
  const display = join(directory, "display.mp4");
  const thumbnail = join(directory, "thumbnail.jpg");
  const box = displayBox("VIDEO", inspection.width, inspection.height);
  const durationUs = (inspection.durationMs ?? 0) * 1000;
  const audio = inspection.hasAudio
    ? [
        "-map",
        "0:a:0",
        ...(inspection.compliant
          ? []
          : ["-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-ac", "2"]),
      ]
    : [];
  const filters = [
    `${fit(box.width, box.height)}:force_divisible_by=2`,
    ...(inspection.fps > 30.01 ? ["fps=30"] : []),
  ];
  const video = inspection.compliant
    ? ["-c", "copy"]
    : [
        "-vf",
        filters.join(","),
        "-c:v",
        "libx264",
        "-preset",
        "veryfast",
        "-crf",
        "21",
        "-profile:v",
        "high",
        "-level:v",
        "4.1",
        "-pix_fmt",
        "yuv420p",
      ];
  const timeoutMs = conversionTimeoutMs("VIDEO", inspection.durationMs);
  try {
    await run(
      tools.ffmpegPath,
      [
        ...inputOptions(format),
        "-nostdin",
        "-i",
        "file:" + input,
        "-map",
        "0:v:0",
        ...audio,
        ...video,
        "-sn",
        "-dn",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-movflags",
        "+faststart",
        "-fs",
        String(mediaPolicy.maxRenditionBytes),
        "-progress",
        "pipe:1",
        "-nostats",
        "-f",
        "mp4",
        "-y",
        "file:" + display,
      ],
      {
        cwd: directory,
        timeoutMs,
        onStdoutLine: (line) => {
          const match = /^out_time_us=(\d+)$/.exec(line.trim());
          if (match && durationUs > 0)
            onProgress(
              Math.min(99, Math.floor((Number(match[1]) / durationUs) * 100)),
            );
        },
      },
    );
    const at = Math.min(1, (inspection.durationMs ?? 0) / 2000);
    await run(
      tools.ffmpegPath,
      [
        "-hide_banner",
        "-v",
        "error",
        "-protocol_whitelist",
        "file",
        "-nostdin",
        "-ss",
        at.toFixed(3),
        "-f",
        "mp4",
        "-i",
        "file:" + display,
        "-frames:v",
        "1",
        "-vf",
        fit(320, 320),
        "-map_metadata",
        "-1",
        "-c:v",
        "mjpeg",
        "-pix_fmt",
        "yuvj420p",
        "-q:v",
        "4",
        "-f",
        "image2",
        "-update",
        "1",
        "-y",
        "file:" + thumbnail,
      ],
      { cwd: directory, timeoutMs: 60_000 },
    );
  } catch (error) {
    if (error instanceof ToolFailure && error.kind !== "spawn")
      throw new MediaRejection(
        error.kind === "timeout"
          ? "MEDIA_CONVERSION_FAILED"
          : "MEDIA_UNREADABLE",
      );
    throw error;
  }
  return {
    display: { path: display, contentType: "video/mp4" },
    thumbnail: { path: thumbnail, contentType: "image/jpeg" },
  };
}
