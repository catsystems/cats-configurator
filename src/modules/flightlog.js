import fs from "fs";

export function exportFlightLogToCSVs(flightLog) {
  const flightLogDir = "flight-log-export"
  let flightLogSections = ["imu", "baro", "flightInfo", "orientationInfo", "filteredDataInfo", "flightStates", "eventInfo", "voltageInfo"];

  if (!fs.existsSync(flightLogDir)){
    fs.mkdirSync(flightLogDir);
  }

  for (let flightLogSection of flightLogSections) {
    fs.writeFile(`${flightLogDir}/${flightLogSection}.csv`, objectArrayToCSV(flightLog[flightLogSection]), "utf8", function (err) {
      if (err) {
        console.log("An error occurred while writing CSV object to file.");
        return console.log(err);
      }
      console.log("CSV file has been saved.");
    });
  }
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

function objectArrayToCSV(arr, separator = ",") {
  if (!Array.isArray(arr)) {
    console.log("objectArrayToCSV first argument must be an array.");
    return;
  }

  let CSVColumnNames = getCSVColumnNames(arr[0]);

  let CSVHeader = CSVColumnNames.join(separator);
  let CSVBody = arr.map(obj => 
    CSVColumnNames.map(header => getObjectValue(obj, header)).join(separator)
  ).join("\n");

  return CSVHeader + "\n" + CSVBody;
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
