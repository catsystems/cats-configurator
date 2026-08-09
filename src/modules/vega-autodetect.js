export const VEGA_USB_VENDOR_ID = "CAFE";
export const VEGA_USB_PRODUCT_ID = "4003";
export const SERIAL_PORT_POLL_INTERVAL_MS = 1000;

export function normalizeUsbId(value) {
  if (Number.isInteger(value) && value >= 0 && value <= 0xffff) {
    return value.toString(16).toUpperCase().padStart(4, "0");
  }
  if (typeof value !== "string") return null;

  const normalized = value.trim().replace(/^0x/i, "").toUpperCase();
  if (!/^[0-9A-F]{1,4}$/.test(normalized)) return null;
  return normalized.padStart(4, "0");
}

export function isVegaSerialPort(port) {
  return (
    normalizeUsbId(port?.vendorId) === VEGA_USB_VENDOR_ID &&
    normalizeUsbId(port?.productId) === VEGA_USB_PRODUCT_ID
  );
}

export function getSerialPortIdentity(port) {
  if (!port || typeof port !== "object") return null;
  const identity = [port.serialNumber, port.locationId, port.path].find(
    (value) => typeof value === "string" && value.trim().length > 0,
  );
  if (!identity) return null;

  const vendorId = normalizeUsbId(port.vendorId) ?? "UNKNOWN";
  const productId = normalizeUsbId(port.productId) ?? "UNKNOWN";
  return `${vendorId}:${productId}:${identity.trim()}`;
}

export function getSerialPortLabel(port) {
  if (!port?.path) return "Unknown serial port";
  return isVegaSerialPort(port) ? `CATS Vega (${port.path})` : port.path;
}

export function createVegaPresenceState() {
  return {
    presentIds: new Set(),
    attemptedIds: new Set(),
    suppressedIds: new Set(),
  };
}

export function reconcileVegaCandidates(state, ports) {
  const candidates = (Array.isArray(ports) ? ports : [])
    .filter(isVegaSerialPort)
    .map((port) => ({ port, identity: getSerialPortIdentity(port) }))
    .filter(({ identity }) => identity !== null);
  const presentIds = new Set(candidates.map(({ identity }) => identity));

  for (const identity of state.presentIds) {
    if (!presentIds.has(identity)) {
      state.attemptedIds.delete(identity);
      state.suppressedIds.delete(identity);
    }
  }
  state.presentIds = presentIds;
  return candidates;
}

export function getAutoConnectCandidate(state, candidates) {
  if (candidates.length !== 1) return null;
  const [candidate] = candidates;
  if (
    state.attemptedIds.has(candidate.identity) ||
    state.suppressedIds.has(candidate.identity)
  ) {
    return null;
  }
  return candidate;
}

export function markVegaConnectionAttempt(state, port) {
  const identity = getSerialPortIdentity(port);
  if (identity) state.attemptedIds.add(identity);
  return identity;
}

export function allowManualVegaConnection(state, port) {
  const identity = getSerialPortIdentity(port);
  if (identity) state.suppressedIds.delete(identity);
  return identity;
}

export function suppressVegaAutoConnect(state, port) {
  const identity = getSerialPortIdentity(port);
  if (identity) {
    state.attemptedIds.add(identity);
    state.suppressedIds.add(identity);
  }
  return identity;
}
