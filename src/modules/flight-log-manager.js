import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { parseFlightLog } from "./logparser.js";

export const MAX_FLIGHT_LOG_BYTES = 64 * 1024 * 1024;

export function isContainedPath(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

function logNumberFromName(name) {
  const match = /^fl(\d+)\.cfl$/i.exec(name);
  return match ? Number.parseInt(match[1], 10) : null;
}

function compareLogs(left, right) {
  if (left.logNumber !== null && right.logNumber !== null) {
    return right.logNumber - left.logNumber;
  }
  if (left.logNumber !== null) return -1;
  if (right.logNumber !== null) return 1;
  return right.name.localeCompare(left.name, "en", {
    numeric: true,
    sensitivity: "base",
  });
}

async function childDirectories(root, depth) {
  if (depth < 0) return [];
  try {
    const entries = await fs.readdir(root, { withFileTypes: true });
    const direct = entries
      .filter((entry) => entry.isDirectory() && !entry.isSymbolicLink())
      .map((entry) => path.join(root, entry.name));
    if (depth === 0) return direct;
    const nested = await Promise.all(
      direct.map((directory) => childDirectories(directory, depth - 1)),
    );
    return [...direct, ...nested.flat()];
  } catch {
    return [];
  }
}

export async function platformVolumeCandidates(platform = process.platform) {
  if (process.env.CATS_FAKE_CATS_DRIVE) {
    return [path.resolve(process.env.CATS_FAKE_CATS_DRIVE)];
  }
  if (platform === "win32") {
    return Array.from(
      { length: 26 },
      (_value, index) => `${String.fromCharCode(65 + index)}:\\`,
    );
  }
  if (platform === "darwin") return childDirectories("/Volumes", 0);

  const userName = os.userInfo().username;
  const roots = ["/media", "/run/media", "/mnt"];
  const candidates = await Promise.all(
    roots.map((root) =>
      childDirectories(root, root.includes(userName) ? 0 : 1),
    ),
  );
  return candidates.flat();
}

export async function validateCatsVolume(rootPath) {
  const requestedRoot = path.resolve(rootPath);
  const requestedStat = await fs.lstat(requestedRoot);
  if (requestedStat.isSymbolicLink()) {
    throw new Error("Choose the root of the mounted CATS drive.");
  }
  const resolvedRoot = await fs.realpath(requestedRoot);
  const rootStat = await fs.lstat(resolvedRoot);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error("Choose the root of the mounted CATS drive.");
  }
  const readmePath = path.join(resolvedRoot, "readme.txt");
  const readmeStat = await fs.lstat(readmePath);
  if (
    !readmeStat.isFile() ||
    readmeStat.isSymbolicLink() ||
    readmeStat.size > 16_384
  ) {
    throw new Error("Choose the root of the mounted CATS drive.");
  }
  const introduction = (await fs.readFile(readmePath, "utf8")).slice(0, 200);
  if (!/welcome to cats!/i.test(introduction)) {
    throw new Error("Choose the root of the mounted CATS drive.");
  }
  return resolvedRoot;
}

async function listVolumeLogs(resolvedRoot) {
  const entries = await fs.readdir(resolvedRoot, { withFileTypes: true });
  const logs = [];
  for (const entry of entries) {
    if (
      !entry.isFile() ||
      entry.isSymbolicLink() ||
      !entry.name.toLowerCase().endsWith(".cfl")
    ) {
      continue;
    }
    const candidate = path.join(resolvedRoot, entry.name);
    const realCandidate = await fs.realpath(candidate);
    if (!isContainedPath(resolvedRoot, realCandidate)) continue;
    const stat = await fs.lstat(realCandidate);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size <= 0 ||
      stat.size > MAX_FLIGHT_LOG_BYTES
    ) {
      continue;
    }
    logs.push({
      id: randomUUID(),
      logNumber: logNumberFromName(entry.name),
      name: entry.name,
      path: realCandidate,
      size: stat.size,
    });
  }
  return logs.sort(compareLogs);
}

export class FlightLogManager {
  constructor({ candidates = platformVolumeCandidates } = {}) {
    this.candidates = candidates;
    this.volumeRoot = null;
    this.protectedVolumeRoots = new Set();
    this.onboard = new Map();
    this.hiddenOnboardNames = new Set();
    this.session = null;
  }

  onboardResult() {
    return {
      status: "ready",
      logs: [...this.onboard.values()].map(
        ({ path: _path, ...summary }) => summary,
      ),
    };
  }

  publicSession() {
    if (!this.session) return null;
    const { id, source, name, size, flightLog } = this.session;
    return { id, source, name, size, flightLog };
  }

  getSession(id) {
    if (!this.session || this.session.id !== id) {
      throw new Error(
        "The selected flight-log session is no longer available.",
      );
    }
    return this.session;
  }

  async assertSaveDestination(filePath) {
    const destination = path.resolve(filePath);
    if (this.protectedVolumeRoots.size === 0) return destination;

    const parent = await fs.realpath(path.dirname(destination));
    for (const root of this.protectedVolumeRoots) {
      if (isContainedPath(root, parent)) {
        throw new Error(
          "Flight logs cannot be written to the mounted CATS drive.",
        );
      }
    }

    try {
      const existingDestination = await fs.realpath(destination);
      for (const root of this.protectedVolumeRoots) {
        if (isContainedPath(root, existingDestination)) {
          throw new Error(
            "Flight logs cannot be written to the mounted CATS drive.",
          );
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    return destination;
  }

  async loadPath(filePath, source = "local") {
    this.session = null;
    const requestedPath = path.resolve(filePath);
    const requestedStat = await fs.lstat(requestedPath);
    if (requestedStat.isSymbolicLink()) {
      throw new Error("Flight-log path is not a regular file.");
    }
    const resolvedPath = await fs.realpath(requestedPath);
    if (path.extname(resolvedPath).toLowerCase() !== ".cfl") {
      throw new Error("File does not end with .cfl");
    }
    const stat = await fs.lstat(resolvedPath);
    if (!stat.isFile() || stat.isSymbolicLink()) {
      throw new Error("Flight-log path is not a regular file.");
    }
    if (stat.size === 0) throw new Error("File is empty");
    if (stat.size > MAX_FLIGHT_LOG_BYTES) {
      throw new Error("Flight log exceeds the 64 MiB limit.");
    }
    const bytes = await fs.readFile(resolvedPath);
    if (bytes.length === 0 || bytes.length > MAX_FLIGHT_LOG_BYTES) {
      throw new Error("Flight log changed while it was being loaded.");
    }
    this.session = {
      id: randomUUID(),
      source,
      name: path.basename(resolvedPath),
      size: bytes.length,
      bytes,
      flightLog: parseFlightLog(bytes.toString("binary")),
    };
    return this.publicSession();
  }

  async selectVolume(rootPath) {
    const resolvedRoot = await validateCatsVolume(rootPath);
    if (this.volumeRoot !== resolvedRoot) this.hiddenOnboardNames.clear();
    this.protectedVolumeRoots.add(resolvedRoot);
    const logs = (await listVolumeLogs(resolvedRoot)).filter(
      ({ name }) => !this.hiddenOnboardNames.has(name.toLowerCase()),
    );
    this.volumeRoot = resolvedRoot;
    this.onboard = new Map(logs.map((log) => [log.id, log]));
    return this.onboardResult();
  }

  async discoverOnboard() {
    const candidates = [...new Set(await this.candidates())];
    const matches = [];
    for (const candidate of candidates) {
      try {
        const resolvedRoot = await validateCatsVolume(candidate);
        matches.push(resolvedRoot);
        this.protectedVolumeRoots.add(resolvedRoot);
      } catch {
        // Expected for ordinary drives and inaccessible mount points.
      }
    }
    if (matches.length === 1) return this.selectVolume(matches[0]);
    this.volumeRoot = null;
    this.onboard.clear();
    this.hiddenOnboardNames.clear();
    return {
      status: matches.length > 1 ? "multiple" : "not-found",
      logs: [],
    };
  }

  async refreshOnboard() {
    if (!this.volumeRoot) return this.discoverOnboard();
    try {
      return await this.selectVolume(this.volumeRoot);
    } catch {
      this.volumeRoot = null;
      this.onboard.clear();
      this.hiddenOnboardNames.clear();
      return { status: "unavailable", logs: [] };
    }
  }

  clearOnboard() {
    this.volumeRoot = null;
    this.onboard.clear();
    this.hiddenOnboardNames.clear();
    return { status: "not-found", logs: [] };
  }

  getOnboardLog(logId) {
    const log = this.onboard.get(logId);
    if (!log || !this.volumeRoot) {
      throw new Error("This onboard flight log is no longer available.");
    }
    const { id, logNumber, name, size } = log;
    return { id, logNumber, name, size };
  }

  removeOnboard(logId) {
    const log = this.onboard.get(logId);
    if (!log || !this.volumeRoot) {
      throw new Error("This onboard flight log is no longer available.");
    }
    this.hiddenOnboardNames.add(log.name.toLowerCase());
    this.onboard.delete(logId);
    return this.onboardResult();
  }

  async openOnboard(logId) {
    const log = this.onboard.get(logId);
    if (!log || !this.volumeRoot) {
      throw new Error("This onboard flight log is no longer available.");
    }
    const realPath = await fs.realpath(log.path);
    if (!isContainedPath(this.volumeRoot, realPath)) {
      throw new Error("Rejected a flight log outside the selected CATS drive.");
    }
    return this.loadPath(realPath, "onboard");
  }
}
