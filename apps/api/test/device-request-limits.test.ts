import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import {
  deviceRequestKey,
  registerDeviceRequestLimits,
} from "../src/device-request-limits.js";

const quietHeaders = {
  addHeadersOnExceeding: {
    "x-ratelimit-limit": false,
    "x-ratelimit-remaining": false,
    "x-ratelimit-reset": false,
  },
  addHeaders: {
    "x-ratelimit-limit": false,
    "x-ratelimit-remaining": false,
    "x-ratelimit-reset": false,
    "retry-after": true,
  },
};

describe("screen request limits", () => {
  let close: (() => Promise<void>) | undefined;
  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  async function screenApp() {
    const { app } = createApp(pino({ level: "silent" }));
    void app.register(async (feature) => {
      await registerDeviceRequestLimits(
        feature,
        {
          perCredential: { max: 2, timeWindow: 60_000 },
          perAddress: { max: 5, timeWindow: 60_000 },
        },
        quietHeaders,
      );
      feature.get("/device/example", () => Promise.resolve({ ok: true }));
    });
    await app.ready();
    close = () => app.close();
    return (credential: string | undefined, address = "198.51.100.7") =>
      app.inject({
        method: "GET",
        url: "/device/example",
        remoteAddress: address,
        headers: credential ? { authorization: `Bearer ${credential}` } : {},
      });
  }

  it("keys by a digest of the presented credential, or by address without one", () => {
    const key = deviceRequestKey({
      headers: { authorization: "Bearer screen-one" },
      ip: "198.51.100.7",
    });
    expect(key).toMatch(/^credential:[A-Za-z0-9_-]{43}$/);
    expect(key).not.toContain("screen-one");
    expect(
      deviceRequestKey({
        headers: { authorization: "Bearer screen-one" },
        ip: "203.0.113.9",
      }),
    ).toBe(key);
    expect(
      deviceRequestKey({
        headers: { authorization: "Bearer screen-two" },
        ip: "198.51.100.7",
      }),
    ).not.toBe(key);
    expect(deviceRequestKey({ headers: {}, ip: "198.51.100.7" })).toBe(
      "address:198.51.100.7",
    );
    expect(deviceRequestKey({ headers: {}, ip: "2001:db8:0:1::7" })).toBe(
      deviceRequestKey({ headers: {}, ip: "2001:db8:0:1:ffff::9" }),
    );
  });

  it("gives each screen behind one address its own budget", async () => {
    const send = await screenApp();
    for (const screen of ["one", "two"]) {
      expect((await send(screen)).statusCode).toBe(200);
      expect((await send(screen)).statusCode).toBe(200);
    }
    const exhausted = await send("one");
    expect(exhausted.statusCode).toBe(429);
    expect(exhausted.json()).toMatchObject({
      error: { code: "RATE_LIMITED" },
    });
    expect(Number(exhausted.headers["retry-after"])).toBeGreaterThan(0);
    expect(exhausted.headers["x-ratelimit-limit"]).toBeUndefined();
  });

  it("bounds every credential from one address under the address ceiling", async () => {
    const send = await screenApp();
    for (const screen of ["one", "two", "three", "four", "five"])
      expect((await send(screen)).statusCode).toBe(200);
    const flooded = await send("six");
    expect(flooded.statusCode).toBe(429);
    expect(flooded.json()).toMatchObject({ error: { code: "RATE_LIMITED" } });
    expect(Number(flooded.headers["retry-after"])).toBeGreaterThan(0);
    expect((await send("six", "203.0.113.9")).statusCode).toBe(200);
  });

  it("counts an IPv6 client once per subnet under the ceiling", async () => {
    const send = await screenApp();
    for (const host of ["1", "2", "3", "4", "5"])
      expect((await send(host, `2001:db8:0:1::${host}`)).statusCode).toBe(200);
    expect((await send("six", "2001:db8:0:1:ffff::9")).statusCode).toBe(429);
    expect((await send("six", "2001:db8:0:2::1")).statusCode).toBe(200);
  });

  it("limits requests without a credential per address", async () => {
    const send = await screenApp();
    expect((await send(undefined)).statusCode).toBe(200);
    expect((await send(undefined)).statusCode).toBe(200);
    expect((await send(undefined)).statusCode).toBe(429);
    expect((await send(undefined, "203.0.113.9")).statusCode).toBe(200);
  });
});
