import { _electron as electron, expect, test } from "@playwright/test";

const hardwarePort = process.env.CATS_HARDWARE_PORT;
test.skip(
  !hardwarePort,
  "Set CATS_HARDWARE_PORT to run the Vega hardware test.",
);

test("connects to a real CATS Vega without modifying configuration", async ({}, testInfo) => {
  test.setTimeout(60_000);
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

    await page.evaluate(
      (portPath) => window.cats.serial.connect(portPath),
      hardwarePort,
    );
    await expect(page.getByText("Status: Connected")).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Board: CATS Vega")).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "#/cli";
    });
    const commandInput = page.getByPlaceholder("Write your command here");
    await commandInput.fill("status");
    await commandInput.press("Enter");
    await expect(page.getByText(/State:\s+READY/)).toBeVisible({
      timeout: 10_000,
    });

    await page.evaluate(() => window.cats.serial.disconnect());
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
