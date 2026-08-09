import { _electron as electron, expect, test } from "@playwright/test";

async function launchFakeVega(testInfo, extraEnv = {}) {
  return electron.launch({
    args: [".", "--disable-gpu"],
    env: {
      ...process.env,
      CATS_FAKE_SERIAL: "1",
      CATS_FAKE_VEGA_COUNT: "1",
      CATS_E2E_USER_DATA: testInfo.outputPath("user-data"),
      ...extraEnv,
    },
  });
}

async function closeApplication(application) {
  const process = application.process();
  await Promise.race([
    application.close(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);
  if (process.exitCode === null) process.kill();
}

test("auto-connects a Vega that is present at startup", async ({}, testInfo) => {
  const application = await launchFakeVega(testInfo);

  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Status: Connected")).toBeVisible({
      timeout: 10_000,
    });
    await expect(page).toHaveURL(/#\/config$/);
    await expect(page.getByText("CATS test device")).toBeVisible();
  } finally {
    await closeApplication(application);
  }
});

test("detects a delayed Vega and respects manual disconnect", async ({}, testInfo) => {
  const application = await launchFakeVega(testInfo, {
    CATS_FAKE_SERIAL_APPEAR_AFTER_MS: "1500",
  });

  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Status: Disconnected")).toBeVisible();
    await expect(page.getByText("Status: Connected")).toBeVisible({
      timeout: 10_000,
    });

    await page.getByRole("button", { name: "disconnect" }).click();
    await expect(page.getByText("Status: Disconnected")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByText("Status: Disconnected")).toBeVisible();
    await expect(page.getByRole("button", { name: "Connect" })).toBeVisible();
  } finally {
    await closeApplication(application);
  }
});

test("requires manual selection when multiple Vegas are present", async ({}, testInfo) => {
  const application = await launchFakeVega(testInfo, {
    CATS_FAKE_VEGA_COUNT: "2",
  });

  try {
    const page = await application.firstWindow();
    await expect(page.getByText("Status: Disconnected")).toBeVisible();
    await page.waitForTimeout(2500);
    await expect(page.getByText("Status: Disconnected")).toBeVisible();

    await page.locator(".v-select .v-field").click();
    await expect(
      page.getByRole("option", { name: "CATS Vega (CATS-FAKE-1)" }),
    ).toBeVisible();
    await expect(
      page.getByRole("option", { name: "CATS Vega (CATS-FAKE-2)" }),
    ).toBeVisible();
  } finally {
    await closeApplication(application);
  }
});
