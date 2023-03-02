import fs from "fs";

export function exportCSV(flightLog) {
  let csvObject = {
    imu: flightLog.imu,
    baro: flightLog.baro,
    flightInfo: flightLog.flightInfo,
    orientationInf: flightLog.orientationInf,
  }

  fs.writeFile("flightlog.csv", objectToCsv(csvObject), 'utf8', function (err) {
    if (err) {
      console.log("An error occurred while writing CSV Object to File.");
      return console.log(err);
    }
    console.log("CSV file has been saved.");
  });
}

export function exportJSON(flightLog) {
  fs.writeFile("flightlog.json", JSON.stringify(flightLog), 'utf8', function (err) {
    if (err) {
      console.log("An error occurred while writing JSON Object to File.");
      return console.log(err);
    }
    console.log("JSON file has been saved.");
  });
}

function objectToCsv(obj, separator = ",") {

  let flattened = {}
  function headerMaker(item) {
    for (const [key, value] of Object.entries(item)) {
      if (Array.isArray(value)) {
        flattened[key] = value;
      } else if (typeof value === 'object') {
        headerMaker(value);
      }
    }
  }
  headerMaker(obj);

  function transposeArray(array) {
    let arrayLength = array[0].length;
    for (var i = 0; i < array.length; i++) {
      if (array[i].length < arrayLength)
        arrayLength = array[i].length;
    };

    let newArray = [];
    for (var i = 0; i < arrayLength; i++) {
      let sub = []
      for (var j = 0; j < array.length; j++) {
        sub.push(...Object.values(array[j][i]));
      };
      newArray.push(sub)
    };
    return newArray;
  }

  let header = []
  for (const [key, value] of Object.entries(flattened)) {
    for (const sub of Object.keys(value[0])) {
      header.push(key + "." + sub)
    }
  }
  let rows = transposeArray(Object.values(flattened))

  let headerLength = header.length

  let text = header.join(separator) + "\n";
  for (const row of rows) {
    if (row.length != headerLength)
      console.log("length mismatch")
    text += row.join(separator) + "\n";
  }
  return text
}
