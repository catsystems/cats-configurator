import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { _electron as electron } from "playwright";

const referenceExecutable = process.env.CATS_REFERENCE_EXECUTABLE;
const candidateExecutable = process.env.CATS_CANDIDATE_EXECUTABLE;
const hardwarePort = process.env.CATS_HARDWARE_PORT;
const candidateUsesSource = process.env.CATS_CANDIDATE_SOURCE === "1";
const outputRoot = path.resolve(
  process.env.CATS_VISUAL_OUTPUT ?? "test-results/release-comparison",
);
const flightLogFixturePath = path.join(outputRoot, "flight-info.cfl");

if (!referenceExecutable || !candidateExecutable || !hardwarePort) {
  throw new Error(
    "Set CATS_REFERENCE_EXECUTABLE, CATS_CANDIDATE_EXECUTABLE, and CATS_HARDWARE_PORT.",
  );
}

await mkdir(outputRoot, { recursive: true });
const flightLogFixture = Buffer.alloc(22);
flightLogFixture.write("v", 0, "ascii");
flightLogFixture.writeUInt8(0, 1);
flightLogFixture.writeUInt32LE(1000, 2);
flightLogFixture.writeUInt32LE(1 << 6, 6);
flightLogFixture.writeFloatLE(123.5, 10);
flightLogFixture.writeFloatLE(45.25, 14);
flightLogFixture.writeFloatLE(9.81, 18);
await writeFile(flightLogFixturePath, flightLogFixture);

const routes = [
  { name: "configuration", path: "/config", readyText: "General" },
  { name: "events", path: "/events", readyText: "Add Action" },
  { name: "timers", path: "/timer", readyText: "TIMER 1" },
  { name: "cli", path: "/cli", readyText: "Write your command here" },
];

async function captureRelease(label, executablePath, useSource = false) {
  const outputDirectory = path.join(outputRoot, label);
  await mkdir(outputDirectory, { recursive: true });

  const application = await electron.launch({
    executablePath,
    args: [
      ...(useSource ? [path.resolve(".")] : []),
      "--disable-gpu",
      `--user-data-dir=${path.join(outputDirectory, "profile")}`,
    ],
    env: {
      ...process.env,
      CATS_E2E_USER_DATA: path.join(outputDirectory, "profile"),
    },
  });
  const childProcess = application.process();
  const runtimeErrors = [];

  async function saveDialogLayout(page, name) {
    await writeFile(
      path.join(outputDirectory, `${name}-layout.json`),
      JSON.stringify(
        await page.evaluate(() => {
          const dialog = [
            ...document.querySelectorAll(".v-dialog .v-card"),
          ].find((element) => element.getBoundingClientRect().height > 0);
          const bounds = dialog.getBoundingClientRect();
          return {
            x: bounds.x,
            y: bounds.y,
            width: bounds.width,
            height: bounds.height,
            children: [
              ...dialog.querySelectorAll(
                ".v-card, .v-card-title, .v-card__title, .v-card-text, .v-card__text, .v-row, .row, .v-col, [class*='col-'], .v-input, .v-btn",
              ),
            ].map((element) => {
              const elementBounds = element.getBoundingClientRect();
              return {
                className: element.className,
                text: element.innerText?.trim().slice(0, 40),
                x: elementBounds.x,
                y: elementBounds.y,
                width: elementBounds.width,
                height: elementBounds.height,
              };
            }),
          };
        }),
        null,
        2,
      ),
    );
  }

  try {
    const page = await application.firstWindow();
    page.on("pageerror", (error) => runtimeErrors.push(error.message));
    page.on("console", (message) => {
      if (message.type() === "error") runtimeErrors.push(message.text());
    });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(500);
    await writeFile(
      path.join(outputDirectory, "runtime.json"),
      JSON.stringify(
        await page.evaluate(() => ({
          innerWidth: window.innerWidth,
          innerHeight: window.innerHeight,
          devicePixelRatio: window.devicePixelRatio,
          screenWidth: window.screen.width,
          screenHeight: window.screen.height,
          bodyFontFamily: getComputedStyle(document.body).fontFamily,
          applicationFontFamily: getComputedStyle(
            document.querySelector(".v-application"),
          ).fontFamily,
          userAgent: navigator.userAgent,
        })),
        null,
        2,
      ),
    );
    await page.screenshot({ path: path.join(outputDirectory, "home.png") });
    await writeFile(
      path.join(outputDirectory, "home-layout.json"),
      JSON.stringify(
        await page.evaluate(() =>
          [...document.querySelectorAll("main .v-card")].map((card) => {
            const bounds = card.getBoundingClientRect();
            return {
              text: card.innerText.trim().slice(0, 80),
              x: bounds.x,
              y: bounds.y,
              width: bounds.width,
              height: bounds.height,
              children: [...card.children].map((child) => {
                const childBounds = child.getBoundingClientRect();
                return {
                  className: child.className,
                  height: childBounds.height,
                };
              }),
            };
          }),
        ),
        null,
        2,
      ),
    );

    const bridge = await page.evaluate(() =>
      typeof window.cats === "object" ? "cats" : "renderer",
    );
    if (bridge === "cats") {
      await page.evaluate(
        (port) => window.cats.serial.connect(port),
        hardwarePort,
      );
    } else {
      await page.evaluate(
        (port) => window.renderer.send("CONNECT", port),
        hardwarePort,
      );
    }

    await page.waitForFunction(
      () => document.body.innerText.includes("Status: Connected"),
      undefined,
      { timeout: 20_000 },
    );
    await page.waitForTimeout(1_500);

    for (const route of routes) {
      if (bridge === "cats") {
        await page.evaluate((routePath) => {
          window.location.hash = `#${routePath}`;
          window.scrollTo(0, 0);
        }, route.path);
      } else {
        await page.evaluate((routePath) => {
          document.querySelector("#app").__vue__.$router.push(routePath);
          window.scrollTo(0, 0);
        }, route.path);
      }
      try {
        if (route.readyText === "Write your command here") {
          await page
            .getByPlaceholder(route.readyText)
            .waitFor({ state: "visible", timeout: 10_000 });
        } else {
          await page
            .getByText(route.readyText, { exact: false })
            .first()
            .waitFor({ state: "visible", timeout: 10_000 });
        }
      } catch {
        console.warn(
          `${label}: ${route.name} did not expose expected text "${route.readyText}" at ${page.url()}`,
        );
      }
      await page.waitForTimeout(500);
      if (route.name === "timers") {
        await writeFile(
          path.join(outputDirectory, "timers-layout.json"),
          JSON.stringify(
            await page.evaluate(() =>
              [...document.querySelectorAll(".v-card")]
                .filter((card) => card.innerText.includes("TIMER"))
                .map((card) => {
                  const column = card.parentElement;
                  const bounds = column.getBoundingClientRect();
                  return {
                    className: column.className,
                    x: bounds.x,
                    y: bounds.y,
                    width: bounds.width,
                    height: bounds.height,
                  };
                }),
            ),
            null,
            2,
          ),
        );
      }
      if (route.name === "configuration" || route.name === "events") {
        await writeFile(
          path.join(outputDirectory, `${route.name}-layout.json`),
          JSON.stringify(
            await page.evaluate(() =>
              [...document.querySelectorAll("main .v-card")].map((card) => {
                const bounds = card.getBoundingClientRect();
                return {
                  text: card.innerText.trim().slice(0, 80),
                  x: bounds.x,
                  y: bounds.y,
                  width: bounds.width,
                  height: bounds.height,
                  children: [...card.children].map((child) => {
                    const childBounds = child.getBoundingClientRect();
                    return {
                      className: child.className,
                      y: childBounds.y,
                      height: childBounds.height,
                    };
                  }),
                };
              }),
            ),
            null,
            2,
          ),
        );
      }
      await page.screenshot({
        path: path.join(outputDirectory, `${route.name}.png`),
      });

      if (route.name === "configuration") {
        const unitSwitch = page.locator('input[type="checkbox"]').last();
        await unitSwitch.click({ force: true });
        await page.waitForTimeout(250);
        await page.screenshot({
          path: path.join(outputDirectory, "configuration-imperial.png"),
        });
        await unitSwitch.click({ force: true });
      }

      if (route.name === "events") {
        await page.getByText("Add Action", { exact: true }).first().click();
        await page
          .locator(".v-dialog")
          .getByText("Add Action", { exact: true })
          .first()
          .waitFor({ state: "visible" });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(outputDirectory, "events-add-dialog.png"),
        });
        await saveDialogLayout(page, "events-add-dialog");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
        await page.locator(".mdi-cog").first().click();
        await page
          .locator(".v-dialog")
          .getByText("Edit Action", { exact: true })
          .waitFor({ state: "visible" });
        await page.waitForTimeout(300);
        await page.screenshot({
          path: path.join(outputDirectory, "events-edit-dialog.png"),
        });
        await saveDialogLayout(page, "events-edit-dialog");
        await page.keyboard.press("Escape");
        await page.waitForTimeout(300);
      }

      if (route.name === "timers") {
        const timerSwitch = page.locator('main input[type="checkbox"]').first();
        await timerSwitch.click({ force: true });
        await page
          .getByText("Start", { exact: true })
          .first()
          .waitFor({ state: "visible" });
        await page.screenshot({
          path: path.join(outputDirectory, "timers-active.png"),
        });
        await timerSwitch.click({ force: true });
      }

      if (route.name === "cli") {
        const commandInput = page.getByPlaceholder("Write your command here");
        await commandInput.fill("status");
        await commandInput.press("Enter");
        await page.waitForTimeout(750);
        await page.screenshot({
          path: path.join(outputDirectory, "cli-status.png"),
        });
      }
    }

    if (bridge === "cats") {
      await page.evaluate(() => window.cats.serial.disconnect());
    } else {
      await page.evaluate(() => window.renderer.send("DISCONNECT"));
    }
    await page.waitForTimeout(300);

    const fileInput = page.locator('input[type="file"]');
    await fileInput.waitFor({ state: "attached", timeout: 10_000 });
    await fileInput.setInputFiles(flightLogFixturePath);
    await page
      .getByText("Export CSV", { exact: true })
      .waitFor({ state: "visible", timeout: 20_000 });
    const firstPlot = page.locator(".js-plotly-plot").first();
    await firstPlot.waitFor({ state: "visible", timeout: 20_000 });
    await page.screenshot({
      path: path.join(outputDirectory, "home-flight-log.png"),
    });
    await firstPlot.scrollIntoViewIfNeeded();
    await page.waitForTimeout(250);
    await page.screenshot({
      path: path.join(outputDirectory, "home-flight-log-plot.png"),
    });

    if (label === "1.3.0" && runtimeErrors.length) {
      throw new Error(
        `${label} emitted runtime errors:\n${runtimeErrors.join("\n")}`,
      );
    }
  } finally {
    await Promise.race([
      application.close(),
      new Promise((resolve) => setTimeout(resolve, 5_000)),
    ]);
    if (childProcess.exitCode === null) childProcess.kill();
  }
}

await captureRelease("0.3.10", referenceExecutable);
await captureRelease("1.3.0", candidateExecutable, candidateUsesSource);
