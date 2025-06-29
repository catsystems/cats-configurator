export function formatDateTime(date) {
  if (!(date instanceof Date)) {
    console.error("Invalid date object provided.");
    return "";
  }

  const options = { year: "numeric", month: "2-digit", day: "2-digit" };
  const formattedDate = date
    .toLocaleDateString("en-US", options)
    .replace(/\//g, "");

  const formattedTime = date.toLocaleTimeString("en-UK").replace(/:/g, "");

  return `${formattedDate}_${formattedTime}`;
}
