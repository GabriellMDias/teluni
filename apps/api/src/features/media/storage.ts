import { createHash, randomUUID } from "node:crypto";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import {
  mkdir,
  open,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** A finished file in the work area, ready to become an object. */
export type WorkFile = Readonly<{
  path: string;
  sha256: Buffer;
  size: number;
}>;

/**
 * The media volume (ADR-0028): immutable objects named by company and
 * SHA-256 under `objects/`, and a `work/` area on the same filesystem so a
 * finished file is published by an atomic rename. Paths never leave this
 * class; callers address objects by company and hash only.
 */
export class MediaObjectStore {
  readonly #objects: string;
  readonly #work: string;

  constructor(root: string) {
    const base = resolve(root);
    this.#objects = join(base, "objects");
    this.#work = join(base, "work");
  }

  async initialize(): Promise<void> {
    await mkdir(this.#objects, { recursive: true, mode: 0o700 });
    await mkdir(this.#work, { recursive: true, mode: 0o700 });
  }

  #objectPath(companyId: string, sha256: Buffer): string {
    if (!/^[0-9a-f-]{36}$/.test(companyId) || sha256.length !== 32)
      throw new Error("Invalid media object identity");
    const hex = sha256.toString("hex");
    return join(this.#objects, companyId, hex.slice(0, 2), hex);
  }

  /** A fresh private directory for one processing job. */
  async workDirectory(): Promise<string> {
    const path = join(this.#work, `job-${randomUUID()}`);
    await mkdir(path, { mode: 0o700 });
    return path;
  }

  async removeWork(path: string): Promise<void> {
    if (!resolve(path).startsWith(this.#work)) return;
    await rm(path, { recursive: true, force: true });
  }

  /**
   * Streams bytes into a work file, hashing them, and fails without leaving
   * a file when more than `limit` bytes arrive or the stream breaks.
   */
  async receive(source: Readable, limit: number): Promise<WorkFile> {
    const path = join(this.#work, `upload-${randomUUID()}`);
    const hash = createHash("sha256");
    let size = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _encoding, done) {
        size += chunk.length;
        if (size > limit) return done(new UploadTooLong());
        hash.update(chunk);
        done(null, chunk);
      },
    });
    try {
      await pipeline(
        source,
        counter,
        createWriteStream(path, { flags: "wx", mode: 0o600 }),
      );
      const handle = await open(path, "r+");
      try {
        await handle.sync();
      } finally {
        await handle.close();
      }
      return { path, sha256: hash.digest(), size };
    } catch (error) {
      await rm(path, { force: true });
      throw error;
    }
  }

  /** Hashes and flushes a file a job produced in its work directory. */
  async seal(path: string): Promise<WorkFile> {
    const hash = createHash("sha256");
    let size = 0;
    for await (const chunk of createReadStream(path) as AsyncIterable<Buffer>) {
      size += chunk.length;
      hash.update(chunk);
    }
    const handle = await open(path, "r+");
    try {
      await handle.sync();
    } finally {
      await handle.close();
    }
    return { path, sha256: hash.digest(), size };
  }

  /**
   * Moves a work file into place as the company's object. Called while the
   * object lock is held; an existing object has the same bytes, so the
   * work file is simply removed.
   */
  async publish(companyId: string, file: WorkFile): Promise<void> {
    const target = this.#objectPath(companyId, file.sha256);
    if (await exists(target)) {
      await rm(file.path, { force: true });
      return;
    }
    await mkdir(join(target, ".."), { recursive: true, mode: 0o700 });
    await rename(file.path, target);
  }

  async has(companyId: string, sha256: Buffer): Promise<boolean> {
    return exists(this.#objectPath(companyId, sha256));
  }

  /** The object's size, or null when it is missing. */
  async size(companyId: string, sha256: Buffer): Promise<number | null> {
    try {
      return (await stat(this.#objectPath(companyId, sha256))).size;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  /** Opens an object, optionally for an inclusive byte range. */
  open(
    companyId: string,
    sha256: Buffer,
    range?: { start: number; end: number },
  ): ReadStream {
    return createReadStream(
      this.#objectPath(companyId, sha256),
      range ? { start: range.start, end: range.end } : {},
    );
  }

  /** The path of an object, for a processing child process only. */
  pathFor(companyId: string, sha256: Buffer): string {
    return this.#objectPath(companyId, sha256);
  }

  async delete(companyId: string, sha256: Buffer): Promise<void> {
    await unlink(this.#objectPath(companyId, sha256)).catch(
      (error: NodeJS.ErrnoException) => {
        if (error.code !== "ENOENT") throw error;
      },
    );
  }

  /** Removes work entries older than the age, after a crash or restart. */
  async sweepWork(olderThanMs: number): Promise<number> {
    let removed = 0;
    for (const name of await readdir(this.#work)) {
      const path = join(this.#work, name);
      const info = await stat(path).catch(() => null);
      if (info && Date.now() - info.mtimeMs > olderThanMs) {
        await rm(path, { recursive: true, force: true });
        removed += 1;
      }
    }
    return removed;
  }

  /** Every object file, for reconciliation against the database. */
  async *list(): AsyncGenerator<{
    companyId: string;
    sha256: Buffer;
    ageMs: number;
  }> {
    for (const companyId of await readdir(this.#objects)) {
      const company = join(this.#objects, companyId);
      for (const prefix of await readdir(company).catch(() => [])) {
        for (const name of await readdir(join(company, prefix)).catch(
          () => [],
        )) {
          if (!/^[0-9a-f]{64}$/.test(name)) continue;
          const info = await stat(join(company, prefix, name)).catch(
            () => null,
          );
          if (info)
            yield {
              companyId,
              sha256: Buffer.from(name, "hex"),
              ageMs: Date.now() - info.mtimeMs,
            };
        }
      }
    }
  }

  /** Free and total bytes of the media volume. */
  async capacity(): Promise<{ free: number; total: number }> {
    const info = await statfs(this.#objects);
    return { free: info.bavail * info.bsize, total: info.blocks * info.bsize };
  }
}

export class UploadTooLong extends Error {
  constructor() {
    super("The upload exceeded its declared size");
    this.name = "UploadTooLong";
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
