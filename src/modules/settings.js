export const EVENT_SETTINGS = [
  { name: null, args: null, type: null, unit: null },
  { name: "Delay", args: [0, 16000], type: "NUMBER", unit: "ms" },
  {
    name: "Pyro 1",
    args: [
      { text: "OFF", value: 0 },
      { text: "ON", value: 1 },
    ],
    type: "SELECT",
    unit: null,
  },
  {
    name: "Pyro 2",
    args: [
      { text: "OFF", value: 0 },
      { text: "ON", value: 1 },
    ],
    type: "SELECT",
    unit: null,
  },
  {
    name: "IO 1",
    args: [
      { text: "OFF", value: 0 },
      { text: "ON", value: 1 },
    ],
    type: "SELECT",
    unit: null,
  },
  { name: "Servo 1", args: [0, 1000], type: "NUMBER", unit: "‰" },
  { name: "Servo 2", args: [0, 1000], type: "NUMBER", unit: "‰" },
  {
    name: "Recorder",
    args: [
      { text: "OFF", value: 0 },
      { text: "PRE", value: 1 },
      { text: "LOG", value: 2 },
    ],
    type: "SELECT",
    unit: null,
  },
];

export const CONFIG_SETTINGS = {
  main_altitude: { section: "general", name: "Main Altitude", unit: "m" },
  acc_threshold: {
    section: "general",
    name: "Liftoff Detection Acceleration",
    unit: "m/s²",
  },
  servo1_init_pos: {
    section: "general",
    name: "Initial Position Servo 1",
    unit: "‰",
  },
  servo2_init_pos: {
    section: "general",
    name: "Initial Position Servo 2",
    unit: "‰",
  },
  tele_enable: { section: "telemetry", name: "Enable Telemetry", unit: null },
  tele_link_phrase: { section: "telemetry", name: "Link Phrase", unit: null },
  tele_power_level: {
    section: "telemetry",
    name: "Telemetry Power Level",
    unit: "dBm",
  },
  tele_adaptive_power: {
    section: "telemetry",
    name: "Adaptive Power Level",
    unit: null,
  },
  test_mode: { section: "testing", name: "Enable Testing Mode", unit: null },
  tele_test_phrase: { section: "testing", name: "Testing Phrase", unit: null },
};

export const LOG_ELEMENTS = [
  {
    name: "IMU",
    description: "Raw accelerometer and gyroscope samples from each IMU.",
    dec: 16,
    hex: 0x10,
    size: 20,
    bit: 4,
  },
  {
    name: "Barometer",
    description: "Raw pressure and temperature samples from each barometer.",
    dec: 32,
    hex: 0x20,
    size: 16,
    bit: 5,
  },
  {
    name: "Flight Info",
    description: "Estimated altitude, velocity, and acceleration.",
    dec: 64,
    hex: 0x40,
    size: 20,
    bit: 6,
  },
  {
    name: "Orientation",
    description: "The four-component estimated orientation.",
    dec: 128,
    hex: 0x80,
    size: 16,
    bit: 7,
  },
  {
    name: "Filtered Data",
    description: "Filtered altitude above ground and vertical acceleration.",
    dec: 256,
    hex: 0x100,
    size: 16,
    bit: 8,
  },
  {
    name: "Flight State",
    description: "The current flight phase, from calibration to touchdown.",
    dec: 512,
    hex: 0x200,
    size: 12,
    bit: 9,
  },
  {
    name: "Event Info",
    description: "Triggered flight events and their peripheral actions.",
    dec: 1024,
    hex: 0x400,
    size: 16,
    bit: 10,
  },
  {
    name: "Error Info",
    description: "Errors reported by the flight computer.",
    dec: 2048,
    hex: 0x800,
    size: 12,
    bit: 11,
  },
  {
    name: "GNSS",
    description: "GNSS latitude, longitude, and satellite count.",
    dec: 4096,
    hex: 0x1000,
    size: 17,
    bit: 12,
  },
  {
    name: "Voltage",
    description: "Measured board supply voltage.",
    dec: 8192,
    hex: 0x2000,
    size: 10,
    bit: 13,
  },
];

export const TIMER_KEYS = ["timer1", "timer2", "timer3", "timer4"];
export const EVENT_KEYS = [
  "ev_liftoff",
  "ev_burnout",
  "ev_apogee",
  "ev_main_deployment",
  "ev_touchdown",
  "ev_custom1",
  "ev_custom2",
];
export const LOG_KEYS = ["rec_speed", "rec_elements"];

export const CONFIG_KEYS = Object.keys(CONFIG_SETTINGS);
export const TIMER_FIELDS = ["start", "duration", "trigger"];
export const TIMER_CONFIG_KEYS = TIMER_KEYS.flatMap((timer) =>
  TIMER_FIELDS.map((field) => `${timer}_${field}`),
);
export const PROFILE_BOARD_KEYS = [
  ...CONFIG_KEYS,
  ...EVENT_KEYS,
  ...TIMER_CONFIG_KEYS,
  ...LOG_KEYS,
];
