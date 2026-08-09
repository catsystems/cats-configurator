import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { describe, expect, it, vi } from "vitest";
import { startFlightLogHandoff } from "@/modules/flight-log-handoff.js";

const ORIGIN = "https://flights.catsystems.io";

function request({ port, path, method = "GET", origin = ORIGIN }) {
  return new Promise((resolve, reject) => {
    const request = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method,
        headers: {
          Origin: origin,
          "Access-Control-Request-Private-Network": "true",
        },
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () =>
          resolve({
            status: response.statusCode,
            headers: response.headers,
            body: Buffer.concat(chunks),
          }),
        );
      },
    );
    request.on("error", reject);
    request.end();
  });
}

describe("private CATS Flights handoff", () => {
  it("uses an exact-origin, single-use, private-network response", async () => {
    const states = [];
    let browserUrl;
    const handoff = await startFlightLogHandoff({
      bytes: Buffer.from("private-flight-log"),
      fileName: "fl42.cfl",
      origin: ORIGIN,
      onState: (state) => states.push(state.status),
      openExternal: async (url) => {
        browserUrl = url;
      },
    });
    const link = new URL(browserUrl);
    const fragment = new URLSearchParams(link.hash.slice(1));
    const token = fragment.get("token");
    const requestPath = `/v1/flight-log/${token}`;

    expect(link.origin).toBe(ORIGIN);
    expect(link.pathname).toBe("/analyze");
    expect(fragment.get("cats-import")).toBe("v1");
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

    const rejected = await request({
      port: handoff.port,
      path: requestPath,
      origin: "https://attacker.example",
    });
    expect(rejected.status).toBe(403);

    const preflight = await request({
      port: handoff.port,
      path: requestPath,
      method: "OPTIONS",
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers["access-control-allow-origin"]).toBe(ORIGIN);
    expect(preflight.headers["access-control-allow-private-network"]).toBe(
      "true",
    );

    const transferred = await request({
      port: handoff.port,
      path: requestPath,
    });
    expect(transferred.status).toBe(200);
    expect(transferred.body.toString()).toBe("private-flight-log");
    expect(transferred.headers["cache-control"]).toBe("no-store");
    expect(transferred.headers["x-cats-log-name"]).toBe("fl42.cfl");
    expect(states).toEqual(["waiting", "transferring", "complete"]);
  });

  it("expires and cancels cleanly", async () => {
    vi.useFakeTimers();
    const expiredStates = [];
    const expired = await startFlightLogHandoff({
      bytes: Buffer.from("log"),
      fileName: "flight.cfl",
      origin: ORIGIN,
      timeoutMs: 100,
      onState: (state) => expiredStates.push(state.status),
      openExternal: vi.fn(),
    });
    await vi.advanceTimersByTimeAsync(101);
    expect(expiredStates).toEqual(["waiting", "expired"]);

    const cancelledStates = [];
    const cancelled = await startFlightLogHandoff({
      bytes: Buffer.from("log"),
      fileName: "flight.cfl",
      origin: ORIGIN,
      onState: (state) => cancelledStates.push(state.status),
      openExternal: vi.fn(),
    });
    cancelled.cancel();
    expect(cancelledStates).toEqual(["waiting", "cancelled"]);
    expired.cancel();
    vi.useRealTimers();
  });

  it("destroys idle browser sockets when the handoff is cancelled", async () => {
    const handoff = await startFlightLogHandoff({
      bytes: Buffer.from("log"),
      fileName: "flight.cfl",
      origin: ORIGIN,
      openExternal: vi.fn(),
    });
    const socket = net.connect(handoff.port, "127.0.0.1");
    await once(socket, "connect");
    const closed = once(socket, "close");

    handoff.cancel();
    await closed;

    expect(socket.destroyed).toBe(true);
  });
});
