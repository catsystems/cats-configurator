const REC_TYPE = {
  IMU: 1 << 4,
  BARO: 1 << 5,
  FLIGHT_INFO: 1 << 6,
  ORIENTATION_INFO: 1 << 7,
  FILTERED_DATA_INFO: 1 << 8,
  FLIGHT_STATE: 1 << 9,
  EVENT_INFO: 1 << 10,
  ERROR_INFO: 1 << 11,
  GNSS_INFO: 1 << 12,
  VOLTAGE_INFO: 1 << 13
};

const REC_ID_MASK = 0x0000000F;

// TODO: These constants are duplicated from plots.js, no idea how to import them here
const COLOR = "rgb(100, 100, 100)"
const EVENT_MAP = {
  0: { name: "ev_moving", color: COLOR },
  1: { name: "ev_ready", color: COLOR },
  2: { name: "ev_liftoff", color: COLOR },
  3: { name: "ev_burnout", color: COLOR },
  4: { name: "ev_apogee", color: COLOR },
  5: { name: "ev_main_deployment", color: COLOR },
  6: { name: "ev_touchdown", color: COLOR },
  7: { name: "ev_custom1", color: COLOR },
  8: { name: "ev_custom2", color: COLOR },
}

function getIdFromRecordType(recType) {
  return recType & REC_ID_MASK;
}

function getRecordTypeWithoutId(recType) {
  return recType & ~REC_ID_MASK;
}

function offsetProperty(readings, prop, offset) {
  readings.forEach(function (reading) {
    if (prop in reading) {
      reading[prop] -= offset;
    }
  });
}

function scaleProperty(readings, prop, scaleFactor) {
  readings.forEach(function (reading) {
    if (prop in reading) {
      reading[prop] /= scaleFactor;
    }
  });
}

function scaleAndOffsetFlightLog(flightLog) {
  // Find start of launch

  let zeroTs = flightLog.firstTs;

  for (let ev of flightLog.eventInfo) {
    if (EVENT_MAP[ev.event].name == "ev_liftoff") {
      zeroTs = ev.ts;
      console.log("Zero TS found: " + ev.ts);
      break;
    }
  }

  flightLog.firstTs -= zeroTs
  flightLog.lastTs -= zeroTs
  flightLog.firstTs /= 1000
  flightLog.lastTs /= 1000

  offsetProperty(flightLog.imu, 'ts', zeroTs)
  offsetProperty(flightLog.baro, 'ts', zeroTs)
  offsetProperty(flightLog.orientationInfo, 'ts', zeroTs)
  offsetProperty(flightLog.flightInfo, 'ts', zeroTs)
  offsetProperty(flightLog.filteredDataInfo, 'ts', zeroTs)
  offsetProperty(flightLog.voltageInfo, 'ts', zeroTs)
  offsetProperty(flightLog.gnssInfo, 'ts', zeroTs)
  offsetProperty(flightLog.eventInfo, 'ts', zeroTs)
  offsetProperty(flightLog.flightStates, 'ts', zeroTs)
  offsetProperty(flightLog.errorInfo, 'ts', zeroTs)

  scaleProperty(flightLog.imu, 'ts', 1000)
  scaleProperty(flightLog.baro, 'ts', 1000)
  scaleProperty(flightLog.orientationInfo, 'ts', 1000)
  scaleProperty(flightLog.flightInfo, 'ts', 1000)
  scaleProperty(flightLog.filteredDataInfo, 'ts', 1000)
  scaleProperty(flightLog.voltageInfo, 'ts', 1000)
  scaleProperty(flightLog.gnssInfo, 'ts', 1000)
  scaleProperty(flightLog.eventInfo, 'ts', 1000)
  scaleProperty(flightLog.flightStates, 'ts', 1000)
  scaleProperty(flightLog.errorInfo, 'ts', 1000)

  scaleProperty(flightLog.imu, 'Gx', 14.28)
  scaleProperty(flightLog.imu, 'Gy', 14.28)
  scaleProperty(flightLog.imu, 'Gz', 14.28)
  scaleProperty(flightLog.imu, 'Ax', 1024 / 9.81)
  scaleProperty(flightLog.imu, 'Ay', 1024 / 9.81)
  scaleProperty(flightLog.imu, 'Az', 1024 / 9.81)

  scaleProperty(flightLog.orientationInfo, 'q0_estimated', 1000)
  scaleProperty(flightLog.orientationInfo, 'q1_estimated', 1000)
  scaleProperty(flightLog.orientationInfo, 'q2_estimated', 1000)
  scaleProperty(flightLog.orientationInfo, 'q3_estimated', 1000)

  scaleProperty(flightLog.baro, 'T', 100)

  scaleProperty(flightLog.voltageInfo, 'voltage', 1000)

  console.log(flightLog)

  return flightLog;
}

export function parseFlightLog(logString) {
  let imu = [];
  let baro = [];
  let flightInfo = [];
  let orientationInfo = [];
  let filteredDataInfo = [];
  let voltageInfo = [];
  let gnssInfo = [];
  let flightStates = [];
  let eventInfo = [];
  let errorInfo = [];
  let i = 0;
  let firstTs = -1;
  let lastTs = -1;

  let bin = Buffer.from(logString, 'binary')

  try {
    // Read out the code version
    let codeVersion = "";

    let charCode = bin.readUInt8(i++);

    // Read until the null terminator is encountered
    while (charCode != 0) {
      // Convert the byte to a char
      codeVersion += String.fromCharCode(charCode);
      charCode = bin.readUInt8(i++);
    }

    console.log("Code version: " + codeVersion);


    while (i < bin.length) {
      let [ts, t] = [bin.readUInt32LE(i), bin.readUInt32LE(i + 4)];
      let sensorId = getIdFromRecordType(t);
      let tWithoutId = getRecordTypeWithoutId(t);
      i += 8;
      if (firstTs === -1) {
        firstTs = ts;
      }
      if (tWithoutId === REC_TYPE.IMU) {
        let [accX, accY, accZ, gyroX, gyroY, gyroZ] = [bin.readInt16LE(i), bin.readInt16LE(i + 2), bin.readInt16LE(i + 4),
        bin.readInt16LE(i + 6), bin.readInt16LE(i + 8), bin.readInt16LE(i + 10)];
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
        let [pressure, temperature] = [bin.readUint32LE(i), bin.readUint32LE(i + 4)];
        baro.push({
          ts: ts,
          id: `BARO${sensorId}`,
          T: temperature,
          P: pressure
        });
        i += 8;
      } else if (tWithoutId === REC_TYPE.FLIGHT_INFO) {
        let [height, velocity, acceleration] = [bin.readFloatLE(i), bin.readFloatLE(i + 4), bin.readFloatLE(i + 8)];

        flightInfo.push({
          ts: ts,
          height: height,
          velocity: velocity,
          acceleration: acceleration
        });
        i += 12;
      } else if (tWithoutId === REC_TYPE.ORIENTATION_INFO) {
        let [est_0, est_1, est_2, est_3] = [bin.readInt16LE(i), bin.readInt16LE(i + 2), bin.readInt16LE(i + 4), bin.readInt16LE(i + 6)];

        orientationInfo.push({
          ts: ts,
          q0_estimated: est_0,
          q1_estimated: est_1,
          q2_estimated: est_2,
          q3_estimated: est_3,
        });
        i += 8;
      } else if (tWithoutId === REC_TYPE.FILTERED_DATA_INFO) {
        let [filteredAltitudeAGL, filteredAcceleration] = [bin.readFloatLE(i), bin.readFloatLE(i + 4)];
        filteredDataInfo.push({
          ts: ts,
          filteredAltitudeAGL: filteredAltitudeAGL,
          filteredAcceleration: filteredAcceleration
        });
        i += 8;
      } else if (tWithoutId === REC_TYPE.FLIGHT_STATE) {
        let state = bin.readUint32LE(i);
        flightStates.push({
          ts: ts,
          state: state
        });
        i += 4;
      } else if (tWithoutId === REC_TYPE.EVENT_INFO) {
        let [event, action, argument] = [bin.readUint32LE(i), bin.readUint16LE(i + 4), bin.readUint16LE(i + 6)];
        eventInfo.push({
          ts: ts,
          event: event,
          action: action,
          argument: argument,
        });
        i += 8;
      } else if (tWithoutId === REC_TYPE.ERROR_INFO) {
        let error = bin.readUint32LE(i);
        errorInfo.push({
          ts: ts,
          error: error
        });
        i += 4;
      } else if (tWithoutId === REC_TYPE.GNSS_INFO) {
        let [latitude, longitude, satellites] = [bin.readFloatLE(i), bin.readFloatLE(i + 4), bin.readUInt8(i + 8)];
        gnssInfo.push({
          ts: ts,
          latitude: latitude,
          longitude: longitude,
          satellites: satellites
        });
        i += 9;
      } else if (tWithoutId === REC_TYPE.VOLTAGE_INFO) {
        let voltage = bin.readUint16LE(i);
        voltageInfo.push({
          ts: ts,
          voltage: voltage
        });
        i += 2;
      } else {
        console.log(`ERROR at ${i} with t=${t}`);
        break;
      }
      lastTs = ts;
    }
  } catch (e) {
    console.log(`Parsing ended with error: ${e}`);
  } finally {
    console.log(`Parsing ended at position: ${i}/${logString.length}`)
  }

  let flightLog = {
    imu: imu,
    baro: baro,
    flightInfo: flightInfo,
    orientationInfo: orientationInfo,
    filteredDataInfo: filteredDataInfo,
    gnssInfo: gnssInfo,
    flightStates: flightStates,
    eventInfo: eventInfo,
    errorInfo: errorInfo,
    voltageInfo: voltageInfo,
    byteCount: i,
    firstTs: firstTs,
    lastTs: lastTs,
  }

  return scaleAndOffsetFlightLog(flightLog);
}
