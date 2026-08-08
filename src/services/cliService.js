export function sendCommand(command) {
  return window.cats.serial.send(command);
}
