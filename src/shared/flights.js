const PRODUCTION_ORIGIN = "https://flights.catsystems.io";

const compiledOrigin = globalThis.__CATS_FLIGHTS_ORIGIN__;
const compiledTarget = globalThis.__CATS_FLIGHTS_TARGET__;

export const CATS_FLIGHTS_ORIGIN =
  typeof compiledOrigin === "string" ? compiledOrigin : PRODUCTION_ORIGIN;
export const CATS_FLIGHTS_TARGET =
  compiledTarget === "staging" ? "staging" : "production";
export const CATS_FLIGHTS_ANALYZE_URL = `${CATS_FLIGHTS_ORIGIN}/analyze`;
export const CATS_FLIGHTS_HOME_URL = `${CATS_FLIGHTS_ORIGIN}/`;
