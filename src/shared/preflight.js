import {
  EVENT_SETTINGS,
  LOG_ELEMENTS,
  TIMER_KEYS,
} from "../modules/settings.js";

const EVENT_SEQUENCE = [
  { key: "ev_liftoff", state: "LIFTOFF", label: "Liftoff", order: 2 },
  { key: "ev_burnout", state: "MAX_V", label: "Burnout / Max V", order: 3 },
  { key: "ev_apogee", state: "APOGEE", label: "Apogee", order: 4 },
  {
    key: "ev_main_deployment",
    state: "MAIN_DEPLOYMENT",
    label: "Main Deployment",
    order: 5,
  },
  { key: "ev_touchdown", state: "TOUCHDOWN", label: "Touchdown", order: 6 },
  { key: "ev_custom1", state: "CUSTOM_1", label: "Custom 1", order: 7 },
  { key: "ev_custom2", state: "CUSTOM_2", label: "Custom 2", order: 8 },
];

const STATE_ORDER = new Map([
  ["CALIBRATE", 0],
  ["READY", 1],
  ["LIFTOFF", 2],
  ["MOVING", 2],
  ["BURNOUT", 3],
  ["MAX_V", 3],
  ["APOGEE", 4],
  ["MAIN_DEPLOYMENT", 5],
  ["TOUCHDOWN", 6],
  ["CUSTOM_1", 7],
  ["CUSTOM_2", 8],
]);

const DEPLOYMENT_ACTIONS = new Set([2, 3, 5, 6]);
const EARLY_EVENT_KEYS = new Set(["ev_liftoff", "ev_burnout"]);

export const PREFLIGHT_CHECKS = Object.freeze([
  {
    id: "testing-mode",
    title: "Testing mode",
    description: "Warns when testing mode is enabled.",
  },
  {
    id: "liftoff-threshold",
    title: "Liftoff detection threshold",
    description: "Warns when liftoff detection acceleration is above 50 m/s².",
  },
  {
    id: "recording",
    title: "Flight recording",
    description:
      "Checks recording speed, selected data, and that an event starts LOG recording.",
  },
  {
    id: "deployment-plan",
    title: "Deployment plan",
    description:
      "Checks apogee and main deployment outputs, early deployment actions, and main altitude.",
  },
  {
    id: "timer-chains",
    title: "Timer chains",
    description:
      "Checks active timer values, event names, self-triggers, and cycles.",
  },
  {
    id: "event-order",
    title: "Event order",
    description:
      "Warns when an active timer triggers an earlier core flight state.",
  },
  {
    id: "recorder-stop",
    title: "Recorder stop",
    description:
      "Warns when armed recording is not stopped by the touchdown event.",
  },
]);

function normalizeState(value) {
  return String(value ?? "")
    .trim()
    .toUpperCase()
    .replaceAll(" ", "_");
}

function parseNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function parseConfiguredActions(rawValue) {
  const values = String(rawValue ?? "")
    .split(",")
    .map((value) => Number(value.trim()));
  const actions = [];
  for (let index = 0; index + 1 < values.length; index += 2) {
    const actionIndex = values[index];
    const value = values[index + 1];
    if (!actionIndex || !EVENT_SETTINGS[actionIndex]) continue;
    const setting = EVENT_SETTINGS[actionIndex];
    let displayValue = value;
    if (Array.isArray(setting.args) && setting.type === "SELECT") {
      displayValue =
        setting.args.find((option) => option.value === value)?.text ?? value;
    } else if (setting.unit) {
      displayValue = `${value} ${setting.unit}`;
    }
    actions.push({
      index: actionIndex,
      name: setting.name,
      value,
      summary: `${setting.name}: ${displayValue}`,
    });
  }
  return actions;
}

function check(
  id,
  category,
  status,
  title,
  detail,
  relatedKeys = [],
  review = null,
) {
  return { id, category, status, title, detail, relatedKeys, review };
}

function deploymentActions(actions) {
  return actions.filter(
    (action) =>
      DEPLOYMENT_ACTIONS.has(action.index) &&
      (action.index >= 5 || action.value === 1),
  );
}

function findGraphCycle(edges) {
  const graph = new Map();
  for (const [from, to] of edges) {
    if (!graph.has(from)) graph.set(from, []);
    graph.get(from).push(to);
  }
  const visiting = new Set();
  const visited = new Set();

  function visit(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      if (visit(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  return [...graph.keys()].some(visit);
}

export function simulateFlightSequence(values) {
  const liftoffThreshold = parseNumber(values.acc_threshold);
  const mainAltitude = parseNumber(values.main_altitude);
  const settingsByEvent = new Map([
    [
      "ev_liftoff",
      liftoffThreshold === null
        ? []
        : [`Liftoff detection: ${liftoffThreshold} m/s²`],
    ],
    [
      "ev_main_deployment",
      mainAltitude === null ? [] : [`Deployment altitude: ${mainAltitude} m`],
    ],
  ]);
  const events = EVENT_SEQUENCE.map((event) => ({
    id: event.key,
    kind: "event",
    order: event.order,
    title: event.label,
    trigger: event.state,
    detail: `Flight event: ${event.state}`,
    settings: settingsByEvent.get(event.key) ?? [],
    actions: parseConfiguredActions(values[event.key]).map(
      ({ summary }) => summary,
    ),
  }));
  const timers = TIMER_KEYS.flatMap((timer, index) => {
    const duration = parseNumber(values[`${timer}_duration`]);
    if (!duration || duration < 0) return [];
    const start = normalizeState(values[`${timer}_start`]);
    const trigger = normalizeState(values[`${timer}_trigger`]);
    return [
      {
        id: timer,
        kind: "timer",
        order: (STATE_ORDER.get(start) ?? 9) + 0.1 + index / 100,
        title: `Timer ${index + 1}`,
        trigger,
        detail: `${start} + ${duration} ms → ${trigger}`,
        settings: [],
        actions: [`Trigger event: ${trigger}`],
      },
    ];
  });
  return [...events, ...timers].sort((left, right) => left.order - right.order);
}

export function buildPreflightReport(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || !snapshot.values) {
    throw new TypeError("Preflight requires a board snapshot.");
  }
  const values = snapshot.values;
  const actionsByEvent = new Map(
    EVENT_SEQUENCE.map((event) => [
      event.key,
      parseConfiguredActions(values[event.key]),
    ]),
  );
  const checks = [];

  const testingEnabled = normalizeState(values.test_mode) === "ON";
  checks.push(
    check(
      "testing-mode",
      "Board mode",
      testingEnabled ? "warning" : "ready",
      testingEnabled ? "Testing mode is enabled" : "Testing mode is off",
      testingEnabled
        ? "Disable testing mode before preparing the vehicle for flight."
        : "The board is using normal flight behavior.",
      ["test_mode"],
      { label: "Open Configuration", route: "/config" },
    ),
  );

  const liftoffThreshold = parseNumber(values.acc_threshold);
  const liftoffThresholdWarning =
    liftoffThreshold === null || liftoffThreshold > 50;
  checks.push(
    check(
      "liftoff-threshold",
      "Flight detection",
      liftoffThresholdWarning ? "warning" : "ready",
      liftoffThreshold === null
        ? "Liftoff threshold is unavailable"
        : liftoffThresholdWarning
          ? "Liftoff threshold is high"
          : "Liftoff threshold is within the usual range",
      liftoffThreshold === null
        ? "The board did not provide a liftoff detection acceleration."
        : liftoffThresholdWarning
          ? `Liftoff detection acceleration is ${liftoffThreshold} m/s²; review values above 50 m/s².`
          : `Liftoff detection acceleration is ${liftoffThreshold} m/s².`,
      ["acc_threshold"],
      { label: "Open Configuration", route: "/config" },
    ),
  );

  const recordingElements = parseNumber(values.rec_elements);
  const knownRecordingMask = LOG_ELEMENTS.reduce(
    (mask, { dec }) => mask | dec,
    0,
  );
  const recordingDisabled =
    normalizeState(values.rec_speed) === "OFF" ||
    recordingElements === null ||
    (recordingElements & knownRecordingMask) === 0;
  const loggingEvents = EVENT_SEQUENCE.filter((event) =>
    actionsByEvent
      .get(event.key)
      .some((action) => action.index === 7 && action.value === 2),
  );
  const recordingBlocked = recordingDisabled || loggingEvents.length === 0;
  const recordingDetail = recordingDisabled
    ? "Recording speed or recorded elements are disabled."
    : loggingEvents.length === 0
      ? "No event starts the recorder in LOG mode."
      : `Recording starts at ${loggingEvents.map(({ label }) => label).join(", ")}.`;
  checks.push(
    check(
      "recording",
      "Recording",
      recordingBlocked ? "warning" : "ready",
      recordingBlocked
        ? "Flight recording is not armed"
        : "Flight recording is armed",
      recordingDetail,
      ["rec_speed", "rec_elements", ...loggingEvents.map(({ key }) => key)],
      recordingDisabled
        ? { label: "Review Logging", route: "/config?section=logging" }
        : { label: "Review Events", route: "/events" },
    ),
  );

  const apogeeDeployment = deploymentActions(actionsByEvent.get("ev_apogee"));
  const mainDeployment = deploymentActions(
    actionsByEvent.get("ev_main_deployment"),
  );
  const earlyDeployment = EVENT_SEQUENCE.flatMap((event) =>
    EARLY_EVENT_KEYS.has(event.key)
      ? deploymentActions(actionsByEvent.get(event.key)).map((action) => ({
          event,
          action,
        }))
      : [],
  );
  const mainAltitude = parseNumber(values.main_altitude);
  const deploymentIssues = [];
  if (!apogeeDeployment.length) {
    deploymentIssues.push("No deployment output is scheduled at apogee.");
  }
  if (!mainDeployment.length) {
    deploymentIssues.push(
      "No deployment output is scheduled at main deployment.",
    );
  }
  if (earlyDeployment.length) {
    deploymentIssues.push(
      `Deployment output is scheduled too early at ${[
        ...new Set(earlyDeployment.map(({ event }) => event.label)),
      ].join(", ")}.`,
    );
  }
  if (mainAltitude === null || mainAltitude <= 0) {
    deploymentIssues.push("Main deployment altitude is not a positive value.");
  }
  checks.push(
    check(
      "deployment-plan",
      "Deployment",
      deploymentIssues.length ? "warning" : "ready",
      deploymentIssues.length
        ? "Deployment plan is inconsistent"
        : "Apogee and main deployment outputs are configured",
      deploymentIssues.length
        ? deploymentIssues.join(" ")
        : `Apogee and main deployment use configured outputs; main altitude is ${mainAltitude} m.`,
      [
        "main_altitude",
        "ev_liftoff",
        "ev_burnout",
        "ev_apogee",
        "ev_main_deployment",
      ],
      { label: "Review Events", route: "/events" },
    ),
  );

  const timerEdges = [];
  const timerIssues = [];
  const orderingIssues = [];
  const activeTimers = [];
  for (const [index, timer] of TIMER_KEYS.entries()) {
    const start = normalizeState(values[`${timer}_start`]);
    const duration = parseNumber(values[`${timer}_duration`]);
    const trigger = normalizeState(values[`${timer}_trigger`]);
    if (duration === 0) continue;
    activeTimers.push(timer);
    if (duration === null || duration < 0) {
      timerIssues.push(`Timer ${index + 1} has an invalid duration.`);
      continue;
    }
    if (!STATE_ORDER.has(start) || !STATE_ORDER.has(trigger)) {
      timerIssues.push(`Timer ${index + 1} uses an unknown event.`);
      continue;
    }
    if (start === trigger) {
      timerIssues.push(`Timer ${index + 1} starts and triggers on ${start}.`);
    }
    timerEdges.push([start, trigger]);
    const startOrder = STATE_ORDER.get(start);
    const triggerOrder = STATE_ORDER.get(trigger);
    if (startOrder >= 2 && triggerOrder <= 6 && triggerOrder <= startOrder) {
      orderingIssues.push(
        `Timer ${index + 1} starts at ${start} but triggers ${trigger}.`,
      );
    }
  }
  if (findGraphCycle(timerEdges)) {
    timerIssues.push("Active timer triggers form a cycle.");
  }
  checks.push(
    check(
      "timer-chains",
      "Timers",
      timerIssues.length ? "warning" : "ready",
      timerIssues.length ? "Timer chain is invalid" : "Timer chains are valid",
      timerIssues.length
        ? timerIssues.join(" ")
        : activeTimers.length
          ? `${activeTimers.length} active timer${activeTimers.length === 1 ? "" : "s"} form an acyclic chain.`
          : "No timers are active.",
      activeTimers.flatMap((timer) => [
        `${timer}_start`,
        `${timer}_duration`,
        `${timer}_trigger`,
      ]),
      { label: "Review Timers", route: "/events?section=timers" },
    ),
  );
  checks.push(
    check(
      "event-order",
      "Event sequence",
      orderingIssues.length ? "warning" : "ready",
      orderingIssues.length
        ? "An event is triggered out of flight order"
        : "Event order is physically possible",
      orderingIssues.length
        ? orderingIssues.join(" ")
        : "Active timers do not trigger an earlier core flight state.",
      activeTimers.flatMap((timer) => [`${timer}_start`, `${timer}_trigger`]),
      { label: "Review Timers", route: "/events?section=timers" },
    ),
  );

  const touchdownRecorderOff = actionsByEvent
    .get("ev_touchdown")
    .some((action) => action.index === 7 && action.value === 0);
  if (!touchdownRecorderOff && !recordingBlocked) {
    checks.push(
      check(
        "recorder-stop",
        "Recording",
        "warning",
        "Recorder is not stopped at touchdown",
        "Consider adding Recorder: OFF to the touchdown event.",
        ["ev_touchdown"],
        { label: "Review Events", route: "/events" },
      ),
    );
  }

  const warningCount = checks.filter(
    ({ status }) => status === "warning",
  ).length;
  const readyCount = checks.filter(({ status }) => status === "ready").length;
  const status = warningCount ? "WARNING" : "READY";

  return {
    status,
    generatedAt: new Date().toISOString(),
    board: snapshot.board ?? {},
    summary: { warningCount, readyCount },
    checks,
    timeline: simulateFlightSequence(values),
  };
}
