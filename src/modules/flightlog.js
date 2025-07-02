import fs from "fs";
import path from "path";
import { dialog } from "electron";
import { formatDateTime } from "@/utils/date.js";
import { flightLogFilename } from "./ipc.js";

export function exportFlightLogToCSVs(flightLog) {
  let flightLogSections = ["imu", "baro", "flightInfo", "orientationInfo", "filteredDataInfo", "gnssInfo", "flightStates", "eventInfo", "voltageInfo"];

  let paths = dialog.showOpenDialogSync({ properties: ["openDirectory"] });

  if (!paths) {
    throw new Error("No directory selected for export.");
  }

  const userFolderPath = path.join(paths[0]);
  const exportFolderPath = `${userFolderPath}/${flightLogFilename}_export_${formatDateTime(new Date())}`;

  fs.mkdirSync(`${exportFolderPath}`);

  for (let flightLogSection of flightLogSections) {
    fs.writeFile(`${exportFolderPath}/${flightLogSection}.csv`, objectArrayToCSV(flightLogSection, flightLog[flightLogSection]), "utf8", function (err) {
      if (err) {
        throw new Error(`An error occurred while writing CSV object to file.`);
      }
    });
  }
}

export function exportFlightLogChartsToHTML(flightLog, useImperialUnits) {
  let paths = dialog.showOpenDialogSync({ properties: ["openDirectory"] });

  if (!paths) {
    throw new Error("No directory selected for export.");
  }

  const exportFolderPath = path.join(paths[0]);

  const flightlogJson = JSON.stringify(flightLog);
  const useImperialUnitsString = String(useImperialUnits);

  let plotsHTML = fs.readFileSync(path.join(__dirname, '../templates/plots.html'), 'utf8');

  plotsHTML = plotsHTML.replace("/* FLIGHTLOG_PLACEHOLDER */", flightlogJson);
  plotsHTML = plotsHTML.replace("/* USE_IMPERIAL_UNITS_PLACEHOLDER */", useImperialUnitsString);

  fs.writeFile(`${exportFolderPath}/${flightLogFilename}_plots_${formatDateTime(new Date())}.html`, plotsHTML, 'utf8', function (err) {
    if (err) {
      console.log("An error occurred while writing HTML Object to File.");
      return console.log(err);
    }
    console.log("HTML file has been saved.");
  });
}

export function exportJSON(flightLog) {
  fs.writeFile("flightlog.json", JSON.stringify(flightLog), "utf8", function (err) {
    if (err) {
      console.log("An error occurred while writing JSON Object to File.");
      return console.log(err);
    }
    console.log("JSON file has been saved.");
  });
}

function objectArrayToCSV(section, arr, separator = ",") {
  if (!Array.isArray(arr)) {
    console.log("objectArrayToCSV first argument must be an array.");
    return;
  }

  if (arr.length > 0) {
    console.log("Section " + section + " :" + arr[0])
    let CSVColumnNames = getCSVColumnNames(arr[0]);

    let CSVHeader = CSVColumnNames.join(separator);
    let CSVBody = arr.map(obj => 
      CSVColumnNames.map(header => getObjectValue(obj, header)).join(separator)
    ).join("\n");

    return CSVHeader + "\n" + CSVBody;
  } else {
    console.log("Array length of " + section + " is 0!");
    return "No data recorded"
  }
}

function getCSVColumnNames(obj) {
  let headerSet = new Set();

  for (let key of Object.keys(obj)) {
      if (typeof obj[key] == "object") {
          headerSet = new Set(...headerSet, extractCSVHeaders(obj[key]).map(v => `${key}.${v}`));
      }
      else headerSet.add(key); 
  };

  return [...headerSet];
};

function getObjectValue(obj, path) {
  let value = obj;

  for (let key of path.split(".")) {
      value = value?.[key];
      if (value === undefined) return value;
  }

  return value;
};
