import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { magpieLinkBaseUrl, magpieLinkPath, NO_MAGPIE_LINK, parseMagpieLink } from "./magpie-link";

describe("Magpie link file", () => {
  it("is ~/.config/openbot/magpie.json, as the agent plugin names it", () => {
    expect(magpieLinkPath("C:\\Users\\u")).toBe(join("C:\\Users\\u", ".config", "openbot", "magpie.json"));
  });

  it("reads the model, address and key that Magpie writes", () => {
    expect(
      parseMagpieLink(
        '{"model":"auto/deepseek-v4.1-flash","baseUrl":"http://127.0.0.1:3425","apiKey":"magpie-openbot"}',
      ),
    ).toEqual({ model: "auto/deepseek-v4.1-flash", baseUrl: "http://127.0.0.1:3425", apiKey: "magpie-openbot" });
  });

  it("gives no values for an empty object, a missing key or a file that is not a JSON object", () => {
    expect(parseMagpieLink("{}")).toEqual(NO_MAGPIE_LINK);
    expect(parseMagpieLink("")).toEqual(NO_MAGPIE_LINK);
    expect(parseMagpieLink("[1]")).toEqual(NO_MAGPIE_LINK);
    expect(parseMagpieLink("{broken")).toEqual(NO_MAGPIE_LINK);
    expect(parseMagpieLink('{"model":"auto/x"}')).toEqual({ model: "auto/x", baseUrl: null, apiKey: null });
  });

  it("drops each value that fails its check, and keeps the others", () => {
    expect(parseMagpieLink('{"model":"a b","baseUrl":"http://127.0.0.1:3425","apiKey":42}')).toEqual({
      model: null,
      baseUrl: "http://127.0.0.1:3425",
      apiKey: null,
    });
    expect(parseMagpieLink(JSON.stringify({ model: "x".repeat(201), apiKey: "k\nk" }))).toEqual(NO_MAGPIE_LINK);
  });

  it("takes only a gateway root on this computer", () => {
    expect(magpieLinkBaseUrl("http://127.0.0.1:3425/")).toBe("http://127.0.0.1:3425");
    expect(magpieLinkBaseUrl("http://localhost:3425/v1")).toBe("http://localhost:3425");
    expect(magpieLinkBaseUrl("http://[::1]:3425")).toBe("http://[::1]:3425");
    expect(magpieLinkBaseUrl("https://example.com")).toBeNull();
    expect(magpieLinkBaseUrl("http://192.168.1.2:3425")).toBeNull();
    expect(magpieLinkBaseUrl("file:///etc/passwd")).toBeNull();
    expect(magpieLinkBaseUrl("http://user:pw@127.0.0.1:3425")).toBeNull();
    expect(magpieLinkBaseUrl("http://127.0.0.1:3425/?q=1")).toBeNull();
    expect(magpieLinkBaseUrl(3425)).toBeNull();
  });
});
