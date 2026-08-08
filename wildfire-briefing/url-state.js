"use strict";

(function exposeURLState(global, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  global.WildfireBriefingURL = api;
})(globalThis, () => {
  function buildReportURL(currentURL, { reportDate, latestReportDate, section = "overview" }) {
    const url = new URL(currentURL);
    if (reportDate && reportDate !== latestReportDate) url.searchParams.set("date", reportDate);
    else url.searchParams.delete("date");
    if (section && section !== "overview") url.searchParams.set("section", section);
    else url.searchParams.delete("section");
    return url;
  }

  return { buildReportURL };
});
