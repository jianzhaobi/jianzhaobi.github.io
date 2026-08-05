"use strict";

const DATA_URL = "data/reports.json";
const SECTION_DEFS = [
  ["overview", "Overview"],
  ["watchlist", "Watchlist"],
  ["incidents", "Fire events"],
  ["global", "Global scan"],
  ["sources", "Source status"],
];

const state = {
  payload: null,
  report: null,
  section: "overview",
};

const elements = {
  dateSelect: document.querySelector("#date-select"),
  dateList: document.querySelector("#date-list"),
  reportMeta: document.querySelector("#report-meta"),
  sectionNav: document.querySelector("#section-nav"),
  reportRoot: document.querySelector("#report-root"),
  footerWindow: document.querySelector("#footer-window"),
};

function escapeHTML(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function renderPlainInline(value) {
  return escapeHTML(value).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
}

function renderInlineMarkdown(value) {
  const source = String(value ?? "");
  const pattern = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g;
  let output = "";
  let cursor = 0;
  for (const match of source.matchAll(pattern)) {
    output += renderPlainInline(source.slice(cursor, match.index));
    output += `<a href="${escapeHTML(match[2])}" target="_blank" rel="noopener noreferrer">${renderPlainInline(match[1])}</a>`;
    cursor = match.index + match[0].length;
  }
  output += renderPlainInline(source.slice(cursor));
  return output;
}

function dateLabel(value, options = {}) {
  const date = new Date(`${value}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-US", {
    month: options.short ? "short" : "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function weekdayLabel(value) {
  return new Intl.DateTimeFormat("en-US", { weekday: "long", timeZone: "UTC" }).format(
    new Date(`${value}T12:00:00Z`),
  );
}

function formatCutoff(value) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function sourceMap(report) {
  return new Map((report.sources || []).map((source) => [source.id, source]));
}

function unique(values) {
  return [...new Set((values || []).filter(Boolean))];
}

function sourceLinks(ids, sources) {
  const links = unique(ids)
    .map((id) => sources.get(id))
    .filter(Boolean)
    .map(
      (source) =>
        `<a class="source-link" href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title)}</a>`,
    );
  if (!links.length) return "";
  return `<div class="source-row"><span class="source-label">Sources</span>${links.join("")}</div>`;
}

function number(value) {
  return Number(value).toLocaleString("en-US", { maximumFractionDigits: 0 });
}

function area(incident) {
  if (incident.area_acres != null) {
    return `${number(incident.area_acres)} acres (${number(incident.area_acres / 2.47105381)} hectares)`;
  }
  if (incident.area_hectares != null) {
    return `${number(incident.area_hectares * 2.47105381)} acres (${number(incident.area_hectares)} hectares)`;
  }
  return "Area not reported";
}

function status(incident) {
  if (incident.country === "US" && incident.containment_percent != null) {
    return `${incident.containment_percent}% contained`;
  }
  if (incident.country === "CA" && incident.canadian_control_stage) {
    return incident.canadian_control_stage;
  }
  return "Status not reported";
}

function structureImpact(incident) {
  const s = incident.structures || {};
  const values = [];
  if (s.threatened != null) values.push(`${number(s.threatened)} threatened`);
  if (s.damaged != null) values.push(`${number(s.damaged)} damaged`);
  const typedDestroyed = [s.residences_destroyed, s.commercial_destroyed, s.outbuildings_destroyed]
    .filter((item) => item != null)
    .reduce((sum, item) => sum + item, 0);
  if (s.residences_destroyed != null) values.push(`${number(s.residences_destroyed)} residences destroyed`);
  if (s.commercial_destroyed != null) values.push(`${number(s.commercial_destroyed)} commercial structures destroyed`);
  if (s.outbuildings_destroyed != null) values.push(`${number(s.outbuildings_destroyed)} outbuildings destroyed`);
  if (s.destroyed != null && (!typedDestroyed || s.destroyed > typedDestroyed)) {
    const remaining = typedDestroyed ? s.destroyed - typedDestroyed : s.destroyed;
    values.push(`${number(remaining)} ${typedDestroyed ? "unspecified structures" : "structures"} destroyed`);
  }
  if (s.properties_with_structure_loss != null) {
    values.push(`about ${number(s.properties_with_structure_loss)} properties with structure loss`);
  }
  let result = values.length ? values.join(", ") : "Not reported";
  if (incident.confidence === "official_preliminary" && values.length) result += " (preliminary)";
  if (incident.confidence === "conflicting" && values.length) result += " (conflicting reports)";
  return result;
}

function attentionBadge(level) {
  const normalized = String(level || "Low").toLowerCase();
  return `<span class="attention-badge attention-badge--${escapeHTML(normalized)}">${escapeHTML(level || "Low")} attention</span>`;
}

function reportStats(report) {
  const incidents = report.incidents || [];
  return {
    us: incidents.filter((item) => item.country === "US").length,
    ca: incidents.filter((item) => item.country === "CA").length,
    critical: incidents.filter((item) => (item.critical_alert_reasons || []).length).length,
    issues: (report.source_checks || []).filter((item) => item.status !== "ok").length,
  };
}

function renderSectionHeader(id, title, note = "", tools = "") {
  return `<div class="section-heading"><div><h2 id="${id}-heading">${escapeHTML(title)}</h2>${note ? `<p>${escapeHTML(note)}</p>` : ""}</div>${tools}</div>`;
}

function renderOverview(report, sources) {
  const stats = reportStats(report);
  const cards = [
    [stats.us, "U.S. incidents", ""],
    [stats.ca, "Canada incidents", ""],
    [stats.critical, "Critical alerts", "stat-card--alert"],
    [stats.issues, "Source issues", stats.issues ? "stat-card--alert" : ""],
  ]
    .map(
      ([value, label, modifier]) =>
        `<article class="stat-card ${modifier}"><span class="stat-card__label">${label}</span><strong class="stat-card__value">${value}</strong></article>`,
    )
    .join("");

  const posture = (report.national_posture || [])
    .map((item) => {
      const level =
        item.preparedness_level != null && item.level_meaning
          ? `<p class="posture-level"><strong>Preparedness Level ${item.preparedness_level}:</strong> ${escapeHTML(item.level_meaning)}</p>`
          : "";
      return `<article class="posture-card"><span class="country-badge">${escapeHTML(item.country)}</span><p>${escapeHTML(item.statement)}</p>${level}${sourceLinks(item.source_ids, sources)}</article>`;
    })
    .join("");

  return `<section class="section" id="overview" aria-labelledby="overview-heading">
    ${renderSectionHeader("overview", "National posture", "The operational frame at the report cutoff")}
    <div class="stat-grid">${cards}</div>
    <div class="posture-grid" style="margin-top:12px">${posture || '<p class="empty-state">National posture was not reported.</p>'}</div>
  </section>`;
}

function watchSources(incident) {
  return unique([
    incident.official_source_id,
    ...(incident.source_ids || []),
    ...(incident.attention?.representative_source_ids || []),
  ]);
}

function renderWatchCountry(report, sources, country, label) {
  const incidents = (report.incidents || []).filter((item) => item.country === country);
  if (!incidents.length) {
    return `<div class="watch-country"><h3 class="watch-country__title">${label}</h3><p class="empty-state">No promoted incidents.</p></div>`;
  }
  const cards = incidents
    .map(
      (incident, index) => `<article class="watch-card">
        <div class="watch-rank"><small>Rank</small><strong>${index + 1}</strong></div>
        <div class="watch-card__body">
          <div class="watch-card__top"><h3>${escapeHTML(incident.name)} <span class="sr-only">in</span><small>(${escapeHTML(incident.jurisdiction)})</small></h3>${attentionBadge(incident.attention?.level)}</div>
          <div class="watch-card__meta"><span>${incident.start_date ? `Started ${dateLabel(incident.start_date, { short: true })}` : "Start date not reported"}</span><span>${escapeHTML(area(incident))}</span><span>${escapeHTML(status(incident))}</span></div>
          <p class="watch-impact"><strong>Structural impact:</strong> ${escapeHTML(structureImpact(incident))}</p>
          ${sourceLinks(watchSources(incident), sources)}
        </div>
      </article>`,
    )
    .join("");
  return `<div class="watch-country"><h3 class="watch-country__title">${label}</h3><div class="watch-grid">${cards}</div></div>`;
}

function renderWatchlist(report, sources) {
  return `<section class="section" id="watchlist" aria-labelledby="watchlist-heading">
    ${renderSectionHeader("watchlist", "Structural-impact watchlist", "Ordered by attention, ignition recency, and suppression status")}
    ${renderWatchCountry(report, sources, "US", "United States")}
    ${renderWatchCountry(report, sources, "CA", "Canada")}
  </section>`;
}

function factBlock(label, content, ids, sources, wide = false) {
  return `<div class="fact-block ${wide ? "fact-block--wide" : ""}"><span class="field-label">${escapeHTML(label)}</span><p>${content}</p>${sourceLinks(ids, sources)}</div>`;
}

function callout(kind, label, content, ids, sources) {
  if (!content) return "";
  return `<div class="callout callout--${kind}"><strong>${escapeHTML(label)}</strong><p>${content}</p>${sourceLinks(ids, sources)}</div>`;
}

function renderIncident(incident, sources, index) {
  const officialIds = unique([incident.official_source_id, ...(incident.source_ids || [])]);
  const startIds = incident.start_source_ids?.length ? incident.start_source_ids : [incident.official_source_id];
  const critical = (incident.critical_alert_reasons || []).join("; ");
  const conflicts = (incident.conflicting_values || [])
    .map((item) => callout("warning", "Unresolved evidence conflict", escapeHTML(item), officialIds, sources))
    .join("");
  const communities = (incident.affected_communities || []).length
    ? `<p><strong>Affected communities:</strong> ${escapeHTML(incident.affected_communities.join(", "))}</p>`
    : "";
  const infrastructure = (incident.critical_infrastructure || []).length
    ? `<p><strong>Critical infrastructure:</strong> ${escapeHTML(incident.critical_infrastructure.join(", "))}</p>`
    : "";

  return `<details class="incident-card" ${index === 0 ? "open" : ""}>
    <summary>
      <div class="incident-summary">
        <div class="incident-summary__top"><h3>${escapeHTML(incident.name)} — ${escapeHTML(incident.jurisdiction)}</h3>${attentionBadge(incident.attention?.level)}</div>
        <div class="incident-summary__meta"><span>${escapeHTML(area(incident))}</span><span>${escapeHTML(status(incident))}</span><span>${escapeHTML(structureImpact(incident))}</span></div>
      </div>
    </summary>
    <div class="incident-body">
      <div class="fact-grid">
        ${factBlock("Started", incident.start_date ? dateLabel(incident.start_date) : "Not reported", startIds, sources)}
        ${factBlock("Current status", `${escapeHTML(area(incident))}; ${escapeHTML(status(incident))}`, [incident.official_source_id], sources)}
        ${factBlock("Structural impact", escapeHTML(structureImpact(incident)), officialIds, sources)}
        ${factBlock("Evacuation", escapeHTML(incident.evacuation?.description || "No reviewed evacuation description was published."), officialIds, sources)}
        ${factBlock("Operational outlook", escapeHTML(incident.operational_outlook || "Not reported"), officialIds, sources, true)}
      </div>
      ${communities}${infrastructure}
      ${conflicts}
      ${callout("critical", "Critical-alert eligible", escapeHTML(critical), officialIds, sources)}
      ${incident.analyst_note ? callout("analyst", "Catastrophe-science interpretation", renderInlineMarkdown(incident.analyst_note), officialIds, sources) : ""}
      ${incident.attention?.coverage_summary ? callout("news", `What the news is saying — ${incident.attention.level}`, escapeHTML(incident.attention.coverage_summary), incident.attention.coverage_source_ids, sources) : ""}
    </div>
  </details>`;
}

function renderIncidents(report, sources) {
  const incidents = report.incidents || [];
  const tools = `<div class="incident-toolbar"><button class="text-button" type="button" data-expand="all">Expand all</button><button class="text-button" type="button" data-expand="none">Collapse all</button></div>`;
  return `<section class="section" id="incidents" aria-labelledby="incidents-heading">
    ${renderSectionHeader("incidents", "U.S. and Canada fire events", "Official facts first; recent coverage is explicitly separated", tools)}
    <div class="incident-list">${incidents.map((item, index) => renderIncident(item, sources, index)).join("") || '<p class="empty-state">No promoted fire events.</p>'}</div>
  </section>`;
}

function globalArea(event) {
  if (event.area_acres != null) return `${number(event.area_acres)} acres (${number(event.area_acres / 2.47105381)} hectares)`;
  if (event.area_hectares != null) return `${number(event.area_hectares * 2.47105381)} acres (${number(event.area_hectares)} hectares)`;
  return "Area not reported";
}

function renderGlobal(report, sources) {
  const overview = report.global_overview
    ? `<div class="global-overview"><p>${escapeHTML(report.global_overview.statement)}</p>${sourceLinks(report.global_overview.source_ids, sources)}</div>`
    : "";
  const cards = (report.global_events || [])
    .map(
      (event) => `<article class="global-card">
        <span class="kicker">${escapeHTML(event.country)}</span>
        <h3>${escapeHTML(event.name)}</h3>
        <p><strong>Started:</strong> ${event.start_date ? dateLabel(event.start_date) : "Not reported"}</p>
        <p><strong>Situation:</strong> ${escapeHTML(event.status)}; ${escapeHTML(globalArea(event))}</p>
        ${event.structure_loss_description ? `<p><strong>Structural loss:</strong> ${escapeHTML(event.structure_loss_description)}</p>` : ""}
        ${event.evacuations ? `<p><strong>Evacuations:</strong> ${escapeHTML(event.evacuations)}</p>` : ""}
        ${event.fatalities != null ? `<p><strong>Fatalities:</strong> ${number(event.fatalities)}</p>` : ""}
        <p>${escapeHTML(event.summary)}</p>
        ${sourceLinks(event.source_ids, sources)}
      </article>`,
    )
    .join("");
  return `<section class="section" id="global" aria-labelledby="global-heading">
    ${renderSectionHeader("global", "Global headline scan", "Headline-level context, not comprehensive operational intelligence")}
    ${overview}
    <div class="global-grid">${cards || '<p class="empty-state">No major international headline event was promoted.</p>'}</div>
  </section>`;
}

function renderSources(report) {
  const cards = (report.source_checks || [])
    .map((check) => {
      const modifier = check.status === "ok" ? "" : `status-dot--${escapeHTML(check.status)}`;
      return `<a class="status-card" href="${escapeHTML(check.url)}" target="_blank" rel="noopener noreferrer"><span class="status-dot ${modifier}" aria-hidden="true"></span><span><strong>${escapeHTML(check.title)} — ${escapeHTML(check.status)}</strong><span>${escapeHTML(check.detail || "Checked successfully.")}</span></span></a>`;
    })
    .join("");
  return `<section class="section" id="sources" aria-labelledby="sources-heading">
    ${renderSectionHeader("sources", "Source status", "Designated national and regional checks")}
    <div class="source-status-grid">${cards || '<p class="empty-state">No source checks were recorded.</p>'}</div>
  </section>`;
}

function renderReport(report) {
  const sources = sourceMap(report);
  const reportDate = report.report_date;
  const header = `<header class="report-header">
    <div><p class="kicker">${weekdayLabel(reportDate)} briefing</p><h2 class="report-title">${dateLabel(reportDate)}</h2></div>
    <div class="report-links"><a class="download-link" href="${escapeHTML(report.canonical_markdown_url)}">Canonical Markdown</a><a class="download-link" href="${escapeHTML(report.evidence_url)}">JSON evidence</a></div>
  </header>`;
  elements.reportRoot.innerHTML = [
    header,
    renderOverview(report, sources),
    renderWatchlist(report, sources),
    renderIncidents(report, sources),
    renderGlobal(report, sources),
    renderSources(report),
  ].join("");
  wireReportActions();
}

function renderDateControls(selectedDate) {
  const reports = state.payload.reports;
  elements.dateSelect.innerHTML = reports
    .map((report) => `<option value="${report.report_date}" ${report.report_date === selectedDate ? "selected" : ""}>${dateLabel(report.report_date)}</option>`)
    .join("");
  elements.dateList.innerHTML = reports
    .map(
      (report) => `<button class="date-button" type="button" data-date="${report.report_date}" ${report.report_date === selectedDate ? 'aria-current="date"' : ""}><strong>${dateLabel(report.report_date, { short: true })}</strong><span>${weekdayLabel(report.report_date)}</span></button>`,
    )
    .join("");
}

function renderMeta(report) {
  const validation = report.validation?.passed ? "Validated" : "Validation issue";
  elements.reportMeta.innerHTML = `<span class="meta-item"><span>Cutoff</span><strong>${escapeHTML(formatCutoff(report.cutoff_et))}</strong></span><span class="meta-item"><span>Status</span><strong>${validation}</strong></span>`;
}

function renderNav(activeSection) {
  elements.sectionNav.innerHTML = SECTION_DEFS.map(
    ([id, label]) => `<button type="button" class="section-tab" data-section="${id}" ${id === activeSection ? 'aria-current="true"' : ""}>${label}</button>`,
  ).join("");
}

function setURL(reportDate, section, { replace = true } = {}) {
  const url = new URL(window.location.href);
  url.searchParams.set("date", reportDate);
  if (section && section !== "overview") url.searchParams.set("section", section);
  else url.searchParams.delete("section");
  history[replace ? "replaceState" : "pushState"]({ reportDate, section }, "", url);
}

function selectReport(reportDate, { updateURL = true, section = "overview" } = {}) {
  const report = state.payload.reports.find((item) => item.report_date === reportDate) || state.payload.reports[0];
  state.report = report;
  state.section = SECTION_DEFS.some(([id]) => id === section) ? section : "overview";
  renderDateControls(report.report_date);
  renderMeta(report);
  renderNav(state.section);
  renderReport(report);
  if (updateURL) setURL(report.report_date, state.section);
}

function scrollToSection(section, { updateURL = true } = {}) {
  const target = document.getElementById(section);
  if (!target) return;
  state.section = section;
  renderNav(section);
  target.scrollIntoView({ behavior: "smooth", block: "start" });
  if (updateURL) setURL(state.report.report_date, section);
}

function wireReportActions() {
  elements.reportRoot.querySelectorAll("[data-expand]").forEach((button) => {
    button.addEventListener("click", () => {
      const open = button.dataset.expand === "all";
      elements.reportRoot.querySelectorAll(".incident-card").forEach((details) => {
        details.open = open;
      });
    });
  });
}

function wireGlobalActions() {
  elements.dateSelect.addEventListener("change", (event) => {
    selectReport(event.target.value, { section: "overview" });
    window.scrollTo({ top: document.querySelector(".section-nav").offsetTop, behavior: "smooth" });
  });
  elements.dateList.addEventListener("click", (event) => {
    const button = event.target.closest("[data-date]");
    if (!button) return;
    selectReport(button.dataset.date, { section: "overview" });
    window.scrollTo({ top: document.querySelector(".section-nav").offsetTop, behavior: "smooth" });
  });
  elements.sectionNav.addEventListener("click", (event) => {
    const button = event.target.closest("[data-section]");
    if (button) scrollToSection(button.dataset.section);
  });
  window.addEventListener("popstate", () => {
    const params = new URLSearchParams(window.location.search);
    const date = params.get("date") || state.payload.latest_report_date;
    const section = params.get("section") || "overview";
    selectReport(date, { updateURL: false, section });
    requestAnimationFrame(() => scrollToSection(section, { updateURL: false }));
  });
}

async function start() {
  try {
    const response = await fetch(DATA_URL, { cache: "no-store" });
    if (!response.ok) throw new Error(`Report data returned HTTP ${response.status}`);
    const payload = await response.json();
    if (!Array.isArray(payload.reports) || !payload.reports.length) throw new Error("No published reports were found");
    state.payload = payload;
    const params = new URLSearchParams(window.location.search);
    const requestedDate = params.get("date") || payload.latest_report_date;
    const requestedSection = params.get("section") || "overview";
    wireGlobalActions();
    selectReport(requestedDate, { section: requestedSection });
    elements.footerWindow.textContent = `${payload.reports.length} report${payload.reports.length === 1 ? "" : "s"} available in the rolling ${payload.window_days}-day window.`;
    if (requestedSection !== "overview") {
      requestAnimationFrame(() => scrollToSection(requestedSection, { updateURL: false }));
    }
  } catch (error) {
    elements.reportRoot.innerHTML = `<div class="error-state"><div><h2>Briefing unavailable</h2><p>${escapeHTML(error.message)}</p></div></div>`;
  }
}

start();
