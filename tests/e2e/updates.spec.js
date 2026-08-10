import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";
import { expectedUpdateAssetName } from "../../src/modules/update-manager.js";

async function launchWithUpdateFixture(
  testInfo,
  { corruptDigest = false } = {},
) {
  const assetPath = testInfo.outputPath("update-asset.bin");
  const fixturePath = testInfo.outputPath("update-fixture.json");
  const userData = testInfo.outputPath("user-data");
  const bytes = Buffer.from("CATS Configurator test installer");
  await fs.writeFile(assetPath, bytes);
  await fs.writeFile(
    fixturePath,
    JSON.stringify({
      version: "9.9.9",
      assetPath,
      ...(corruptDigest ? { digest: "0".repeat(64) } : {}),
    }),
  );

  const executablePath = process.env.CATS_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? ["--disable-gpu"] : [".", "--disable-gpu"],
    env: {
      ...process.env,
      CATS_FAKE_SERIAL: "1",
      CATS_E2E_USER_DATA: userData,
      CATS_E2E_UPDATE_FIXTURE: fixturePath,
    },
  });
  return { application, bytes, userData };
}

async function closeApplication(application) {
  const process = application.process();
  await Promise.race([
    application.close(),
    new Promise((resolve) => setTimeout(resolve, 5_000)),
  ]);
  if (process.exitCode === null) process.kill();
}

test("downloads and verifies an update without executing it", async ({}, testInfo) => {
  const { application, bytes, userData } =
    await launchWithUpdateFixture(testInfo);
  const pageErrors = [];
  const consoleErrors = [];

  try {
    const page = await application.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await expect(
      page.getByText("Configurator update", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/9\.9\.9 has been downloaded and verified/),
    ).toBeVisible();
    await expect(page.getByText("Update ready", { exact: true })).toBeVisible();
    const originalUrl = page.url();

    const expectedName = expectedUpdateAssetName(
      process.platform,
      process.arch,
      "9.9.9",
    );
    const cachedFile = path.join(userData, "updates", "9.9.9", expectedName);
    await expect.poll(() => fs.readFile(cachedFile)).toEqual(bytes);
    await expect(fs.access(`${cachedFile}.part`)).rejects.toMatchObject({
      code: "ENOENT",
    });
    if (process.platform === "linux") {
      const stat = await fs.stat(cachedFile);
      expect(stat.mode & 0o111).not.toBe(0);
    }

    await page.getByRole("button", { name: "Reveal downloaded file" }).click();
    await expect(
      page.getByText("The verified update file was revealed."),
    ).toBeVisible();
    expect(page.url()).toBe(originalUrl);
    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
  } finally {
    await closeApplication(application);
  }
});

test("rejects a streamed update with the wrong digest", async ({}, testInfo) => {
  const { application, userData } = await launchWithUpdateFixture(testInfo, {
    corruptDigest: true,
  });

  try {
    const page = await application.firstWindow();
    await expect(
      page.getByText("Configurator update", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText(/could not prepare a verified download/),
    ).toBeVisible();
    await expect(page.getByText(/SHA-256 verification/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Open release page" }),
    ).toBeVisible();

    const updateRoot = path.join(userData, "updates");
    await expect
      .poll(async () => {
        try {
          const files = await fs.readdir(updateRoot, { recursive: true });
          return files.filter((file) =>
            /\.part$|\.exe$|\.dmg$|\.AppImage$/.test(file),
          );
        } catch (error) {
          if (error.code === "ENOENT") return [];
          throw error;
        }
      })
      .toEqual([]);
  } finally {
    await closeApplication(application);
  }
});
