import { CATS_FLIGHTS_ORIGIN } from "../shared/flights.js";

const flightsUrl = new URL(CATS_FLIGHTS_ORIGIN);

const allowedExternalUrls = [
  {
    hostname: "github.com",
    matchesPath: (pathname) => pathname.startsWith("/catsystems/"),
  },
  {
    hostname: flightsUrl.hostname,
    matchesPath: () => true,
  },
];

export function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password) {
      return false;
    }

    if (
      url.hostname === flightsUrl.hostname &&
      url.origin !== flightsUrl.origin
    ) {
      return false;
    }

    const allowedUrl = allowedExternalUrls.find(
      ({ hostname }) => url.hostname === hostname,
    );
    return Boolean(allowedUrl?.matchesPath(url.pathname));
  } catch {
    return false;
  }
}
