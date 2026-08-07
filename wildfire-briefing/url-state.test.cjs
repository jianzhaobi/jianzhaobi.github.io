"use strict";

const assert = require("node:assert/strict");
const { buildReportURL } = require("./url-state.js");

const base = "https://jianzhaobi.github.io/wildfire-briefing/";
const latest = "2026-08-07";

assert.equal(
  buildReportURL(`${base}?date=${latest}`, { reportDate: latest, latestReportDate: latest }).href,
  base,
  "A manually supplied latest date should resolve to the canonical base URL",
);
assert.equal(
  buildReportURL(base, { reportDate: "2026-08-06", latestReportDate: latest }).href,
  `${base}?date=2026-08-06`,
  "Historical reports must retain a date deep link",
);
assert.equal(
  buildReportURL(`${base}?date=2026-08-06`, { reportDate: latest, latestReportDate: latest }).href,
  base,
  "Returning to the latest report must remove a now-redundant date",
);
assert.equal(
  buildReportURL(`${base}?date=${latest}`, { reportDate: latest, latestReportDate: latest, section: "incidents" }).href,
  `${base}?section=incidents`,
  "Section deep links must survive latest-date normalization",
);

console.log("URL state tests passed");
