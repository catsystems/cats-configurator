// --- Conversion Constants ---
const METERS_TO_FEET = 3.28084;
const MPS_TO_FPS = 3.28084; // Meters per second to feet per second
const MPS2_TO_FPS2 = 3.28084; // Meters per second squared to feet per second squared
const PSI_TO_KPA = 6.89476; // Pounds per square inch to Kilopascals

// --- Core Unit Label Getter ---
/**
 * Gets the appropriate unit label for a given parameter and unit system.
 * @param {string} paramName - The name of the parameter (e.g., 'altitude', 'velocity').
 * @param {string} unitSystem - The desired unit system ('metric' or 'imperial').
 * @returns {string} The unit label (e.g., 'm', 'ft', 'kPa', 'psi').
 */
export function getUnitLabel(paramName, unitSystem) {
  const isImperial = unitSystem === 'imperial';

  switch (paramName) {
    case 'altitude':
      return isImperial ? 'ft' : 'm';
    case 'velocity':
      return isImperial ? 'ft/s' : 'm/s';
    case 'acceleration':
      return isImperial ? 'ft/s²' : 'm/s²'; // Base label for acceleration
    case 'pressure':
      return isImperial ? 'psi' : 'kPa';   // Base label for pressure
    case 'temperature':
      return isImperial ? '°F' : '°C';     // Base label for temperature
    // Add more parameters as needed (e.g., 'angularVelocity', 'batteryVoltage')
    default:
      console.warn(`Unknown parameter for unit label: ${paramName}`);
      return ''; // Return empty for unknown parameters
  }
}

// --- Specific Value Conversion Functions (from Metric Base Units) ---

/**
 * Converts length from meters to feet.
 * @param {number} meters - Value in meters.
 * @returns {number} Converted value.
 */
export function convertLengthToImperial(meters) {
  return meters * METERS_TO_FEET;
}

/**
 * Converts velocity from m/s to ft/s.
 * @param {number} mps - Value in meters per second.
 * @returns {number} Converted value.
 */
export function convertVelocityToImperial(mps) {
  return mps * MPS_TO_FPS;
}

/**
 * Converts acceleration from m/s² to ft/s².
 * @param {number} mps2 - Value in meters per second squared.
 * @returns {number} Converted value.
 */
export function convertAccelerationToImperial(mps2) {
  return mps2 * MPS2_TO_FPS2;
}

/**
 * Converts pressure from kPa to psi.
 * @param {number} kpa - Value in Kilopascals.
 * @returns {number} Converted value.
 */
export function convertPressureToImperial(kpa) {
  return kpa / PSI_TO_KPA;
}

/**
 * Converts temperature from Celsius to Fahrenheit
 * @param {number} celsius - Value in Celsius.
 * @returns {number} Converted value.
 */
export function convertTemperatureToImperial(celsius) {
  return (celsius * 9 / 5) + 32;
}

/**
 * Converts length from feet to meters.
 * @param {number} feet - Value in feet.
 * @returns {number} Converted value in meters.
 */
export function convertLengthToMetric(feet) {
  return feet / METERS_TO_FEET;
}

/**
 * Converts velocity from ft/s to m/s.
 * @param {number} fps - Value in feet per second.
 * @returns {number} Converted value in meters per second.
 */
export function convertVelocityToMetric(fps) {
  return fps / MPS_TO_FPS;
}

/**
 * Converts acceleration from ft/s² to m/s².
 * @param {number} fps2 - Value in feet per second squared.
 * @returns {number} Converted value in meters per second squared.
 */
export function convertAccelerationToMetric(fps2) {
  return fps2 / MPS2_TO_FPS2;
}

/**
 * Converts pressure from psi to kPa.
 * @param {number} psi - Value in pounds per square inch.
 * @returns {number} Converted value in Kilopascals.
 */
export function convertPressureToMetric(psi) {
  return psi * PSI_TO_KPA;
}

/**
 * Converts temperature from Fahrenheit to Celsius.
 * @param {number} fahrenheit - Value in Fahrenheit.
 * @returns {number} Converted value in Celsius.
 */
export function convertTemperatureToMetric(fahrenheit) {
  return (fahrenheit - 32) * 5 / 9;
}

/**
 * Formats a raw metric value for display in the target unit system,
 * including applying specific display unit options and decimal precision.
 * Assumes rawValue is always in its standard metric (SI) unit.
 *
 * @param {number} rawValue - The raw numeric value from the board (always in metric SI base units).
 * @param {string} paramName - The name of the parameter (e.g., 'altitude', 'acceleration').
 * @param {object} [options={}] - Optional display settings.
 * @param {boolean} [options.numeric=true] - If true, returns a numeric value; if false, returns a formatted string.
 * @param {number} [options.decimals=2] - Number of decimal places for rounding.
 * @param {string} [options.targetUnitSystem='imperial'] - The target unit system for conversion ('metric' or 'imperial').
 * @param {boolean} [options.excludeLabel=false] - If true, excludes the unit label from the returned string.
 * @returns {number|string} The formatted value, either as a number or a string with unit label.
 */
export function getDisplayValue(rawValue, paramName, options = {}) {
  // Handle null/undefined values
  if (rawValue === null || rawValue === undefined) {
    return '-';
  }

  // Ensure options have defaults
  const { numeric = true, decimals = 2, targetUnitSystem = "imperial", excludeLabel = false } = options;
  let parsedValue = parseFloat(rawValue);
  let convertedValue;

  if (isNaN(parsedValue)) {
    return '-';
  }

  let unitLabel = '';

  switch (paramName) {
    case 'altitude':
      convertedValue = convertLengthToImperial(rawValue);
      break;
    case 'velocity':
      convertedValue = convertVelocityToImperial(rawValue);
      break;
    case 'acceleration':
      convertedValue = convertAccelerationToImperial(rawValue);
      break;
    case 'pressure':
      convertedValue = convertPressureToImperial(rawValue);
      break;
    case 'temperature':
      convertedValue = convertTemperatureToImperial(rawValue);
      break;
    default:
      break;
  }
  unitLabel = getUnitLabel(paramName, targetUnitSystem);

  if (numeric) return convertedValue;

  return options.excludeLabel ? `${convertedValue.toFixed(decimals)}` : `${convertedValue.toFixed(decimals)}${unitLabel}`
}
