import { describe, expect, it } from "vitest";
import {
  createStandalonePlotHtml,
  getCSVColumnNames,
  objectArrayToCSV,
  serializeForInlineScript,
} from "@/modules/flightlog-export.js";

describe("flight-log export helpers", () => {
  it("flattens nested records and escapes CSV fields", () => {
    const records = [
      {
        ts: 1,
        position: { latitude: 46.1, label: 'A, "quoted"\nvalue' },
        samples: [1, 2],
      },
      { ts: 2, position: { latitude: 46.2, label: "B" }, samples: [] },
    ];

    expect(getCSVColumnNames(records[0])).toEqual([
      "ts",
      "position.latitude",
      "position.label",
      "samples",
    ]);

    const csv = objectArrayToCSV(records);
    expect(csv).toContain("ts,position.latitude,position.label,samples");
    expect(csv).toContain('"A, ""quoted""\nvalue"');
    expect(csv).toContain('"[1,2]"');
  });

  it("serializes data without allowing a script breakout", () => {
    const serialized = serializeForInlineScript({ value: "</script><b>" });
    expect(serialized).not.toContain("</script>");
    expect(serialized).toContain("\\u003c/script\\u003e");
  });

  it("creates an offline HTML document with no unresolved placeholders", () => {
    const template = `
      <script>/* PLOTLY_PLACEHOLDER */</script>
      <script>const log = /* FLIGHTLOG_PLACEHOLDER */;
      const imperial = /* USE_IMPERIAL_UNITS_PLACEHOLDER */;</script>`;
    const html = createStandalonePlotHtml(
      template,
      "window.Plotly = {}; // </script>",
      { label: "test" },
      true,
    );

    expect(html).toContain("window.Plotly");
    expect(html).toContain("<\\/script>");
    expect(html).toContain('{"label":"test"}');
    expect(html).toContain("const imperial = true");
    expect(html).not.toContain("PLACEHOLDER");
    expect(html).not.toContain("https://");
  });
});
