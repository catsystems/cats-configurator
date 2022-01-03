export function sendCommand(command) {
  window.renderer.send("CLI_COMMAND", command);
}
