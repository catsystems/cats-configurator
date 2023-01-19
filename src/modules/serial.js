import { SerialPort, ReadlineParser } from "serialport";
import { BrowserWindow, Notification, dialog } from "electron";
import fs from "fs";
import path from "path";

import { EVENT_SETTINGS } from "./settings.js";

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

async function getList() {
  return await SerialPort.list();
}

function connect(path) {
  mainWindow = BrowserWindow.getFocusedWindow();

  port = new SerialPort({ ...CONFIG, path }, function (err) {
    if (err) return sendToRenderer("CONNECTION_ERROR", err);
  });

  parser = port.pipe(
    new ReadlineParser({
      delimiter: "\r\n",
      encoding: "utf8",
    })
  );

  parser.on("data", onData);

  port.on("error", function (err) {
    sendAlert(err.message);
  });
  port.on("open", function () {
    port.write("\n");
    command("version");
    sendToRenderer("CONNECTED");
  });

  port.on("close", function () {
    notify({
      title: "Port is disconnected.",
    });

    sendToRenderer("DISCONNECTED");
  });
}

function disconnect() {
  currentCommand = null;

  if (port && port.isOpen) {
    port.close();
    port = null;
  }
}

function onData(data) {
  if (cliMode) {
    return sendToRenderer("CLI_COMMAND", data);
  }
  // console.log(data);

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
  if (["version", "status", "rec_info"].includes(currentCommand)) {
    const parsedData = parseData(currentCommand, data);

    sendToRenderer("BOARD:STATIC_DATA", parsedData);

    // Check if it's CATS board
    if (currentCommand === "version" && data.includes("Board: CATS")) {
      notify({
        title: `Connected to: ${port.path}`,
        body: data,
      });

      sendToRenderer("SET_ACTIVE", true);
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
      } else if (data.includes("Array length:")) {
        // Parse config array length
        config.type = "EVENT";
        config.arrayLength = parseAllowedLength(data);

        const { values, actions } = parseEventData(
          config.value,
          config.arrayLength
        );
        config = {
          ...config,
          values,
          actions,
        };
      }
      sendToRenderer("SET_CONFIG", config);
      config = {};
    }

    return;
  }

  // Handle dump command
  if (currentCommand === "dump") {
    if (data === "#Configuration dump") return;
    else if (data === "#End of configuration dump") {
      saveDumpDataToFile(backupConfig.trim());
      sendToRenderer("BOARD:DUMP");
      backupConfig = "";
    } else backupConfig += data + "\n";

    return;
  }

  // Handle config success set requests
  if (data.includes("set to")) {
    sendToRenderer("SET_CONFIG_RESPONSE", data);

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

// Parse command confirmation
function parseCommand(data) {
  let command;
  data = data.split(">");
  if (data.length >= 2) {
    data.shift();

    command = data
      .join("")
      .toLowerCase()
      .trim()
      .replace(/[^\w \-_]/g, "")
      .replace(/ +/g, "_");
  }
  return command;
}

// Parse data. ex: status
function parseData(key, data) {
  data = data.trim();
  return {
    key,
    value: data.split("\n"),
  };
}

// Parse config value ex: get boot_state
function parseConfigValue(data) {
  data = data.split(" = ");

  return {
    key: data[0],
    value: data[1],
  };
}

function parseAllowedValues(data) {
  data = data.split(":");
  data.shift();
  data = data.join("").replace(/ +/g, "");
  return data.split(",");
}

function parseAllowedRange(data) {
  data = data.split(":");
  data.shift();
  return data
    .join("")
    .split("-")
    .map((v) => Number(v));
}

function parseAllowedLength(data) {
  data = data.split(":");
  data.shift();
  return Number(data[0]);
}

function parseEventData(value, maxLength) {
  const valuesArr = value.split(",").map((v) => Number(v));

  let values = [];
  let actions = [];

  for (var i = 0; i < valuesArr.length && i < maxLength; i += 2) {
    if (valuesArr[i] === 0) continue;

    const index = valuesArr[i];
    const value = valuesArr[i + 1];
    const config = EVENT_SETTINGS[index];

    if (!config) continue;

    actions.push({ ...config, index, value });
    values.push(index, value);
  }

  return { values, actions };
}

async function command(cmd) {
  cliMode = false;
  port.write(`${cmd}\n`, function (err) {
    if (err) {
      return sendAlert(err.message);
    }
  });
}

function cliCommand(cmd) {
  cliMode = true;
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
  }
}

function notify(payload) {
  if (currentNotification) currentNotification.close();
  currentNotification = new Notification(payload);
  currentNotification.show();
}

function sendAlert(message) {
  mainWindow.webContents.send("ALERT", message);
}

function sendToRenderer(channel, message) {
  mainWindow.webContents.send(channel, message);
}

export { getList, connect, disconnect, command, cliCommand };
