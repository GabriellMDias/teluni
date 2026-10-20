import { generateKeyPairSync } from "node:crypto";
import { readFileSync } from "node:fs";
import {
  compactVerify,
  createLocalJWKSet,
  decodeProtectedHeader,
  type JSONWebKeySet,
} from "jose";
import { describe, expect, it } from "vitest";
import {
  agreedProtocol,
  authorizedPublications,
  connection,
  contentDigest,
  manifestBytes,
  type PublicationContent,
} from "../../src/features/publications/domain.js";
import {
  publicKeySet,
  signStatement,
  statementType,
} from "../../src/features/publications/statements.js";

const media = {
  id: "00000000-0000-4000-8000-0000000000aa",
  kind: "IMAGE" as const,
  contentType: "image/png",
  size: 1234,
  sha256: "ab".repeat(32),
  width: 640,
  height: 480,
  durationMs: null,
  hasAudio: false,
};
const video = {
  ...media,
  id: "00000000-0000-4000-8000-0000000000bb",
  kind: "VIDEO" as const,
  contentType: "video/mp4",
  durationMs: 5000,
  hasAudio: true,
};
const content: PublicationContent = {
  outputs: [
    {
      key: "screen",
      defaultPlaylistId: "00000000-0000-4000-8000-000000000002",
      rules: [
        {
          id: "r1",
          playlistId: "00000000-0000-4000-8000-000000000001",
          weekdays: [1, 2, 3, 4, 5],
          allDay: false,
          startTime: "08:00",
          endTime: "18:00",
          startsOn: "2027-01-04",
          endsOn: null,
        },
        {
          id: "r2",
          playlistId: "00000000-0000-4000-8000-000000000002",
          weekdays: [6, 7],
          allDay: true,
          startsOn: "2027-01-04",
          endsOn: "2027-12-31",
        },
      ],
    },
  ],
  playlists: [
    {
      id: "00000000-0000-4000-8000-000000000002",
      transition: { kind: "CUT" },
      items: [{ mediaId: video.id, durationMs: null }],
    },
    {
      id: "00000000-0000-4000-8000-000000000001",
      transition: { kind: "CUT" },
      items: [
        { mediaId: media.id, durationMs: 10_000 },
        { mediaId: video.id, durationMs: null },
      ],
    },
  ],
  media: [video, media],
};
const header = {
  publicationId: "00000000-0000-4000-8000-0000000000f1",
  companyId: "00000000-0000-4000-8000-0000000000c1",
  programId: "00000000-0000-4000-8000-0000000000e1",
  generation: 3,
  publishedAt: new Date("2027-01-04T12:00:00.000Z"),
};

describe("protocol 1 manifest", () => {
  it("serializes exact bytes in the protocol's key and item order", () => {
    const { bytes, sha256 } = manifestBytes(header, content);
    expect(bytes.toString("utf8")).toBe(
      [
        '{"format":"teluni.publication","protocol":1,',
        `"publicationId":"${header.publicationId}","companyId":"${header.companyId}",`,
        `"programId":"${header.programId}","generation":3,"publishedAt":"2027-01-04T12:00:00.000Z",`,
        '"outputs":[{"key":"screen","defaultPlaylistId":"00000000-0000-4000-8000-000000000002","rules":[',
        '{"id":"r1","playlistId":"00000000-0000-4000-8000-000000000001","weekdays":[1,2,3,4,5],"allDay":false,"startTime":"08:00","endTime":"18:00","startsOn":"2027-01-04","endsOn":null},',
        '{"id":"r2","playlistId":"00000000-0000-4000-8000-000000000002","weekdays":[6,7],"allDay":true,"startsOn":"2027-01-04","endsOn":"2027-12-31"}]}],',
        '"playlists":[',
        `{"id":"00000000-0000-4000-8000-000000000001","transition":{"kind":"CUT"},"items":[{"mediaId":"${media.id}","durationMs":10000},{"mediaId":"${video.id}","durationMs":null}]},`,
        `{"id":"00000000-0000-4000-8000-000000000002","transition":{"kind":"CUT"},"items":[{"mediaId":"${video.id}","durationMs":null}]}],`,
        `"media":[{"id":"${media.id}","kind":"IMAGE","contentType":"image/png","size":1234,"sha256":"${"ab".repeat(32)}","width":640,"height":480,"durationMs":null,"hasAudio":false},`,
        `{"id":"${video.id}","kind":"VIDEO","contentType":"video/mp4","size":1234,"sha256":"${"ab".repeat(32)}","width":640,"height":480,"durationMs":5000,"hasAudio":true}]}`,
      ].join(""),
    );
    expect(sha256.toString("hex")).toMatch(/^[0-9a-f]{64}$/);
    expect(manifestBytes(header, content).bytes.equals(bytes)).toBe(true);
  });

  it("writes rules exactly as the shared schedule fixtures do", () => {
    const fixtures = JSON.parse(
      readFileSync(
        new URL("../programming/schedule-fixtures.json", import.meta.url),
        "utf8",
      ),
    ) as { timelines: { rules: Record<string, unknown>[] }[] };
    const fixtureKeys = new Set(
      fixtures.timelines.flatMap((item) =>
        item.rules.map((rule) => Object.keys(rule).join(",")),
      ),
    );
    const manifest = JSON.parse(
      manifestBytes(header, content).bytes.toString("utf8"),
    ) as { outputs: { rules: Record<string, unknown>[] }[] };
    for (const rule of manifest.outputs[0].rules)
      expect(fixtureKeys).toContain(Object.keys(rule).join(","));
  });

  it("digests content independently of the publication and of input order", () => {
    const digest = contentDigest(content);
    expect(
      contentDigest({
        ...content,
        playlists: [...content.playlists].reverse(),
        media: [...content.media].reverse(),
      }).equals(digest),
    ).toBe(true);
    expect(
      contentDigest({
        ...content,
        playlists: content.playlists.map((playlist) => ({
          ...playlist,
          items: [...playlist.items].reverse(),
        })),
      }).equals(digest),
    ).toBe(false);
    const other = manifestBytes(
      { ...header, generation: 4, publishedAt: new Date() },
      content,
    );
    expect(other.sha256.equals(manifestBytes(header, content).sha256)).toBe(
      false,
    );
  });
});

describe("authorization statements", () => {
  const key = (id: string) => ({
    id,
    privateKey: generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey,
  });

  it("signs ES256 statements that the published key set verifies", async () => {
    const ring = [key("k2"), key("k1")];
    const statement = await signStatement(ring, {
      sub: "device",
      company: "company",
      iat: 1_800_000_000,
      exp: 1_800_604_800,
      publications: [{ id: "p1", sha256: "cd".repeat(32) }],
    });
    expect(decodeProtectedHeader(statement)).toEqual({
      alg: "ES256",
      kid: "k2",
      typ: statementType,
    });
    const set = (await publicKeySet(ring)) as unknown as JSONWebKeySet;
    expect(set.keys.map((item) => item.kid)).toEqual(["k2", "k1"]);
    expect(JSON.stringify(set)).not.toContain('"d"');
    const verified = await compactVerify(statement, createLocalJWKSet(set));
    expect(JSON.parse(new TextDecoder().decode(verified.payload))).toEqual({
      sub: "device",
      company: "company",
      iat: 1_800_000_000,
      exp: 1_800_604_800,
      publications: [{ id: "p1", sha256: "cd".repeat(32) }],
    });
    // A key set without the signing key cannot verify it.
    const other = (await publicKeySet([key("k2")])) as unknown as JSONWebKeySet;
    await expect(
      compactVerify(statement, createLocalJWKSet(other)),
    ).rejects.toThrow();
  });

  it("authorizes the desired publication and still-valid reported ones", () => {
    const desired = { id: "d", sha256: "1".repeat(64) };
    const active = { id: "a", sha256: "2".repeat(64) };
    const recovery = { id: "r", sha256: "3".repeat(64) };
    expect(authorizedPublications(null, "a", [active])).toEqual([]);
    expect(authorizedPublications(desired, null, [])).toEqual([desired]);
    expect(
      authorizedPublications(desired, "a", [active, desired, recovery, active]),
    ).toEqual([desired, active, recovery]);
    // Once the desired generation is active, older ones get no new authority.
    expect(authorizedPublications(desired, "d", [recovery])).toEqual([desired]);
  });
});

describe("synchronization rules", () => {
  it("derives the AT-24 connection state from the last sync", () => {
    const now = new Date("2027-01-04T12:00:00Z");
    const ago = (seconds: number) => new Date(now.getTime() - seconds * 1000);
    expect(connection(null, now)).toBe("never");
    expect(connection(ago(0), now)).toBe("online");
    expect(connection(ago(90), now)).toBe("online");
    expect(connection(ago(91), now)).toBe("stale");
    expect(connection(ago(120), now)).toBe("stale");
    expect(connection(ago(121), now)).toBe("offline");
  });

  it("agrees on the highest protocol both sides support", () => {
    expect(agreedProtocol([1])).toBe(1);
    expect(agreedProtocol([2, 1])).toBe(1);
    expect(agreedProtocol([2])).toBeNull();
  });
});
