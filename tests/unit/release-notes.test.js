import { mount, flushPromises } from "@vue/test-utils";
import { describe, expect, it, vi } from "vitest";
import ReleaseNotes from "@/components/ReleaseNotes.vue";

describe("release notes", () => {
  it("makes bare changelog URLs clickable through the native host", async () => {
    window.cats = {
      app: { openExternal: vi.fn().mockResolvedValue(undefined) },
    };
    const changelog =
      "https://github.com/catsystems/cats-embedded/compare/v3.0.2...2026.09";
    const wrapper = mount(ReleaseNotes, {
      props: {
        notes: `**Full changelog:** ${changelog}\n\nVersion 1.2.3, telemetry.bin`,
      },
    });
    expect(wrapper.findAll("a")).toHaveLength(1);
    expect(wrapper.find("a").attributes("href")).toBe(changelog);
    await wrapper.find("a").trigger("click");
    await flushPromises();
    expect(window.cats.app.openExternal).toHaveBeenCalledWith(changelog);
    wrapper.unmount();
  });

  it("renders headings, GitHub tables, lists and code", () => {
    const wrapper = mount(ReleaseNotes, {
      props: {
        notes:
          "## Firmware versions\n\n| Component | Version |\n| --- | --- |\n| Ground Station | `1.3.0` |\n\n- Updated radios\n- Fixed USB\n\n```text\ntelemetry-1.2.0.bin\n```",
      },
    });
    expect(wrapper.find("h2").text()).toBe("Firmware versions");
    expect(wrapper.findAll("th")).toHaveLength(2);
    expect(wrapper.find("td code").text()).toBe("1.3.0");
    expect(wrapper.findAll("li")).toHaveLength(2);
    expect(wrapper.find("pre code").text()).toContain("telemetry-1.2.0.bin");
  });

  it("keeps HTML inert and rejects executable links and remote images", () => {
    const wrapper = mount(ReleaseNotes, {
      props: {
        notes:
          '<script>alert(1)</script>\n\n<img src="x" onerror="alert(1)">\n\n[bad](javascript:alert(1))\n\n[data](data:text/html,test)\n\n![tracking](https://example.com/pixel.png)',
      },
    });
    expect(wrapper.find("script, img, iframe").exists()).toBe(false);
    expect(
      wrapper
        .findAll("a")
        .every((link) => !/^(javascript|data):/i.test(link.attributes("href"))),
    ).toBe(true);
    expect(wrapper.text()).toContain("<script>");
  });

  it("opens release-relative links through the native host and reports denied links", async () => {
    window.cats = {
      app: { openExternal: vi.fn().mockResolvedValue(undefined) },
    };
    const wrapper = mount(ReleaseNotes, {
      props: {
        notes: "[Changes](/catsystems/cats-embedded/compare/a...b)",
        releaseUrl:
          "https://github.com/catsystems/cats-embedded/releases/tag/2026.09",
      },
    });
    await wrapper.find("a").trigger("click");
    await flushPromises();
    expect(window.cats.app.openExternal).toHaveBeenCalledWith(
      "https://github.com/catsystems/cats-embedded/compare/a...b",
    );
    window.cats.app.openExternal.mockRejectedValue(
      new Error("Link is not approved"),
    );
    await wrapper.find("a").trigger("click");
    await flushPromises();
    expect(wrapper.emitted("error")[0]).toEqual(["Link is not approved"]);
    await wrapper.setProps({ notes: "[local](file:///C:/Windows/test)" });
    expect(wrapper.find("a").exists()).toBe(false);
  });
});
