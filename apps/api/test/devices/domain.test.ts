import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  credentialHash,
  decode32Bytes,
  DeviceFailure,
  deviceName,
  devicePolicy,
  displayUserCode,
  generateUserCode,
  normalizeReport,
  normalizeUserCode,
  requireSupportedRotation,
  userCodeHmac,
  type DeviceReport,
} from "../../src/features/devices/domain.js";

const report: DeviceReport = {
  appVersion: "1.0.0",
  protocolVersion: 1,
  manufacturer: "Synthetic",
  model: "Player",
  osVersion: "14",
  display: { width: 1920, height: 1080 },
  rotations: [90, 0],
};

const failure = (action: () => unknown) => {
  try {
    action();
  } catch (error) {
    return error instanceof DeviceFailure ? error.code : "other";
  }
  return "none";
};

describe("device domain rules", () => {
  it("generates codes only from the unambiguous alphabet", () => {
    for (let index = 0; index < 200; index += 1) {
      const code = generateUserCode();
      expect(code).toHaveLength(devicePolicy.codeLength);
      for (const character of code)
        expect(devicePolicy.codeAlphabet).toContain(character);
      expect(normalizeUserCode(displayUserCode(code))).toBe(code);
    }
  });

  it("normalizes case, spaces and hyphens and rejects anything else", () => {
    expect(normalizeUserCode(" bcdf-ghjk ")).toBe("BCDFGHJK");
    expect(normalizeUserCode("BCDF GHJK")).toBe("BCDFGHJK");
    for (const input of [
      "BCDF-GHJ",
      "BCDF-GHJKL",
      "ABCD-EFGH",
      "BCDF-GHJ1",
      "",
    ])
      expect(normalizeUserCode(input)).toBeNull();
  });

  it("keys code HMACs so a key change changes the stored value", () => {
    const one = userCodeHmac(Buffer.alloc(32, 1), "BCDFGHJK");
    expect(one).toHaveLength(32);
    expect(one.equals(userCodeHmac(Buffer.alloc(32, 1), "BCDFGHJK"))).toBe(
      true,
    );
    expect(one.equals(userCodeHmac(Buffer.alloc(32, 2), "BCDFGHJK"))).toBe(
      false,
    );
  });

  it("accepts only 32-byte base64url credentials and stores their SHA-256", () => {
    const bytes = Buffer.alloc(32, 7);
    const credential = bytes.toString("base64url");
    expect(decode32Bytes(credential)?.equals(bytes)).toBe(true);
    expect(
      credentialHash(credential)?.equals(
        createHash("sha256").update(bytes).digest(),
      ),
    ).toBe(true);
    for (const value of [
      Buffer.alloc(31).toString("base64url"),
      `${credential}=`,
      credential.replace(/./, "+"),
      "",
    ])
      expect(credentialHash(value)).toBeNull();
  });

  it("validates names and supported rotations", () => {
    expect(deviceName("  Caixa 1 ")).toBe("Caixa 1");
    for (const value of ["", "   ", "a".repeat(81), "Tela\u0007"])
      expect(failure(() => deviceName(value))).toBe("VALIDATION_FAILED");
    expect(normalizeReport(report).rotations).toEqual([0, 90]);
    expect(
      failure(() => normalizeReport({ ...report, rotations: [0, 0] })),
    ).toBe("VALIDATION_FAILED");
    expect(failure(() => requireSupportedRotation(report, 90))).toBe("none");
    expect(failure(() => requireSupportedRotation(report, 180))).toBe(
      "ROTATION_UNSUPPORTED",
    );
  });
});
