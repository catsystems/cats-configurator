import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  FlightLogManager,
  isContainedPath,
  validateCatsVolume,
} from "@/modules/flight-log-manager.js";

const temporaryDirectories = [];

function flightInfoFixture() {
  const buffer = Buffer.alloc(22);
  buffer.write("v", 0, "ascii");
  buffer.writeUInt8(0, 1);
  buffer.writeUInt32LE(1000, 2);
  buffer.writeUInt32LE(1 << 6, 6);
  buffer.writeFloatLE(123.5, 10);
  buffer.writeFloatLE(45.25, 14);
  buffer.writeFloatLE(9.81, 18);
  return buffer;
}

async function createCatsDrive(names = ["fl2.cfl", "fl10.cfl"]) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cats-drive-"));
  temporaryDirectories.push(root);
  await fs.writeFile(path.join(root, "readme.txt"), "Welcome to CATS!\n");
  await Promise.all(
    names.map((name) =>
      fs.writeFile(path.join(root, name), flightInfoFixture()),
    ),
  );
  return root;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => fs.rm(directory, { recursive: true, force: true })),
  );
});

describe("mounted CATS drive flight logs", () => {
  it("discovers one signed volume and sorts numeric log names newest first", async () => {
    const root = await createCatsDrive();
    const manager = new FlightLogManager({ candidates: async () => [root] });

    const result = await manager.discoverOnboard();

    expect(result.status).toBe("ready");
    expect(result.logs.map((log) => log.name)).toEqual(["fl10.cfl", "fl2.cfl"]);
    expect(result.logs.every((log) => !Object.hasOwn(log, "path"))).toBe(true);
    await expect(
      manager.assertSaveDestination(path.join(root, "saved-copy.cfl")),
    ).rejects.toThrow(/cannot be written/i);

    manager.clearOnboard();
    await expect(
      manager.assertSaveDestination(
        path.join(root, "saved-after-disconnect.cfl"),
      ),
    ).rejects.toThrow(/cannot be written/i);
  });

  it("requires manual selection when multiple signed volumes are present", async () => {
    const first = await createCatsDrive(["fl1.cfl"]);
    const second = await createCatsDrive(["fl2.cfl"]);
    const manager = new FlightLogManager({
      candidates: async () => [first, second],
    });

    await expect(manager.discoverOnboard()).resolves.toEqual({
      status: "multiple",
      logs: [],
    });
    await expect(
      manager.assertSaveDestination(path.join(first, "first-export.html")),
    ).rejects.toThrow(/cannot be written/i);
    await expect(
      manager.assertSaveDestination(path.join(second, "second-export.html")),
    ).rejects.toThrow(/cannot be written/i);
  });

  it("loads onboard bytes into one replaceable session and detects removal", async () => {
    const root = await createCatsDrive(["fl1.cfl", "fl2.cfl"]);
    const manager = new FlightLogManager({ candidates: async () => [root] });
    const discovered = await manager.discoverOnboard();
    const first = await manager.openOnboard(discovered.logs[0].id);
    const second = await manager.openOnboard(discovered.logs[1].id);

    expect(first.source).toBe("onboard");
    expect(second.id).not.toBe(first.id);
    expect(() => manager.getSession(first.id)).toThrow(/no longer available/);

    await fs.rm(root, { recursive: true, force: true });
    temporaryDirectories.splice(temporaryDirectories.indexOf(root), 1);
    await expect(manager.refreshOnboard()).resolves.toEqual({
      status: "unavailable",
      logs: [],
    });
  });

  it("rejects unsigned roots, traversal, empty files, and non-CFL files", async () => {
    const unsigned = await fs.mkdtemp(path.join(os.tmpdir(), "not-cats-"));
    temporaryDirectories.push(unsigned);
    await fs.writeFile(path.join(unsigned, "readme.txt"), "ordinary drive");
    await expect(validateCatsVolume(unsigned)).rejects.toThrow(/CATS drive/);

    const root = await createCatsDrive([]);
    const valid = path.join(root, "valid.cfl");
    const empty = path.join(root, "empty.cfl");
    const text = path.join(root, "notes.txt");
    await fs.writeFile(valid, flightInfoFixture());
    await fs.writeFile(empty, "");
    await fs.writeFile(text, "not a log");
    const manager = new FlightLogManager();
    await expect(manager.loadPath(valid)).resolves.toMatchObject({
      name: "valid.cfl",
    });
    expect(manager.publicSession()).not.toBeNull();
    await expect(manager.loadPath(empty)).rejects.toThrow(/empty/i);
    expect(manager.publicSession()).toBeNull();
    await expect(manager.loadPath(text)).rejects.toThrow(/\.cfl/);
    expect(isContainedPath(root, path.resolve(root, "..", "escape.cfl"))).toBe(
      false,
    );
  });
});
