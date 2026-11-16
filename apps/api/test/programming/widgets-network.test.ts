import { EventEmitter } from "node:events";
import type { LookupFunction } from "node:net";
import { Readable } from "node:stream";
import { beforeEach, expect, it, vi } from "vitest";
type FakeResponse = Readable & {
  statusCode: number;
  headers: Record<string, string>;
};
type FakeRequestOptions = {
  lookup: LookupFunction;
  headers: Record<string, string>;
};
const mocks = vi.hoisted(() => ({
  lookup:
    vi.fn<
      (
        host: string,
        options: { all: boolean; verbatim: boolean },
      ) => Promise<{ address: string; family: number }[]>
    >(),
  request:
    vi.fn<
      (
        url: URL,
        options: FakeRequestOptions,
        received: (response: FakeResponse) => void,
      ) => EventEmitter
    >(),
}));
vi.mock("node:dns/promises", () => ({ lookup: mocks.lookup }));
vi.mock("node:https", () => ({ request: mocks.request }));
import {
  fetchWidgetSource,
  WidgetSourceFailure,
} from "../../src/features/programming/widgets-fetch.js";

beforeEach(() => vi.resetAllMocks());
function answer(
  status = 200,
  headers: Record<string, string> = {},
  body = "feed",
) {
  mocks.request.mockImplementation((_url, options, received) => {
    const req = new EventEmitter() as EventEmitter & {
      end(): void;
      destroy(): void;
    };
    req.destroy = () => {
      req.emit("close");
    };
    req.end = () =>
      queueMicrotask(() => {
        options.lookup(
          "source.example.org",
          { all: true },
          (error: unknown, addresses: unknown) => {
            expect(error).toBeNull();
            expect(addresses).toEqual([{ address: "1.1.1.1", family: 4 }]);
          },
        );
        const response = Object.assign(Readable.from([Buffer.from(body)]), {
          statusCode: status,
          headers,
        });
        response.once("close", () => req.emit("close"));
        received(response);
      });
    return req;
  });
}
it("pins the validated public address for Node's family-autoselection lookup", async () => {
  mocks.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  answer();
  expect(await fetchWidgetSource("https://source.example.org/feed")).toEqual({
    body: "feed",
    expires: null,
  });
  expect(mocks.request.mock.calls[0][1].headers["user-agent"]).toContain(
    "Teluni/",
  );
});
it("rejects literal, private and mixed DNS results before opening a connection", async () => {
  for (const addresses of [
    [{ address: "127.0.0.1", family: 4 }],
    [
      { address: "1.1.1.1", family: 4 },
      { address: "10.0.0.1", family: 4 },
    ],
  ]) {
    mocks.lookup.mockResolvedValue(addresses);
    await expect(
      fetchWidgetSource("https://source.example.org/feed"),
    ).rejects.toBeInstanceOf(WidgetSourceFailure);
  }
  await expect(
    fetchWidgetSource("https://127.0.0.1/feed"),
  ).rejects.toBeInstanceOf(WidgetSourceFailure);
  expect(mocks.request).not.toHaveBeenCalled();
});
it("revalidates redirects and refuses a private destination", async () => {
  mocks.lookup
    .mockResolvedValueOnce([{ address: "1.1.1.1", family: 4 }])
    .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }]);
  answer(302, { location: "https://metadata.example.org/private" });
  await expect(
    fetchWidgetSource("https://source.example.org/feed"),
  ).rejects.toBeInstanceOf(WidgetSourceFailure);
  expect(mocks.request).toHaveBeenCalledTimes(1);
});
it("bounds source bytes and refuses encoded responses", async () => {
  mocks.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  answer(200, {}, "x".repeat(512 * 1024 + 1));
  await expect(
    fetchWidgetSource("https://source.example.org/feed"),
  ).rejects.toBeInstanceOf(WidgetSourceFailure);
  answer(200, { "content-encoding": "gzip" });
  await expect(
    fetchWidgetSource("https://source.example.org/feed"),
  ).rejects.toBeInstanceOf(WidgetSourceFailure);
});

it("does not turn an intentionally closed redirect body into a failed next hop", async () => {
  mocks.lookup.mockResolvedValue([{ address: "1.1.1.1", family: 4 }]);
  answer();
  const success = mocks.request.getMockImplementation()!;
  mocks.request.mockImplementationOnce((url, options, received) => {
    const req = success(url, options, (response) => {
      response.statusCode = 301;
      response.headers.location = "https://canonical.example.org/feed";
      received(response);
      queueMicrotask(() =>
        req.emit(
          "error",
          Object.assign(new Error("Closed redirect body"), {
            code: "ECONNRESET",
          }),
        ),
      );
    });
    return req;
  });
  expect(await fetchWidgetSource("https://source.example.org/feed")).toEqual({
    body: "feed",
    expires: null,
  });
  expect(mocks.request).toHaveBeenCalledTimes(2);
});
