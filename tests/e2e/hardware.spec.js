import { _electron as electron, expect, test } from "@playwright/test";

const hardwarePort = process.env.CATS_HARDWARE_PORT;
test.skip(
  !hardwarePort,
  "Set CATS_HARDWARE_PORT to run the Vega hardware test.",
);

test("connects to a real CATS Vega without modifying configuration", async ({}, testInfo) => {
  test.setTimeout(process.env.CATS_RUN_SIM === "1" ? 420_000 : 60_000);
  const executablePath = process.env.CATS_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? ["--disable-gpu"] : [".", "--disable-gpu"],
    env: {
      ...process.env,
      CATS_E2E_USER_DATA: testInfo.outputPath("user-data"),
    },
  });

  try {
    const page = await application.firstWindow();
    await expect(page).toHaveTitle("CATS Configurator");

    const ports = await page.evaluate(() => window.cats.serial.list());
    expect(ports.some(({ path }) => path === hardwarePort)).toBe(true);
    await page.waitForTimeout(500);
    if (!(await page.getByText("Status: Connected").isVisible())) {
      await page.evaluate(
        (portPath) => window.cats.serial.connect(portPath),
        hardwarePort,
      );
    }
    await expect(page.getByText("Status: Connected")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Board: CATS Vega")).toBeVisible();
    await expect(page).toHaveURL(/#\/config$/);

    if (process.env.CATS_DELETE_ONBOARD_LOGS === "1") {
      await page.evaluate(() => {
        window.location.hash = "#/flight-logs";
      });
      await expect(
        page.getByText("Onboard logs", { exact: true }),
      ).toBeVisible();
      const deleteButtons = page.locator(
        '.onboard-actions button[aria-label^="Delete fl"]',
      );
      await expect.poll(() => deleteButtons.count()).toBeGreaterThan(0);
      while ((await deleteButtons.count()) > 0) {
        const before = await deleteButtons.count();
        page.once("dialog", (dialog) => dialog.accept());
        await deleteButtons.first().click();
        await expect.poll(() => deleteButtons.count()).toBe(before - 1);
      }
      await expect(
        page.getByText("The mounted CATS drive contains no flight logs."),
      ).toBeVisible();
      await page.evaluate(() => {
        window.location.hash = "#/config";
      });
    }

    await page.getByRole("button", { name: "disconnect" }).click();
    await expect(page.getByText("Status: Disconnected")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByText("Status: Disconnected")).toBeVisible();

    await page.evaluate(
      (portPath) => window.cats.serial.connect(portPath),
      hardwarePort,
    );
    await expect(page.getByText("Status: Connected")).toBeVisible({
      timeout: 15_000,
    });

    await page.evaluate(() => {
      window.location.hash = "#/cli";
    });
    const commandInput = page.getByPlaceholder(/Write your command here/);
    await commandInput.fill("status");
    await commandInput.press("Enter");
    await expect(page.getByText(/State:\s+READY/)).toBeVisible({
      timeout: 10_000,
    });

    if (process.env.CATS_RUN_SIM === "1") {
      await commandInput.fill("sim");
      await commandInput.press("Enter");
      await expect(
        page.getByText(/height:.*velocity:.*offset:/).last(),
      ).toBeVisible({
        timeout: 60_000,
      });
      await page.waitForTimeout(6000);
      await expect(page.getByText(/Board command timed out: sim/)).toHaveCount(
        0,
      );
      await expect(
        page.getByText("Simulation Successful.", { exact: true }),
      ).toBeVisible({ timeout: 360_000 });
      await page.waitForTimeout(500);
      await page.getByRole("button", { name: "disconnect" }).click();
      await expect(page.getByText("Status: Disconnected")).toBeVisible();
      return;
    }

    await page.evaluate(() => {
      window.location.hash = "#/logging";
    });
    await expect(page).toHaveURL(/#\/config$/);
    await expect(
      page.getByText("Main Altitude", { exact: true }),
    ).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "#/preflight";
    });
    await expect(
      page.getByText("Preflight Check", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Preflight Report", { exact: true }),
    ).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByText(/^(READY|WARNING)$/)).toBeVisible();
    await expect(page.getByText("Flight Event Sequence")).toBeVisible();
    await expect(page.getByText("Timer Chains", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "disconnect" }).click();
    await expect(page.getByText("Status: Disconnected")).toBeVisible();
  } finally {
    const process = application.process();
    await Promise.race([
      application.close(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (process.exitCode === null) process.kill();
  }
});
