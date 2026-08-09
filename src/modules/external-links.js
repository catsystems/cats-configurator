const allowedExternalUrls = [
  {
    hostname: "github.com",
    matchesPath: (pathname) => pathname.startsWith("/catsystems/"),
  },
  {
    hostname: "flights.catsystems.io",
    matchesPath: () => true,
  },
];

export function isAllowedExternalUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:" || url.port || url.username || url.password) {
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
