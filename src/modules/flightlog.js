import { dialog } from "electron";
import fs from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import plotsTemplate from "../../templates/plots.html?raw";
import { formatDateTime } from "@/utils/date.js";
import {
  createStandalonePlotHtml,
  FLIGHT_LOG_SECTIONS,
  objectArrayToCSV,
} from "./flightlog-export.js";

const requireFromMain = createRequire(import.meta.url);

function exportName(filename, suffix) {
  return `${filename}_${suffix}_${formatDateTime(new Date())}`;
}

export async function exportFlightLogToCSVs(flightLog, filename, ownerWindow) {
  const selection = await dialog.showOpenDialog(ownerWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;

  const exportFolder = path.join(
    selection.filePaths[0],
    exportName(filename, "export"),
  );
  await fs.mkdir(exportFolder);

  await Promise.all(
    FLIGHT_LOG_SECTIONS.map((section) =>
      fs.writeFile(
        path.join(exportFolder, `${section}.csv`),
        objectArrayToCSV(flightLog[section] ?? []),
        "utf8",
      ),
    ),
  );

  return exportFolder;
}

export async function exportFlightLogChartsToHTML(
  flightLog,
  useImperialUnits,
  filename,
  ownerWindow,
) {
  const selection = await dialog.showOpenDialog(ownerWindow, {
    properties: ["openDirectory", "createDirectory"],
  });
  if (selection.canceled || selection.filePaths.length === 0) return null;

  const outputPath = path.join(
    selection.filePaths[0],
    `${exportName(filename, "plots")}.html`,
  );
  const plotlySource = await fs.readFile(
    requireFromMain.resolve("plotly.js-dist-min"),
    "utf8",
  );
  const html = createStandalonePlotHtml(
    plotsTemplate,
    plotlySource,
    flightLog,
    useImperialUnits,
  );
  await fs.writeFile(outputPath, html, "utf8");
  return outputPath;
}
