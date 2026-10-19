import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  MediaObjectStore,
  UploadIdle,
  UploadTooLong,
} from "../../src/features/media/storage.js";

describe("media object store uploads", () => {
  let root: string;
  let store: MediaObjectStore;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "teluni-media-store-"));
    store = new MediaObjectStore(root);
    await store.initialize();
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("receives and hashes the bytes", async () => {
    const source = new PassThrough();
    const received = store.receive(source, 10, 1_000);
    source.end(Buffer.from("teluni"));
    const file = await received;
    expect(file.size).toBe(6);
    expect(file.sha256.toString("hex")).toBe(
      "0a6a3e1a5bc68fc57f5fc9e1ac511f044a9f055264a5ff9776ae0286f6b969cd",
    );
  });

  it("fails without a file when more bytes than declared arrive", async () => {
    const source = new PassThrough();
    const received = store.receive(source, 3, 1_000);
    source.end(Buffer.from("teluni"));
    await expect(received).rejects.toBeInstanceOf(UploadTooLong);
    expect(await readdir(join(root, "work"))).toEqual([]);
  });

  it("aborts a stalled upload after the idle timeout and removes it", async () => {
    const source = new PassThrough();
    const received = store.receive(source, 10, 50);
    source.write(Buffer.from("tel"));
    await expect(received).rejects.toBeInstanceOf(UploadIdle);
    expect(source.destroyed).toBe(true);
    expect(await readdir(join(root, "work"))).toEqual([]);
  });
});
