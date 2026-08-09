import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import http from "node:http";
import {
  CATS_FLIGHTS_ANALYZE_URL,
  CATS_FLIGHTS_ORIGIN,
} from "../shared/flights.js";

const DEFAULT_TIMEOUT_MS = 120_000;

function safeHeaderFilename(value) {
  return value
    .replace(/[^\x20-\x7e]/g, "_")
    .replace(/[\\/\r\n"]/g, "_")
    .slice(0, 160);
}

function tokenMatches(received, expected) {
  const left = Buffer.from(received ?? "");
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function sendEmpty(response, status, headers = {}) {
  response.writeHead(status, {
    "cache-control": "no-store",
    "content-length": "0",
    ...headers,
  });
  response.end();
}

export async function startFlightLogHandoff({
  bytes,
  fileName,
  onState = () => {},
  openExternal,
  origin = CATS_FLIGHTS_ORIGIN,
  timeoutMs = DEFAULT_TIMEOUT_MS,
}) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) {
    throw new TypeError("Flight-log handoff requires a non-empty Buffer.");
  }
  if (typeof openExternal !== "function") {
    throw new TypeError("Flight-log handoff requires an external URL opener.");
  }

  const id = randomUUID();
  const token = randomBytes(32).toString("base64url");
  const expectedOrigin = new URL(origin).origin;
  const expectedPath = `/v1/flight-log/${token}`;
  let consumed = false;
  let stopped = false;
  let timer;
  const sockets = new Set();

  const publish = (status, message) => onState({ id, status, message });
  const corsHeaders = {
    "access-control-allow-origin": expectedOrigin,
    "access-control-allow-methods": "GET, OPTIONS",
    "access-control-allow-private-network": "true",
    "access-control-expose-headers": "X-CATS-Log-Name",
    vary: "Origin, Access-Control-Request-Private-Network",
  };

  const server = http.createServer((request, response) => {
    const requestOrigin = request.headers.origin;
    const requestUrl = new URL(request.url ?? "/", "http://127.0.0.1");
    const receivedToken = requestUrl.pathname.startsWith("/v1/flight-log/")
      ? requestUrl.pathname.slice("/v1/flight-log/".length)
      : "";

    if (requestOrigin !== expectedOrigin) {
      sendEmpty(response, 403);
      return;
    }
    if (
      requestUrl.pathname !== expectedPath ||
      !tokenMatches(receivedToken, token)
    ) {
      sendEmpty(response, 404, corsHeaders);
      return;
    }
    if (request.method === "OPTIONS") {
      sendEmpty(response, 204, corsHeaders);
      return;
    }
    if (request.method !== "GET") {
      sendEmpty(response, 405, corsHeaders);
      return;
    }
    if (consumed) {
      sendEmpty(response, 410, corsHeaders);
      return;
    }

    consumed = true;
    publish("transferring", `Sending ${fileName} to CATS Flights...`);
    response.writeHead(200, {
      ...corsHeaders,
      "cache-control": "no-store",
      "content-length": String(bytes.length),
      "content-type": "application/octet-stream",
      "x-cats-log-name": safeHeaderFilename(fileName),
    });
    response.end(bytes, () => {
      publish("complete", `${fileName} opened in CATS Flights.`);
      stop();
    });
  });

  const stop = (status, message) => {
    if (stopped) return;
    stopped = true;
    clearTimeout(timer);
    if (status) publish(status, message);
    server.close();
    for (const socket of sockets) socket.destroy();
    sockets.clear();
  };

  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  server.on("clientError", (_error, socket) => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  server.unref();

  const address = server.address();
  if (!address || typeof address === "string") {
    stop("failed", "Could not start the private browser handoff.");
    throw new Error("Could not resolve the flight-log handoff port.");
  }

  const analyzeUrl = new URL(CATS_FLIGHTS_ANALYZE_URL);
  if (analyzeUrl.origin !== expectedOrigin) {
    analyzeUrl.protocol = new URL(expectedOrigin).protocol;
    analyzeUrl.host = new URL(expectedOrigin).host;
  }
  analyzeUrl.hash = new URLSearchParams({
    "cats-import": "v1",
    port: String(address.port),
    token,
  }).toString();

  timer = setTimeout(() => {
    stop(
      "expired",
      "The browser handoff expired. Try Open in Flights again or save the log manually.",
    );
  }, timeoutMs);
  timer.unref?.();
  publish("waiting", "Waiting for CATS Flights to receive the log...");

  try {
    await openExternal(analyzeUrl.toString());
  } catch (error) {
    stop("failed", "CATS Flights could not be opened in the browser.");
    throw error;
  }

  return {
    id,
    port: address.port,
    url: analyzeUrl.toString(),
    cancel() {
      stop("cancelled", "Browser handoff cancelled.");
    },
  };
}
