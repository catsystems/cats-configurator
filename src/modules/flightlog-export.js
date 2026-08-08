export const FLIGHT_LOG_SECTIONS = Object.freeze([
  "imu",
  "baro",
  "flightInfo",
  "orientationInfo",
  "filteredDataInfo",
  "gnssInfo",
  "flightStates",
  "eventInfo",
  "voltageInfo",
]);

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function getCSVColumnNames(record, prefix = "") {
  if (!isPlainObject(record)) return [];

  return Object.entries(record).flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key;
    return isPlainObject(value) ? getCSVColumnNames(value, path) : [path];
  });
}

export function getObjectValue(record, objectPath) {
  return objectPath.split(".").reduce((value, key) => value?.[key], record);
}

export function escapeCSVField(value, separator = ",") {
  if (value === null || value === undefined) return "";
  const text =
    typeof value === "object" ? JSON.stringify(value) : String(value);

  if (
    text.includes(separator) ||
    text.includes('"') ||
    text.includes("\n") ||
    text.includes("\r")
  ) {
    return `"${text.replaceAll('"', '""')}"`;
  }
  return text;
}

export function objectArrayToCSV(records, separator = ",") {
  if (!Array.isArray(records)) {
    throw new TypeError("CSV input must be an array.");
  }
  if (records.length === 0) return "No data recorded";

  const columns = [
    ...new Set(records.flatMap((record) => getCSVColumnNames(record))),
  ];
  const header = columns.map((column) => escapeCSVField(column, separator));
  const rows = records.map((record) =>
    columns.map((column) =>
      escapeCSVField(getObjectValue(record, column), separator),
    ),
  );

  return [header, ...rows].map((row) => row.join(separator)).join("\n");
}

export function serializeForInlineScript(value) {
  return JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

export function createStandalonePlotHtml(
  template,
  plotlySource,
  flightLog,
  useImperialUnits,
) {
  const safePlotlySource = plotlySource.replace(/<\/script/gi, "<\\/script");

  return template
    .replace("/* PLOTLY_PLACEHOLDER */", () => safePlotlySource)
    .replace("/* FLIGHTLOG_PLACEHOLDER */", () =>
      serializeForInlineScript(flightLog),
    )
    .replace("/* USE_IMPERIAL_UNITS_PLACEHOLDER */", () =>
      String(Boolean(useImperialUnits)),
    );
}
