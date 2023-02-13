import { ipcMain, dialog } from "electron";
import fs from "fs";

import { connect, disconnect, command, cliCommand, getList } from "./serial.js";

export function subscribeListeners() {
  ipcMain.on("BOARD:CONFIG", async (event, key) => {
    command(`get ${key}`);
  });

  ipcMain.on("BOARD:SET_CONFIG", async (event, [key, value]) => {
    if (!key) return;
    command(`set ${key} = ${value}`);
  });

  ipcMain.on("BOARD:EVENTS", async (event, key) => {
    command(`get ${key}`);
  });

  ipcMain.on("BOARD:TIMERS", async (event, key) => {
    command(`get ${key}_start`);
    command(`get ${key}_duration`);
    command(`get ${key}_trigger`);
  });

  ipcMain.on("BOARD:INFO", () => {
    command("status");
  });

  ipcMain.on("BOARD:LOG_INFO", () => {
    command("rec_info");
  });

  ipcMain.on("BOARD:DUMP", () => {
    command("dump");
  });

  ipcMain.on("BOARD:RESTORE", (event) => {
    let paths = dialog.showOpenDialogSync({ properties: ["openFile"] });

    if (paths) {
      let data = fs.readFileSync(paths[0], { encoding: "utf8" });
      if (data && data.length) {
        data = data.split("\n");
        data.forEach((cmd) => {
          command(cmd);
        });
      }
    }

    event.sender.send("BOARD:RESTORE");
  });

  ipcMain.on("LOAD_FLIGHTLOG", (event) => {
    let paths = dialog.showOpenDialogSync({
      properties: ["openFile"],
      options: {
        filters: [{ name: "Log Files", extensions: ["cfl"] }]
      }
    });

    console.log(paths)

    if (paths) {
      if (!paths[0].toLowerCase().endsWith(".cfl")) {
        event.sender.send("LOAD_FLIGHTLOG", null)
      }

      let data = fs.readFileSync(paths[0], { encoding: "binary" });
      

      if (data && data.length) {
        parseFlightLog(data, function(parsed) {
          event.sender.send("LOAD_FLIGHTLOG", parsed)
        })
      }
    }
  });

  ipcMain.on("BOARD:RESET_CONFIG", () => {
    command("defaults");
  });

  ipcMain.on("BOARD:SAVE", async () => {
    command("save");
  });

  ipcMain.on("CLI_COMMAND", (event, cmd) => {
    cliCommand(cmd);
  });

  ipcMain.on("CONNECT", (event, path) => {
    connect(path);
  });

  ipcMain.on("DISCONNECT", () => {
    disconnect();
  });

  ipcMain.on("FETCH_SERIAL_PORTS", async (event) => {
    const ports = await getList();
    event.sender.send("FETCH_SERIAL_PORTS", ports);
  });
}

function parseFlightLog(data, callback) {
  console.log("yey")
  console.log(data.length)
  parseLog(data)
  setTimeout(function(){
    callback("I parsed this shit");
  }, 1000)
}

const REC_TYPE = {
  IMU: 1 << 4,
  BARO: 1 << 5,
  FLIGHT_INFO: 1 << 6,
  ORIENTATION_INFO: 1 << 7,
  FILTERED_DATA_INFO : 1 << 8,
  FLIGHT_STATE: 1 << 9,
  EVENT_INFO: 1 << 10,
  ERROR_INFO: 1 << 11,
  GNSS_INFO: 1 << 12,
  VOLTAGE_INFO: 1 << 13
};

const REC_ID_MASK = 0x0000000F;

function getIdFromRecordType(recType) {
  return recType & REC_ID_MASK;
}

function getRecordTypeWithoutId(recType) {
  return recType & ~REC_ID_MASK;
}


function parseLog(log_b) {
  let imu = [];
  let baro = [];
  let flightInfo = [];
  let orientationInfo = [];
  let filteredDataInfo = [];
  let flightStates = [];
  let eventInfo = [];
  let errorInfo = [];
  let voltageInfo = [];
  let i = 0;
  let firstTs = -1;
  let lastTs = -1;
  

  let lB = Buffer.from(log_b, 'binary')

  console.log(lB)
  
  try {
    while (i < lB.length) {
      let [ts, t] = [lB.readUInt32LE(i), lB.readUInt32LE(i + 4)];
      let sensorId = getIdFromRecordType(t);
      let tWithoutId = getRecordTypeWithoutId(t);
      i += 8;
      if (firstTs === -1) {
        firstTs = ts;
      }
      if (tWithoutId === REC_TYPE.IMU) {
        let [accX, accY, accZ, gyroX, gyroY, gyroZ] = [lB.readInt16LE(i), lB.readInt16LE(i+2), lB.readInt16LE(i+4),
          lB.readInt16LE(i+6), lB.readInt16LE(i+8), lB.readInt16LE(i+10)];
        imu.push({
          ts: ts,
          id: `IMU${sensorId}`,
          Ax: accX,
          Ay: accY,
          Az: accZ,
          Gx: gyroX,
          Gy: gyroY,
          Gz: gyroZ
        });
        i += 12;
      } else if (tWithoutId === REC_TYPE.BARO) {
        let [pressure, temperature] = [lB.readUint32LE(i), lB.readUint32LE(i+4)];
        baro.push({
          ts: ts,
          id: `BARO${sensorId}`,
          T: temperature,
          P: pressure
        });
        i += 8;
      } else if (tWithoutId === REC_TYPE.FLIGHT_INFO) {
        let [height, velocity, acceleration] = [lB.readFloatLE(i), lB.readFloatLE(i+4), lB.readFloatLE(i+8)];
  
        flightInfo.push({
          ts: ts,
          height: height,
          velocity: velocity,
          acceleration: acceleration
        });
        i += 12;
      } else if (tWithoutId === REC_TYPE.ORIENTATION_INFO) {
          let [est_0, est_1, est_2, est_3] = [lB.readInt16LE(i), lB.readInt16LE(i+2), lB.readInt16LE(i+4), lB.readInt16LE(i+6)];
    
          orientationInfo.push({
            ts: ts,
            q0_estimated: est_0,
            q1_estimated: est_1,
            q2_estimated: est_2,
            q3_estimated: est_3,
          });
          i += 8;
      } else if (tWithoutId === REC_TYPE.FILTERED_DATA_INFO) {
        let [filteredAltitudeAGL, filteredAcceleration] = [lB.readFloatLE(i), lB.readFloatLE(i+4)];
        filteredDataInfo.push({
          ts: ts,
          filteredAltitudeAGL: filteredAltitudeAGL,
          filteredAcceleration: filteredAcceleration
        });
        i += 8;
      } else if (tWithoutId === REC_TYPE.FLIGHT_STATE) {
        let state = lB.readUint32LE(i);
        flightStates.push({
          ts: ts,
          state: state
        });
        console.log(state)
        i += 4;
      } else if (tWithoutId === REC_TYPE.EVENT_INFO) {
        let [event, outIdx] = [lB.readUint32LE(i), lB.readUint8(i+4)];
        eventInfo.push({
          ts: ts,
          event: event,
          outIdx: outIdx
        });
        i += 8;
      } else if (tWithoutId === REC_TYPE.ERROR_INFO) {
        let error = lB.readUint32LE(i);
        errorInfo.push({
          ts: ts,
          error: error
        });
        i += 4;
      } else if (tWithoutId === REC_TYPE.GNSS_INFO) {
        // Nothing to plot yet
        i += 9;
      } else if (tWithoutId === REC_TYPE.VOLTAGE_INFO) {
        let voltage = lB.readUint16LE(i);
        voltageInfo.push({
          ts: ts,
          voltage: voltage
        });
        i += 2;
      } else {
        console.log(t);
        console.log(`ERROR at ${i}`);
        break;
      }
      lastTs = ts;
    }
  } catch (e) {
    console.log(`Parsing ended with error: ${e}`);
  } finally {
    console.log(`Parsing ended at position: ${i}/${log_b.length}`)
  }
  console.log(eventInfo);
}
