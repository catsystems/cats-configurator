import { SerialPort, ReadlineParser } from "serialport";
import { Notification, dialog } from "electron";
import fs from "fs";
import path from "path";

import { IPC_CHANNELS } from "../shared/ipc.js";
import {
  parseAllowedLength,
  parseAllowedRange,
  parseAllowedValues,
  parseCommand,
  parseConfigValue,
  parseData,
  parseEventData,
} from "./serial-parser.js";

const CONFIG = {
  baudRate: 115200,
};

let mainWindow,
  port,
  parser,
  config = {},
  currentCommand,
  currentNotification,
  backupConfig = "",
  cliMode = false;

const useFakeSerial = process.env.CATS_FAKE_SERIAL === "1";

const fakeConfigurations = {
  main_altitude: {
    value: 200,
    type: "NUMBER",
    allowedRange: [10, 65535],
  },
  acc_threshold: {
    value: 35,
    type: "NUMBER",
    allowedRange: [1, 100],
  },
  servo1_init_pos: {
    value: 0,
    type: "NUMBER",
    allowedRange: [0, 1000],
  },
  servo2_init_pos: {
    value: 0,
    type: "NUMBER",
    allowedRange: [0, 1000],
  },
  tele_enable: {
    value: "ON",
    type: "SELECT",
    allowedValues: ["OFF", "ON"],
  },
  tele_link_phrase: {
    value: "cats-test",
    type: "STRING",
    allowedRange: [1, 32],
  },
  tele_power_level: {
    value: 20,
    type: "NUMBER",
    allowedRange: [-20, 22],
  },
  tele_adaptive_power: {
    value: "OFF",
    type: "SELECT",
    allowedValues: ["OFF", "ON"],
  },
  test_mode: {
    value: "OFF",
    type: "SELECT",
    allowedValues: ["OFF", "ON"],
  },
  tele_test_phrase: {
    value: "cats-test",
    type: "STRING",
    allowedRange: [1, 32],
  },
};

const fakeEventKeys = new Set([
  "ev_liftoff",
  "ev_burnout",
  "ev_apogee",
  "ev_main_deployment",
  "ev_touchdown",
  "ev_custom1",
  "ev_custom2",
]);

function fakeConfigForKey(key) {
  if (fakeConfigurations[key]) return { key, ...fakeConfigurations[key] };

  if (fakeEventKeys.has(key)) {
    const hasRecorderAction = key === "ev_liftoff";
    return {
      key,
      value: hasRecorderAction ? "7,2" : "0,0",
      type: "EVENT",
      arrayLength: 8,
      values: hasRecorderAction ? [7, 2] : [],
      actions: hasRecorderAction
        ? [
            {
              name: "Recorder",
              args: [
                { text: "OFF", value: 0 },
                { text: "PRE", value: 1 },
                { text: "LOG", value: 2 },
              ],
              type: "SELECT",
              unit: null,
              index: 7,
              value: 2,
            },
          ]
        : [],
    };
  }

  const timerMatch = key.match(/^(timer[1-4])_(start|duration|trigger)$/);
  if (!timerMatch) return null;
  const [, timer, field] = timerMatch;
  if (field === "duration") {
    return {
      key,
      value: timer === "timer1" ? 1000 : 0,
      type: "NUMBER",
      allowedRange: [0, 60000],
    };
  }
  return {
    key,
    value: "CALIBRATE",
    type: "SELECT",
    allowedValues: ["CALIBRATE", "READY", "LIFTOFF", "APOGEE"],
  };
}

function setSerialWindow(window) {
  mainWindow = window;
}

async function getList() {
  if (useFakeSerial) {
    return [{ path: "CATS-FAKE", manufacturer: "CATS Systems" }];
  }
  return await SerialPort.list();
}

function connect(path) {
  if (useFakeSerial) {
    queueMicrotask(() => {
      sendToRenderer(IPC_CHANNELS.SERIAL_CONNECTED);
      sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, {
        key: "version",
        value: ["Board: CATS (test)", "Firmware: test"],
      });
      sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, true);
    });
    return;
  }

  port = new SerialPort({ ...CONFIG, path }, function (err) {
    if (err) return sendToRenderer(IPC_CHANNELS.SERIAL_ERROR, err.message);
  });

  parser = port.pipe(
    new ReadlineParser({
      delimiter: "\r\n",
      encoding: "utf8",
    }),
  );

  parser.on("data", onData);

  port.on("error", function (err) {
    sendAlert(err.message);
  });
  port.on("open", function () {
    port.write("\n");
    command("version");
    sendToRenderer(IPC_CHANNELS.SERIAL_CONNECTED);
  });

  port.on("close", function () {
    notify({
      title: "Port is disconnected.",
    });

    sendToRenderer(IPC_CHANNELS.SERIAL_DISCONNECTED);
  });
}

function disconnect() {
  currentCommand = null;

  if (useFakeSerial) {
    queueMicrotask(() => sendToRenderer(IPC_CHANNELS.SERIAL_DISCONNECTED));
    return;
  }

  if (port && port.isOpen) {
    port.close();
    port = null;
  }
}

function onData(data) {
  if (cliMode) {
    return sendToRenderer(IPC_CHANNELS.SERIAL_DATA, data);
  }

  if (data.includes("CATS is now ready")) {
    command("version");
  }
  // Catch confirmation response
  if (data.includes("^._.^") || data === "version") {
    currentCommand = data === "version" ? "version" : parseCommand(data);
    return;
  }

  if (!currentCommand) return;

  // Handle actual data
  if (["version"].includes(currentCommand)) {
    const parsedData = parseData(currentCommand, data);
    sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, parsedData);

    // Check if it's CATS board
    if (currentCommand === "version" && data.includes("Board: CATS")) {
      notify({
        title: `Connected to: ${port.path}`,
        body: data,
      });

      sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, true);
    } else {
      disconnect();
    }

    return;
  }

  // Handle actual data
  if (["status", "rec_info"].includes(currentCommand)) {
    const parsedData = parseData(currentCommand, data);
    sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, parsedData);

    // Check if it's CATS board
    if (currentCommand === "version" && data.includes("Board: CATS")) {
      notify({
        title: `Connected to: ${port.path}`,
        body: data,
      });

      sendToRenderer(IPC_CHANNELS.BOARD_ACTIVE, true);
    }

    return;
  }

  // Handle config get requests
  if (currentCommand.substring(0, 3) === "get") {
    if (data.includes(" = ")) {
      // Parse value of current command
      config = parseConfigValue(data);
    } else {
      if (data.includes("Allowed values:")) {
        // Parse config allowed values
        config.type = "SELECT";
        config.allowedValues = parseAllowedValues(data);
      } else if (data.includes("Allowed range:")) {
        // Parse config allowed values
        config.type = "NUMBER";
        config.value = Number(config.value);
        config.allowedRange = parseAllowedRange(data);
      } else if (data.includes("String length:")) {
        // Parse config allowed values
        config.type = "STRING";
        config.value = String(config.value);
        config.allowedRange = parseAllowedRange(data);
      } else if (data.includes("Array length:")) {
        // Parse config array length
        config.type = "EVENT";
        config.arrayLength = parseAllowedLength(data);

        const { values, actions } = parseEventData(
          config.value,
          config.arrayLength,
        );
        config = {
          ...config,
          values,
          actions,
        };
      }
      sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_DATA, config);
      config = {};
    }

    return;
  }

  // Handle dump command
  if (currentCommand === "dump") {
    if (data === "#Configuration dump") return;
    else if (data === "#End of configuration dump") {
      try {
        saveDumpDataToFile(backupConfig.trim());
        sendToRenderer(IPC_CHANNELS.BOARD_DUMP_COMPLETE);
      } catch (error) {
        return sendToRenderer(IPC_CHANNELS.BOARD_DUMP_COMPLETE, {
          error: error.message,
        });
      }
      backupConfig = "";
    } else backupConfig += data + "\n";

    return;
  }

  // Handle config success set requests
  if (data.includes("set to")) {
    sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_SAVED, data);

    return;
  }

  // Handle reset config response
  if (data === "Reset to default values") {
    notify({
      title: "Config reset to default",
    });

    return;
  }
}

async function command(cmd) {
  cliMode = false;

  if (useFakeSerial) {
    const getMatch = cmd.match(/^get ([a-z0-9_]+)$/);
    const fakeConfig = getMatch ? fakeConfigForKey(getMatch[1]) : null;
    if (fakeConfig) {
      queueMicrotask(() =>
        sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_DATA, fakeConfig),
      );
    } else if (cmd === "status") {
      queueMicrotask(() =>
        sendToRenderer(IPC_CHANNELS.BOARD_STATIC_DATA, {
          key: "status",
          value: [
            "CATS test device",
            "Ready",
            "Nominal",
            "h: 0 m, v: 0 m/s, a: 0 m/s^2",
          ],
        }),
      );
    } else if (cmd === "save") {
      queueMicrotask(() =>
        sendToRenderer(IPC_CHANNELS.BOARD_CONFIG_SAVED, "saved"),
      );
    }
    return;
  }

  if (!port?.isOpen) {
    sendAlert("Serial port is not connected.");
    return;
  }
  port.write(`${cmd}\n`, function (err) {
    if (err) {
      return sendAlert(err.message);
    }
  });
}

function cliCommand(cmd) {
  cliMode = true;

  if (useFakeSerial) {
    queueMicrotask(() =>
      sendToRenderer(IPC_CHANNELS.SERIAL_DATA, `test> ${cmd}`),
    );
    return;
  }

  if (!port?.isOpen) {
    sendAlert("Serial port is not connected.");
    return;
  }
  port.write(`${cmd}\n`, function (err) {
    if (err) {
      return sendAlert(err.message);
    }
  });
}

function saveDumpDataToFile(data) {
  let paths = dialog.showOpenDialogSync({ properties: ["openDirectory"] });

  if (paths) {
    const file = path.join(paths[0], "backup_cats_config.txt");
    fs.writeFileSync(file, data);
  } else {
    throw new Error("No directory selected for backup.");
  }
}

function notify(payload) {
  if (currentNotification) currentNotification.close();
  currentNotification = new Notification(payload);
  currentNotification.show();
}

function sendAlert(message) {
  sendToRenderer(IPC_CHANNELS.APP_ALERT, message);
}

function sendToRenderer(channel, message) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, message);
  }
}

export { getList, connect, disconnect, command, cliCommand, setSerialWindow };
