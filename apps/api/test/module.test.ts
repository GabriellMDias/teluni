import { describe, expect, it, vi } from "vitest";
import pino from "pino";
import { createApp } from "../src/app.js";
import type { AccessTokenVerifier } from "../src/authentication.js";
import type { Database } from "../src/database.js";
import { publicErrorRegistry } from "../src/error-registry.js";
import { coreErrors, errorResponder, maxErrorIssues } from "../src/errors.js";
import { activateModules, type ApiModule } from "../src/module.js";

function exampleModule(overrides: Partial<ApiModule> = {}): ApiModule {
  return {
    name: "example",
    tag: "Example",
    requires: ["database"],
    operations: [],
    errors: {
      EXAMPLE_CONFLICT: {
        status: 409,
        message: "Example conflict.",
        category: "conflict",
        retryable: false,
      },
    },
    activate: () => ({
      name: "example",
      register: (app) => {
        app.get("/example", () => Promise.resolve({ ok: true }));
      },
    }),
    ...overrides,
  };
}

describe("API module composition", () => {
  const database = {} as Database;
  const verifier: AccessTokenVerifier = { verify: () => Promise.resolve(null) };

  it("activates a module only when its requirements are configured", () => {
    const activate = vi.fn(exampleModule().activate);
    const module = exampleModule({ activate });
    expect(activateModules([module], {}, "development")).toEqual([]);
    expect(activate).not.toHaveBeenCalled();
    expect(activateModules([module], { database }, "test")).toHaveLength(1);
    expect(activate).toHaveBeenCalledWith({ database });
  });

  it("refuses production startup when a composed module is unconfigured", () => {
    const module = exampleModule({ requires: ["database", "authentication"] });
    expect(() => activateModules([module], { database }, "production")).toThrow(
      "Invalid API configuration: example requires authentication",
    );
    expect(
      activateModules([module], { database, verifier }, "production"),
    ).toHaveLength(1);
    expect(activateModules([], {}, "production")).toEqual([]);
  });

  it("activates a module only after the modules whose capabilities it uses", () => {
    const provider = exampleModule({ name: "provider", errors: {} });
    const consumer = exampleModule({
      name: "consumer",
      errors: {},
      requiresModules: ["provider"],
    });
    expect(
      activateModules([provider, consumer], { database }, "test").map(
        (module) => module.name,
      ),
    ).toEqual(["example", "example"]);
    const unconfigured = exampleModule({
      name: "provider",
      errors: {},
      requires: ["humanIdentity"],
    });
    expect(
      activateModules([unconfigured, consumer], { database }, "test"),
    ).toEqual([]);
    expect(() =>
      activateModules([unconfigured, consumer], { database }, "production"),
    ).toThrow("Invalid API configuration: provider requires humanIdentity");
    expect(() =>
      activateModules([consumer, provider], { database }, "production"),
    ).toThrow("Invalid API configuration: consumer requires module provider");
  });

  it("mounts active module routes beside the shared health routes", async () => {
    const [active] = activateModules([exampleModule()], { database }, "test");
    const { app, lifecycle } = createApp(pino({ level: "silent" }), undefined, {
      modules: [active],
    });
    lifecycle.markReady();
    try {
      expect((await app.inject({ url: "/example" })).json()).toEqual({
        ok: true,
      });
      expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("adds bounded issues to an envelope only when a module reports them", () => {
    const respond = errorResponder(coreErrors);
    expect(respond("VALIDATION_FAILED", "req_1").body.error).not.toHaveProperty(
      "issues",
    );
    expect(
      respond("VALIDATION_FAILED", "req_1", undefined, undefined, []).body
        .error,
    ).not.toHaveProperty("issues");
    const many = Array.from({ length: maxErrorIssues + 5 }, (_, index) => ({
      path: `/values/${index}`,
      reason: "REQUIRED",
    }));
    const body = respond("VALIDATION_FAILED", "req_1", "trace", undefined, many)
      .body.error;
    expect(body.issues).toHaveLength(maxErrorIssues);
    expect(body.issues?.[0]).toEqual({ path: "/values/0", reason: "REQUIRED" });
  });

  it("merges module errors into one public registry without redefinition", () => {
    const registry = publicErrorRegistry([exampleModule()]);
    expect(Object.keys(registry)).toEqual([
      ...Object.keys(coreErrors),
      "EXAMPLE_CONFLICT",
    ]);
    expect(publicErrorRegistry([])).toEqual(coreErrors);
    expect(() =>
      publicErrorRegistry([
        exampleModule({
          errors: {
            VALIDATION_FAILED: {
              status: 422,
              message: "Different meaning.",
              category: "validation",
              retryable: false,
            },
          },
        }),
      ]),
    ).toThrow("Module example redefines public error VALIDATION_FAILED");
  });

  it("rejects a duplicated public code even when the definitions are identical", () => {
    // Redeclaring a shared code verbatim still gives it a second owner.
    expect(() =>
      publicErrorRegistry([
        exampleModule({
          errors: { VALIDATION_FAILED: coreErrors.VALIDATION_FAILED },
        }),
      ]),
    ).toThrow(
      "Module example redefines public error VALIDATION_FAILED, already defined by the shared runtime",
    );
    // Two modules may not share a code, identical or not.
    const first = exampleModule();
    const second = exampleModule({ name: "second" });
    expect(first.errors).toEqual(second.errors);
    expect(() => publicErrorRegistry([first, second])).toThrow(
      "Module second redefines public error EXAMPLE_CONFLICT, already defined by module example",
    );
    expect(() =>
      publicErrorRegistry([
        first,
        exampleModule({
          name: "third",
          errors: {
            EXAMPLE_CONFLICT: {
              ...first.errors.EXAMPLE_CONFLICT,
              message: "Different meaning.",
            },
          },
        }),
      ]),
    ).toThrow(
      "Module third redefines public error EXAMPLE_CONFLICT, already defined by module example",
    );
  });
});
