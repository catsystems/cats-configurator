import { _electron as electron, expect, test } from "@playwright/test";
import fs from "node:fs/promises";
import path from "node:path";

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

test("launches the packaged renderer and exercises the secure bridge", async ({}, testInfo) => {
  test.setTimeout(90_000);
  const fakeDrive = testInfo.outputPath("cats-drive");
  const localLog = testInfo.outputPath("local-flight.cfl");
  const secondLocalLog = testInfo.outputPath("second-flight.cfl");
  await fs.mkdir(fakeDrive, { recursive: true });
  await fs.writeFile(path.join(fakeDrive, "readme.txt"), "Welcome to CATS!\n");
  await fs.writeFile(path.join(fakeDrive, "fl7.cfl"), flightInfoFixture());
  await fs.writeFile(localLog, flightInfoFixture());
  await fs.writeFile(secondLocalLog, flightInfoFixture());
  const executablePath = process.env.CATS_E2E_EXECUTABLE;
  const application = await electron.launch({
    ...(executablePath ? { executablePath } : {}),
    args: executablePath ? ["--disable-gpu"] : [".", "--disable-gpu"],
    env: {
      ...process.env,
      CATS_FAKE_SERIAL: "1",
      CATS_FAKE_CATS_DRIVE: fakeDrive,
      CATS_E2E_USER_DATA: testInfo.outputPath("user-data"),
    },
  });
  const pageErrors = [];
  const consoleErrors = [];
  const remoteRequests = [];

  try {
    application.context().on("request", (request) => {
      if (/^https?:/.test(request.url())) remoteRequests.push(request.url());
    });

    const page = await application.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });

    await expect
      .poll(
        () =>
          application.evaluate(({ BrowserWindow }) => {
            const window = BrowserWindow.getAllWindows()[0];
            return {
              crashed: window.webContents.isCrashed(),
              loading: window.webContents.isLoading(),
              title: window.getTitle(),
              url: window.webContents.getURL(),
            };
          }),
        { timeout: 30_000 },
      )
      .toMatchObject({
        crashed: false,
        loading: false,
        title: "CATS Configurator",
      });
    await expect(page).toHaveTitle("CATS Configurator");
    await expect(page.getByText("Status: Disconnected")).toBeVisible();
    await expect(page.getByText("App version: 1.3.2")).toBeVisible();
    await expect(page.getByText("CATS", { exact: true })).toBeVisible();
    await expect(page.getByText("Configurator", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Control & Telemetry Systems", { exact: true }),
    ).toBeVisible();

    const flightsLink = page.getByRole("link", {
      name: "Flights",
      exact: true,
    });
    await expect(flightsLink).toHaveAttribute(
      "href",
      "https://flights.catsystems.io/",
    );
    await expect(flightsLink).toHaveAttribute("target", "_blank");

    const configurationLink = page.getByRole("link", {
      name: "Configuration",
      exact: true,
    });
    const flightLogsLink = page.getByRole("link", {
      name: "Flight Logs",
      exact: true,
    });
    await expect(configurationLink).toHaveAttribute("aria-disabled", "true");
    await expect(flightLogsLink).not.toHaveAttribute("aria-disabled", "true");
    await flightLogsLink.click();
    await expect(page).toHaveURL(/#\/flight-logs$/);
    await expect(
      page.getByText("Open a Vega flight log (.cfl)", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("Onboard logs", { exact: true })).toHaveCount(
      0,
    );

    const flightsMenuLayout = await page.evaluate(() => {
      const items = [...document.querySelectorAll(".v-list-item")];
      const cliItem = items.find((item) => item.textContent.trim() === "CLI");
      const flightLogsItem = items.find(
        (item) => item.textContent.trim() === "Flight Logs",
      );
      const flightsItem = items.find((item) =>
        item.textContent.trim().startsWith("Flights"),
      );
      const details = (item) => {
        const title = item.querySelector(".v-list-item-title");
        const bounds = item.getBoundingClientRect();
        const titleBounds = title.getBoundingClientRect();
        const style = getComputedStyle(title);
        return {
          height: bounds.height,
          titleX: titleBounds.x,
          fontSize: style.fontSize,
          fontWeight: style.fontWeight,
        };
      };
      return {
        cli: details(cliItem),
        flights: details(flightsItem),
        order: {
          cli: items.indexOf(cliItem),
          flightLogs: items.indexOf(flightLogsItem),
          flights: items.indexOf(flightsItem),
        },
      };
    });
    expect(flightsMenuLayout.flights).toEqual(flightsMenuLayout.cli);
    expect(flightsMenuLayout.order.cli).toBeLessThan(
      flightsMenuLayout.order.flightLogs,
    );
    expect(flightsMenuLayout.order.flightLogs).toBeLessThan(
      flightsMenuLayout.order.flights,
    );

    const typography = await page.evaluate(() => {
      const bodyStyle = getComputedStyle(document.body);
      const titleStyle = getComputedStyle(
        document.querySelector(".app-brand__title"),
      );
      const productStyle = getComputedStyle(
        document.querySelector(".app-brand__product"),
      );
      const taglineStyle = getComputedStyle(
        document.querySelector(".app-brand__tagline"),
      );
      return {
        bodyFamily: bodyStyle.fontFamily,
        titleFamily: titleStyle.fontFamily,
        titleWeight: titleStyle.fontWeight,
        productColor: productStyle.color,
        taglineFamily: taglineStyle.fontFamily,
        taglineWeight: taglineStyle.fontWeight,
        taglineTransform: taglineStyle.textTransform,
      };
    });
    expect(typography).toMatchObject({
      titleWeight: "700",
      productColor: "rgb(255, 167, 38)",
      taglineWeight: "400",
      taglineTransform: "uppercase",
    });
    expect(typography.bodyFamily).toContain("Inter Variable");
    expect(typography.titleFamily).toContain("Space Grotesk Variable");
    expect(typography.taglineFamily).toContain("Space Grotesk Variable");

    const shellLayout = await page.evaluate(() => {
      const bounds = (selector) => {
        const { x, y, width, height, bottom } = document
          .querySelector(selector)
          .getBoundingClientRect();
        return { x, y, width, height, bottom };
      };
      const mainStyles = getComputedStyle(document.querySelector(".v-main"));
      const logo = document.querySelector(".app-brand__mark");

      return {
        viewportHeight: window.innerHeight,
        appBar: bounds(".v-app-bar"),
        drawer: bounds(".v-navigation-drawer"),
        footer: bounds(".v-footer"),
        alert: bounds(".v-alert"),
        mainPadding: {
          top: mainStyles.paddingTop,
          right: mainStyles.paddingRight,
          bottom: mainStyles.paddingBottom,
          left: mainStyles.paddingLeft,
        },
        logoLoaded: logo.complete && logo.naturalWidth > 0,
      };
    });

    expect(shellLayout.appBar.height).toBe(64);
    expect(shellLayout.drawer).toMatchObject({
      x: 0,
      y: 64,
      width: 300,
    });
    expect(shellLayout.drawer.bottom).toBeCloseTo(
      shellLayout.viewportHeight - 32,
      0,
    );
    expect(shellLayout.footer).toMatchObject({ height: 32 });
    expect(shellLayout.footer.bottom).toBeCloseTo(
      shellLayout.viewportHeight,
      0,
    );
    expect(shellLayout.alert.height).toBeLessThan(100);
    expect(shellLayout.mainPadding).toEqual({
      top: "64px",
      right: "0px",
      bottom: "32px",
      left: "300px",
    });
    expect(shellLayout.logoLoaded).toBe(true);

    const bridge = await page.evaluate(() => ({
      catsType: typeof window.cats,
      rendererType: typeof window.renderer,
      disposerType: typeof window.cats.app.onAlert(() => {}),
    }));
    expect(bridge).toEqual({
      catsType: "object",
      rendererType: "undefined",
      disposerType: "function",
    });

    await expect
      .poll(() => page.evaluate(() => window.cats.serial.list()))
      .toEqual([{ path: "CATS-FAKE", manufacturer: "CATS Systems" }]);

    await page.locator(".v-select .v-field").click();
    await page.getByRole("option", { name: "CATS-FAKE", exact: true }).click();
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await expect(page.getByText("Status: Connected")).toBeVisible();
    await expect(page).toHaveURL(/#\/config$/);

    const appBarActionGap = await page.evaluate(() => {
      const action = document.querySelector(
        ".app-bar-controls .v-btn:last-child",
      );
      return window.innerWidth - action.getBoundingClientRect().right;
    });
    expect(appBarActionGap).toBeGreaterThanOrEqual(16);

    await expect(
      page.getByText("Main Altitude", { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("CATS test device")).toBeVisible();

    await flightLogsLink.click();
    await expect(page).toHaveURL(/#\/flight-logs$/);
    await expect(page.getByText("Onboard logs", { exact: true })).toBeVisible();
    await expect(page.getByText("fl7.cfl", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "View locally" }).click();
    await expect(page.getByText("Current log", { exact: true })).toBeVisible();
    await expect(page.getByText("fl7.cfl", { exact: true })).toHaveCount(2);

    await page.locator('input[type="file"]').setInputFiles(localLog);
    await expect(
      page.getByText("local-flight.cfl", { exact: true }),
    ).toHaveCount(2);
    await expect(page.locator(".js-plotly-plot")).toHaveCount(8);

    const unitSwitch = page.getByRole("checkbox", {
      name: "Use imperial units",
    });
    await unitSwitch.check();
    await expect(unitSwitch).toBeChecked();
    await expect(page.locator(".js-plotly-plot")).toHaveCount(8);

    await page.locator('input[type="file"]').setInputFiles(secondLocalLog);
    await expect(
      page.getByText("second-flight.cfl", { exact: true }),
    ).toHaveCount(2);
    await expect(page.locator(".flight-log-error")).toHaveCount(0);
    await expect(page.locator(".js-plotly-plot")).toHaveCount(8);

    await configurationLink.click();
    await expect(page).toHaveURL(/#\/config$/);

    const testingHeadingGap = await page.evaluate(() => {
      const testingCard = document.querySelector(".testing-card");
      const title = testingCard.querySelector(".v-card-title");
      const firstField = testingCard.querySelector(".config-row .v-col div");
      const textBounds = (element) => {
        const range = document.createRange();
        range.selectNodeContents(element);
        return range.getBoundingClientRect();
      };
      return textBounds(firstField).top - textBounds(title).bottom;
    });
    expect(testingHeadingGap).toBeGreaterThanOrEqual(12);

    await page.evaluate(() => {
      window.location.hash = "#/events";
    });
    await expect(page.getByText(/^liftoff$/i)).toBeVisible();
    await expect(page.getByText(/^recorder$/i)).toBeVisible();
    await expect(page.getByText(/^log$/i)).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "#/timer";
    });
    await expect(page.getByText(/^timer 1$/i)).toBeVisible();
    await expect(page.getByText("Start", { exact: true })).toBeVisible();
    await expect(page.locator('input[type="number"]').first()).toHaveValue(
      "1000",
    );
    const activeTimerSwitch = page.locator(".timer-switch").first();
    await expect(activeTimerSwitch).toHaveClass(/timer-switch--active/);
    await expect(activeTimerSwitch.locator(".v-switch__track")).toHaveCSS(
      "background-color",
      "rgb(255, 167, 38)",
    );
    const inactiveTimerSwitch = page.locator(".timer-switch").nth(1);
    await expect(inactiveTimerSwitch).not.toHaveClass(/timer-switch--active/);
    await expect(inactiveTimerSwitch.locator(".v-switch__track")).not.toHaveCSS(
      "background-color",
      "rgb(255, 167, 38)",
    );

    for (const route of ["/cli", "/config", "/cli"]) {
      await page.evaluate((path) => {
        window.location.hash = `#${path}`;
      }, route);
      await expect(page).toHaveURL(
        new RegExp(`#${route.replace("/", "\\/")}$`),
      );
    }

    await page.evaluate(() => {
      window.location.hash = "#/cli";
    });
    const commandInput = page.getByPlaceholder("Write your command here");
    await commandInput.fill("status");
    await commandInput.press("Enter");
    await expect(page.getByText("test> status")).toBeVisible();
    await expect(page.getByText("test> status")).toHaveCount(1);

    expect(pageErrors).toEqual([]);
    expect(consoleErrors).toEqual([]);
    expect(remoteRequests).toEqual([]);
  } finally {
    const process = application.process();
    await Promise.race([
      application.close(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (process.exitCode === null) process.kill();
  }
});
