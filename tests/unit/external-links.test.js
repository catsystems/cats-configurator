import { describe, expect, it } from "vitest";
import { isAllowedExternalUrl } from "@/modules/external-links.js";

describe("external link allowlist", () => {
  it("allows the CATS Flights site and CATS GitHub pages", () => {
    expect(isAllowedExternalUrl("https://flights.catsystems.io/")).toBe(true);
    expect(
      isAllowedExternalUrl("https://github.com/catsystems/cats-configurator"),
    ).toBe(true);
  });

  it("rejects untrusted protocols, hosts, credentials, and GitHub paths", () => {
    expect(isAllowedExternalUrl("http://flights.catsystems.io/")).toBe(false);
    expect(isAllowedExternalUrl("https://flights.catsystems.io:444/")).toBe(
      false,
    );
    expect(isAllowedExternalUrl("https://catsystems.io.example.com/")).toBe(
      false,
    );
    expect(
      isAllowedExternalUrl("https://user@example.com/catsystems/project"),
    ).toBe(false);
    expect(isAllowedExternalUrl("https://github.com/other/project")).toBe(
      false,
    );
  });
});
