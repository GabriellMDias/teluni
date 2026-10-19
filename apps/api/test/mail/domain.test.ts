import { describe, expect, it } from "vitest";
import {
  classifySendError,
  escapeHtml,
  maxAttempts,
  retryDelay,
} from "../../src/features/mail/domain.js";

describe("mail delivery rules", () => {
  it("spaces retries from about a minute to twelve hours and stops after the last attempt", () => {
    const middle = () => 0.5;
    expect(retryDelay(1, middle)).toBe(60_000);
    expect(retryDelay(7, middle)).toBe(43_200_000);
    expect(retryDelay(1, () => 0)).toBe(48_000);
    expect(retryDelay(1, () => 1)).toBe(72_000);
    expect(retryDelay(maxAttempts, middle)).toBeNull();
    const total = Array.from({ length: maxAttempts - 1 }, (_, index) =>
      retryDelay(index + 1, middle),
    ).reduce((sum: number, delay) => sum + (delay ?? 0), 0);
    expect(total / 3_600_000).toBeCloseTo(22.35, 1);
  });

  it("fails only permanent SMTP rejections at once", () => {
    expect(classifySendError({ responseCode: 550, code: "EENVELOPE" })).toEqual(
      { kind: "permanent", failure: "rejected", replyCode: 550 },
    );
    expect(classifySendError({ responseCode: 451 })).toMatchObject({
      kind: "transient",
      failure: "rejected",
    });
    expect(
      classifySendError({ responseCode: 535, code: "EAUTH" }),
    ).toMatchObject({ kind: "transient", failure: "authentication" });
    expect(classifySendError({ code: "ETIMEDOUT" })).toMatchObject({
      kind: "transient",
      failure: "timeout",
    });
    expect(classifySendError({ code: "ECONNECTION" })).toMatchObject({
      failure: "connection",
    });
    expect(classifySendError(new Error("boom"))).toMatchObject({
      kind: "transient",
      failure: "unexpected",
    });
  });

  it("escapes text for HTML templates", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe(
      "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;",
    );
  });
});
