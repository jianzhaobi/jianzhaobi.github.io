"use strict";

const DATA_URL = "data/reports.json";
const SECTION_DEFS = [
  ["overview", "Brief"],
  ["incidents", "Incidents"],
  ["global", "Global"],
  ["sources", "Sources"],
];

const state = {
  payload: null,
  report: null,
  section: "overview",
};

const elements = {
  dateSelect: document.querySelector("#date-select"),
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
  return new Map(
    (report.sources || []).map((source, index) => [
      source.id,
      { ...source, reference_number: index + 1 },
    ]),
  );
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
        `<a class="source-link" href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer" title="${escapeHTML(source.title)}" aria-label="Reference ${source.reference_number}: ${escapeHTML(source.title)}">[${source.reference_number}]</a>`,
    );
  if (!links.length) return "";
  return `<div class="source-row"><span class="source-label">Evidence</span><span class="source-links">${links.join("")}</span></div>`;
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
    [stats.us, "U.S.", ""],
    [stats.ca, "Canada", ""],
    [stats.critical, "Critical", stats.critical ? "signal-item--alert" : ""],
    [stats.issues, "Source issues", stats.issues ? "signal-item--alert" : ""],
  ]
    .map(
      ([value, label, modifier]) =>
        `<div class="signal-item ${modifier}"><strong>${value}</strong><span>${label}</span></div>`,
    )
    .join("");

  const posture = (report.national_posture || [])
    .map((item) => {
      const headline =
        item.preparedness_level != null
          ? `Preparedness Level ${item.preparedness_level}`
          : "Operational posture";
      const level =
        item.preparedness_level != null && item.level_meaning
          ? `<p class="posture-level"><strong>Preparedness Level ${item.preparedness_level}:</strong> ${escapeHTML(item.level_meaning)}</p>`
          : "";
      return `<details class="posture-row"><summary><span class="country-badge">${escapeHTML(item.country)}</span><span><strong>${headline}</strong><small>View verified national posture</small></span></summary><div class="posture-body"><p>${escapeHTML(item.statement)}</p>${level}${sourceLinks(item.source_ids, sources)}</div></details>`;
    })
    .join("");

  return `<section class="section" id="overview" aria-labelledby="overview-heading">
    ${renderSectionHeader("overview", "What matters now", "Verified at the report cutoff")}
    <div class="signal-strip" aria-label="Briefing counts">${cards}</div>
    <div class="posture-list">${posture || '<p class="empty-state">National posture was not reported.</p>'}</div>
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

  return `<details class="incident-card">
    <summary>
      <span class="incident-rank" aria-label="Rank ${index + 1}">${index + 1}</span>
      <div class="incident-summary">
        <div class="incident-summary__top"><h3>${escapeHTML(incident.name)} <small>${escapeHTML(incident.jurisdiction)}</small></h3>${attentionBadge(incident.attention?.level)}</div>
        <div class="incident-summary__meta"><span>${incident.start_date ? `Started ${dateLabel(incident.start_date, { short: true })}` : "Start not reported"}</span><span>${escapeHTML(area(incident))}</span><span>${escapeHTML(status(incident))}</span></div>
        <p class="incident-impact">${escapeHTML(structureImpact(incident))}</p>
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
    ${renderSectionHeader("incidents", "Ranked incidents", "Attention, ignition recency, suppression status, then structural impact", tools)}
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
      (event) => `<details class="global-card">
        <summary><span><span class="kicker">${escapeHTML(event.country)}</span><strong>${escapeHTML(event.name)}</strong></span><span>${escapeHTML(event.status)}</span></summary>
        <div class="global-card__body">
          <p><strong>Started:</strong> ${event.start_date ? dateLabel(event.start_date) : "Not reported"}</p>
          <p><strong>Situation:</strong> ${escapeHTML(event.status)}; ${escapeHTML(globalArea(event))}</p>
          ${event.structure_loss_description ? `<p><strong>Structural loss:</strong> ${escapeHTML(event.structure_loss_description)}</p>` : ""}
          ${event.evacuations ? `<p><strong>Evacuations:</strong> ${escapeHTML(event.evacuations)}</p>` : ""}
          ${event.fatalities != null ? `<p><strong>Fatalities:</strong> ${number(event.fatalities)}</p>` : ""}
          <p>${escapeHTML(event.summary)}</p>
          ${sourceLinks(event.source_ids, sources)}
        </div>
      </details>`,
    )
    .join("");
  return `<section class="section" id="global" aria-labelledby="global-heading">
    ${renderSectionHeader("global", "Global headline scan", "Headline-level context, not comprehensive operational intelligence")}
    ${overview}
    <div class="global-grid">${cards || '<p class="empty-state">No major international headline event was promoted.</p>'}</div>
  </section>`;
}

function formatReferenceTime(value) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
    timeZone: "America/New_York",
  }).format(new Date(value));
}

function renderReferences(report) {
  const references = (report.sources || [])
    .map((source, index) => {
      const metadata = [
        source.publisher,
        source.published_at ? `Published ${formatReferenceTime(source.published_at)}` : "",
        source.accessed_at ? `Accessed ${formatReferenceTime(source.accessed_at)}` : "",
      ].filter(Boolean);
      return `<li class="reference-item"><span class="reference-number">[${index + 1}]</span><span><a href="${escapeHTML(source.url)}" target="_blank" rel="noopener noreferrer">${escapeHTML(source.title)}</a>${metadata.length ? `<small>${metadata.map(escapeHTML).join(" · ")}</small>` : ""}</span></li>`;
    })
    .join("");
  if (!references) return "";
  return `<details class="references-disclosure"><summary><span>References</span><small>${report.sources.length} full citations</small></summary><ol class="reference-list">${references}</ol></details>`;
}

function renderSources(report) {
  const checks = report.source_checks || [];
  const item = (check) => {
    const modifier = check.status === "ok" ? "" : `status-dot--${escapeHTML(check.status)}`;
    return `<a class="status-card" href="${escapeHTML(check.url)}" target="_blank" rel="noopener noreferrer"><span class="status-dot ${modifier}" aria-hidden="true"></span><span><strong>${escapeHTML(check.title)}</strong><small>${escapeHTML(check.status)} · ${escapeHTML(check.detail || "Checked successfully.")}</small></span></a>`;
  };
  const issues = checks.filter((check) => check.status !== "ok");
  const passed = checks.filter((check) => check.status === "ok");
  const issueBlock = issues.length
    ? `<div class="source-issues"><p class="source-summary source-summary--warning"><strong>${issues.length} source issue${issues.length === 1 ? "" : "s"}</strong> need attention.</p><div class="source-status-grid">${issues.map(item).join("")}</div></div>`
    : `<p class="source-summary"><strong>All designated checks completed.</strong> No source failures were recorded.</p>`;
  const routineBlock = passed.length
    ? `<details class="checks-disclosure"><summary>${passed.length} routine check${passed.length === 1 ? "" : "s"} passed</summary><div class="source-status-grid">${passed.map(item).join("")}</div></details>`
    : "";
  return `<section class="section" id="sources" aria-labelledby="sources-heading">
    ${renderSectionHeader("sources", "Source status", "Designated national and regional checks")}
    ${checks.length ? `${issueBlock}${routineBlock}` : '<p class="empty-state">No source checks were recorded.</p>'}
    ${renderReferences(report)}
  </section>`;
}

function renderReport(report) {
  const sources = sourceMap(report);
  const reportDate = report.report_date;
  const header = `<header class="report-header">
    <div><p class="kicker">${weekdayLabel(reportDate)} · Daily briefing</p><h1 class="report-title">${dateLabel(reportDate)}</h1></div>
    <div class="report-links"><a class="download-link" href="${escapeHTML(report.canonical_markdown_url)}">Markdown</a><a class="download-link" href="${escapeHTML(report.evidence_url)}">Evidence</a></div>
  </header>`;
  elements.reportRoot.innerHTML = [
    header,
    renderOverview(report, sources),
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
}

function renderMeta(report) {
  const validation = report.validation?.passed ? "Validated" : "Validation issue";
  elements.reportMeta.innerHTML = `<span>${escapeHTML(formatCutoff(report.cutoff_et))}</span><strong class="validation-status">${validation}</strong>`;
}

function renderNav(activeSection) {
  elements.sectionNav.innerHTML = SECTION_DEFS.map(
    ([id, label]) => `<button type="button" class="section-tab" data-section="${id}" ${id === activeSection ? 'aria-current="true"' : ""}>${label}</button>`,
  ).join("");
}

function setURL(reportDate, section, { replace = true } = {}) {
  const url = WildfireBriefingURL.buildReportURL(window.location.href, {
    reportDate,
    latestReportDate: state.payload.latest_report_date,
    section,
  });
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
    // A manually supplied date for the latest report is valid, but redundant:
    // normalize it to the base URL after selecting that report. A clean base URL
    // is otherwise left untouched on first load.
    selectReport(requestedDate, { updateURL: params.has("date"), section: requestedSection });
    elements.footerWindow.textContent = `${payload.reports.length} report${payload.reports.length === 1 ? "" : "s"} available in the rolling ${payload.window_days}-day window.`;
    if (requestedSection !== "overview") {
      requestAnimationFrame(() => scrollToSection(requestedSection, { updateURL: false }));
    }
  } catch (error) {
    elements.reportRoot.innerHTML = `<div class="error-state"><div><h2>Briefing unavailable</h2><p>${escapeHTML(error.message)}</p></div></div>`;
  }
}

start();
