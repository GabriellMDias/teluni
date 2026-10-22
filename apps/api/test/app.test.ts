import { Writable } from "node:stream";
import pino from "pino";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";

function testLogger(lines: string[]) {
  return pino(
    {
      level: "info",
      redact: { paths: ["*.authorization", "*.token"], censor: "[REDACTED]" },
    },
    new Writable({
      write(chunk, _encoding, callback) {
        lines.push(String(chunk));
        callback();
      },
    }),
  );
}

describe("Fastify transport boundary", () => {
  it("takes the client address from X-Forwarded-For only behind a trusted proxy", async () => {
    const addressOf = async (trustedProxies: readonly string[]) => {
      const { app, lifecycle } = createApp(testLogger([]), undefined, {
        trustedProxies,
      });
      app.get("/test/address", (request) => ({ ip: request.ip }));
      lifecycle.markReady();
      const seen = async (remoteAddress: string) =>
        (
          await app.inject({
            method: "GET",
            url: "/test/address",
            remoteAddress,
            headers: { "x-forwarded-for": "203.0.113.7" },
          })
        ).json<{ ip: string }>().ip;
      const result = {
        fromProxy: await seen("172.20.0.5"),
        fromElsewhere: await seen("198.51.100.9"),
      };
      await app.close();
      return result;
    };
    expect(await addressOf(["172.20.0.0/16"])).toEqual({
      fromProxy: "203.0.113.7",
      fromElsewhere: "198.51.100.9",
    });
    expect(await addressOf([])).toEqual({
      fromProxy: "172.20.0.5",
      fromElsewhere: "198.51.100.9",
    });
  });

  it("uses TypeBox request validation and response serialization", async () => {
    const { app, lifecycle } = createApp(testLogger([]));
    app.post(
      "/test/echo",
      {
        schema: {
          body: Type.Object(
            { value: Type.Integer() },
            { additionalProperties: false },
          ),
          response: {
            200: Type.Object(
              { value: Type.Integer() },
              { additionalProperties: false },
            ),
          },
        },
      },
      (request) => ({
        value: request.body.value,
        ignored: "never serialize",
      }),
    );
    lifecycle.markReady();
    const invalid = await app.inject({
      method: "POST",
      url: "/test/echo",
      payload: { value: "bad" },
    });
    expect(invalid.statusCode).toBe(400);
    const invalidBody = invalid.json<{
      error: { code: string; requestId: string };
    }>();
    expect(invalidBody.error.code).toBe("VALIDATION_FAILED");
    expect(invalidBody.error.requestId).toBe(invalid.headers["x-request-id"]);
    const valid = await app.inject({
      method: "POST",
      url: "/test/echo",
      payload: { value: 7 },
    });
    expect(valid.json()).toEqual({ value: 7 });
    await app.close();
  });

  it("keeps concurrent request identifiers isolated and ignores inbound identifiers", async () => {
    const { app, lifecycle } = createApp(testLogger([]));
    app.get("/test/id", async (request) => {
      await new Promise((resolve) => setTimeout(resolve, Math.random() * 10));
      return { id: request.id };
    });
    lifecycle.markReady();
    const responses = await Promise.all(
      Array.from({ length: 20 }, (_, i) =>
        app.inject({
          url: "/test/id",
          headers: { "x-request-id": `attacker-${i}` },
        }),
      ),
    );
    const ids = responses.map((response) => response.json<{ id: string }>().id);
    expect(new Set(ids).size).toBe(20);
    responses.forEach((response, index) => {
      expect(response.headers["x-request-id"]).toBe(ids[index]);
      expect(ids[index]).toMatch(/^req_[0-9a-f-]+$/);
    });
    await app.close();
  });

  it("returns safe health and error responses with one unexpected-error diagnostic", async () => {
    const lines: string[] = [];
    const { app, lifecycle } = createApp(testLogger(lines));
    app.get("/test/fail", () => {
      throw new Error("secret-password=do-not-leak");
    });
    const before = await app.inject("/health/ready");
    expect(before.statusCode).toBe(503);
    expect(before.json()).toEqual({ status: "unavailable" });
    lifecycle.markReady();
    expect((await app.inject("/health/startup")).json()).toEqual({
      status: "ok",
    });
    expect((await app.inject("/health/live")).json()).toEqual({ status: "ok" });
    expect((await app.inject("/health/ready")).json()).toEqual({
      status: "ok",
    });
    const error = await app.inject("/test/fail");
    expect(error.statusCode).toBe(500);
    const errorBody = error.json<{
      error: { code: string; requestId: string; errorId: string };
    }>();
    expect(errorBody.error).toMatchObject({
      code: "INTERNAL_ERROR",
      requestId: error.headers["x-request-id"],
    });
    expect(errorBody.error.errorId).toMatch(/^err_/);
    expect(JSON.stringify(error.json())).not.toContain("secret-password");
    expect(lines.join("")).not.toContain("secret-password");
    expect(
      lines.filter((line) => line.includes("unhandled_request_error")),
    ).toHaveLength(1);
    const missing = await app.inject("/missing");
    expect(missing.json<{ error: { code: string } }>().error.code).toBe(
      "RESOURCE_NOT_FOUND",
    );
    lifecycle.beginDrain();
    expect((await app.inject("/health/ready")).statusCode).toBe(503);
    expect((await app.inject("/health/live")).statusCode).toBe(200);
    expect((await app.inject("/test/fail")).statusCode).toBe(503);
    await app.close();
  });
});
