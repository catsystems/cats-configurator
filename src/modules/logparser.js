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

function getIdFromRecordType(recType) {
  return recType & REC_ID_MASK;
}

function getRecordTypeWithoutId(recType) {
  return recType & ~REC_ID_MASK;
}

export function parseFlightLog(logString) {
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
        // Nothing to plot yet
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
    flightStates: flightStates,
    eventInfo: eventInfo,
    errorInfo: errorInfo,
    voltageInfo: voltageInfo,
    byteCount: i,
    firstTs: firstTs,
    lastTs: lastTs,
  }
  return flightLog
}
