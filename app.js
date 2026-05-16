const categories = [
  { key: "sp500", label: "S&P 500", color: "#246b54", group: "equity" },
  { key: "bnd", label: "BND", color: "#a65d2a", group: "defensive" },
  { key: "treasury", label: "Treasury", color: "#365f91", group: "defensive" },
  { key: "stock", label: "Stock", color: "#8a3f62", group: "equity" },
  { key: "uninvested", label: "Uninvested", color: "#77746a", group: "defensive" },
];

let periodOrder = [];
let snapshots = {};
let accountMeta = {};

const taxStatusOptions = [
  { value: "taxable", label: "Taxable" },
  { value: "tax-deferred", label: "Tax deferred" },
];

function parseNumber(value) {
  const trimmed = value.trim();
  return trimmed === "" ? undefined : Number(trimmed);
}

function parseAllocationToon(text) {
  const parsedOrder = [];
  const parsedSnapshots = {};
  const parsedAccountMeta = {};
  const numericKeys = ["sp500", "bnd", "treasury", "stock", "uninvested"];

  text.split(/\r?\n/).forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;

    const parts = line.split("|").map((part) => part.trim());
    const type = parts[0];

    if (type === "snapshot") {
      const [, id, label, shortLabel] = parts;
      if (!id || !label || !shortLabel) throw new Error(`Invalid snapshot row on line ${index + 1}`);
      parsedOrder.push(id);
      parsedSnapshots[id] = { label, shortLabel, rows: [] };
      return;
    }

    if (type === "holding") {
      const [, snapshotId, account, ...values] = parts;
      if (!parsedSnapshots[snapshotId]) throw new Error(`Holding references unknown snapshot "${snapshotId}" on line ${index + 1}`);
      if (!account) throw new Error(`Missing account name on line ${index + 1}`);
      const row = { account };
      numericKeys.forEach((key, valueIndex) => {
        const value = parseNumber(values[valueIndex] || "");
        if (Number.isNaN(value)) throw new Error(`Invalid number for ${key} on line ${index + 1}`);
        if (value !== undefined) row[key] = value;
      });
      parsedSnapshots[snapshotId].rows.push(row);
      return;
    }

    if (type === "account") {
      const [, account, taxStatus] = parts;
      if (!account) throw new Error(`Missing account reference name on line ${index + 1}`);
      parsedAccountMeta[accountLabel(account)] = taxStatus || "taxable";
      return;
    }

    throw new Error(`Unknown row type "${type}" on line ${index + 1}`);
  });

  return { periodOrder: parsedOrder, snapshots: parsedSnapshots, accountMeta: parsedAccountMeta };
}

async function loadAllocationData() {
  const response = await fetch(`data.toon?t=${Date.now()}`);
  if (!response.ok) throw new Error(`Could not load data.toon: ${response.status}`);
  const parsed = parseAllocationToon(await response.text());
  periodOrder = parsed.periodOrder;
  snapshots = parsed.snapshots;
  accountMeta = parsed.accountMeta;
  ensureAccountMeta();
}

function renderPeriodButtons() {
  els.periodSwitch.innerHTML = [
    ...periodOrder.map((period) => `<button class="period-button" type="button" data-period="${period}">${snapshots[period].label}</button>`),
    `<button class="period-button" type="button" data-period="compare">Compare</button>`,
  ].join("");
  els.buttons = [...document.querySelectorAll(".period-button")];
}

function renderCompareControls() {
  const options = periodOrder
    .map((period) => `<option value="${period}">${snapshots[period].label}</option>`)
    .join("");
  els.compareTarget.innerHTML = options;
  els.compareBase.innerHTML = options;
  els.compareTarget.value = state.compareTarget;
  els.compareBase.value = state.compareBase;
}

function serializeAllocationToon() {
  const lines = [
    "# Asset allocation data in simple TOON-style rows",
    "# Values are in $000s. Blank numeric fields are treated as zero.",
    "# account | account | taxStatus",
    "# snapshot | id | label | shortLabel",
    "# holding | snapshotId | account | sp500 | bnd | treasury | stock | uninvested",
    "",
  ];

  accountNames().forEach((account) => {
    lines.push(`account | ${account} | ${accountMeta[account] || inferTaxStatus(account)}`);
  });
  lines.push("");

  periodOrder.forEach((period) => {
    const snapshot = snapshots[period];
    lines.push(`snapshot | ${period} | ${snapshot.label} | ${snapshot.shortLabel}`);
    snapshot.rows.forEach((row) => {
      lines.push([
        "holding",
        period,
        row.account,
        row.sp500 ?? "",
        row.bnd ?? "",
        row.treasury ?? "",
        row.stock ?? "",
        row.uninvested ?? "",
      ].join(" | "));
    });
    lines.push("");
  });

  return lines.join("\n");
}

function refreshAfterDataEdit() {
  renderPeriodButtons();
  renderCompareControls();
  renderSeriesToggles();
  render();
}

function refreshDashboardAfterDataEdit() {
  renderPeriodButtons();
  renderCompareControls();
  renderSeriesToggles();
  render();
}

async function persistData() {
  els.saveStatus.textContent = "Saving...";
  try {
    const response = await fetch("/save-data", {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: serializeAllocationToon(),
    });
    if (!response.ok) throw new Error(`Save failed: ${response.status}`);
    els.saveStatus.textContent = "Saved";
  } catch (error) {
    console.error(error);
    els.saveStatus.textContent = "Not saved";
  }
}

function updateAndSave() {
  ensureAccountMeta();
  refreshAfterDataEdit();
  persistData();
}

function commitInlineEdit(input, field, rowIndex) {
  const period = getVisiblePeriod();
  const row = snapshots[period].rows[rowIndex];
  if (field === "account") {
    const previousAccount = accountLabel(row.account);
    row.account = input.value.trim() || row.account;
    const nextAccount = accountLabel(row.account);
    if (previousAccount !== nextAccount) {
      accountMeta[nextAccount] = accountMeta[previousAccount] || inferTaxStatus(nextAccount);
      delete accountMeta[previousAccount];
    }
  } else if (input.value.trim() === "") {
    delete row[field];
  } else {
    const nextValue = Number(input.value);
    if (Number.isNaN(nextValue)) {
      renderRows();
      return;
    }
    row[field] = nextValue;
  }
  updateAndSave();
}

function commitTaxStatusEdit(select) {
  accountMeta[select.dataset.account] = select.value;
  updateAndSave();
}

function startTaxStatusEdit(button) {
  const account = button.dataset.account;
  const currentValue = accountMeta[account] || inferTaxStatus(account);
  const select = document.createElement("select");
  select.className = "inline-editor-input tax-status-select";
  select.dataset.account = account;
  select.setAttribute("aria-label", `${account} tax status`);
  select.innerHTML = taxStatusOptions
    .map((option) => `<option value="${option.value}"${option.value === currentValue ? " selected" : ""}>${option.label}</option>`)
    .join("");
  button.replaceWith(select);
  select.focus();
  select.addEventListener("change", () => commitTaxStatusEdit(select));
  select.addEventListener("blur", () => renderRows());
  select.addEventListener("keydown", (event) => {
    if (event.key === "Escape") renderRows();
  });
}

function startInlineEdit(button) {
  if (isCompareMode()) return;
  const rowIndex = Number(button.dataset.row);
  const field = button.dataset.field;
  const row = snapshots[getVisiblePeriod()].rows[rowIndex];
  const currentValue = field === "account" ? row.account : row[field] ?? "";
  const input = document.createElement("input");
  input.className = "inline-editor-input";
  input.type = field !== "account" ? "number" : "text";
  input.step = "0.1";
  input.value = currentValue;
  button.replaceWith(input);
  input.focus();
  input.select();
  input.addEventListener("blur", () => commitInlineEdit(input, field, rowIndex));
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter") input.blur();
    if (event.key === "Escape") renderRows();
  });
}

const state = {
  period: "may",
  compareTarget: "may",
  compareBase: "jan",
  query: "",
  visibleSeries: new Set(["total", "sp500", "bnd", "treasury", "stock", "uninvested"]),
  timelineHitPoints: [],
  driftHitColumns: [],
};

const stateStorageKey = "asset-allocation-dashboard-state";

function saveUiState() {
  localStorage.setItem(
    stateStorageKey,
    JSON.stringify({
      period: state.period,
      compareTarget: state.compareTarget,
      compareBase: state.compareBase,
      query: state.query,
      visibleSeries: [...state.visibleSeries],
    }),
  );
}

function restoreUiState() {
  try {
    const saved = JSON.parse(localStorage.getItem(stateStorageKey) || "{}");
    if (typeof saved.period === "string") state.period = saved.period;
    if (typeof saved.compareTarget === "string") state.compareTarget = saved.compareTarget;
    if (typeof saved.compareBase === "string") state.compareBase = saved.compareBase;
    if (typeof saved.query === "string") state.query = saved.query;
    if (Array.isArray(saved.visibleSeries) && saved.visibleSeries.length) {
      state.visibleSeries = new Set(saved.visibleSeries);
    }
  } catch (error) {
    console.warn("Could not restore dashboard state", error);
  }
}

const accountColors = ["#005f73", "#9b2226", "#0a9396", "#ca6702", "#5f0f40", "#3a5a40", "#7b2cbf", "#bb3e03", "#335c67", "#6a994e", "#bc4749", "#386641", "#7f5539", "#4361ee", "#2f3e46"];

const els = {
  buttons: [...document.querySelectorAll(".period-button")],
  periodSwitch: document.querySelector("#period-switch"),
  compareControls: document.querySelector("#compare-controls"),
  compareTarget: document.querySelector("#compare-target"),
  compareBase: document.querySelector("#compare-base"),
  totalValue: document.querySelector("#total-value"),
  totalDelta: document.querySelector("#total-delta"),
  equityValue: document.querySelector("#equity-value"),
  equityNote: document.querySelector("#equity-note"),
  defensiveValue: document.querySelector("#defensive-value"),
  defensiveNote: document.querySelector("#defensive-note"),
  allocationTitle: document.querySelector("#allocation-title"),
  centerPeriod: document.querySelector("#center-period"),
  centerTotal: document.querySelector("#center-total"),
  chart: document.querySelector("#allocation-chart"),
  timelineChart: document.querySelector("#timeline-chart"),
  timelineTooltip: document.querySelector("#timeline-tooltip"),
  driftChart: document.querySelector("#drift-chart"),
  driftTooltip: document.querySelector("#drift-tooltip"),
  seriesToggles: document.querySelector("#series-toggles"),
  legend: document.querySelector("#legend"),
  deltaBars: document.querySelector("#delta-bars"),
  rows: document.querySelector("#account-rows"),
  search: document.querySelector("#account-search"),
  movementTitle: document.querySelector("#movement-title"),
  tableDeltaHeader: document.querySelector("#table-delta-header"),
  addHolding: document.querySelector("#add-holding"),
  addSnapshot: document.querySelector("#add-snapshot"),
  saveStatus: document.querySelector("#save-status"),
};

const timelineSeries = [
  { key: "total", label: "Total", color: "#151512" },
  ...categories,
];

function accountLabel(account) {
  return account.replace(" (assume 60/40)", "");
}

function accountKey(account) {
  return `account:${accountLabel(account)}`;
}

function accountNames() {
  const labels = [];
  periodOrder.forEach((period) => {
    snapshots[period].rows.forEach((row) => {
      const label = accountLabel(row.account);
      if (!labels.includes(label)) labels.push(label);
    });
  });
  return labels;
}

function inferTaxStatus(account) {
  const normalized = account.toLowerCase();
  if (normalized.includes("401k") || normalized.includes("ira") || normalized.includes("roth") || normalized.includes("trowe price")) {
    return "tax-deferred";
  }
  return "taxable";
}

function ensureAccountMeta() {
  accountNames().forEach((account) => {
    if (!accountMeta[account]) accountMeta[account] = inferTaxStatus(account);
  });
}

function accountSeries() {
  return accountNames().map((label, index) => ({
    key: `account:${label}`,
    label,
    color: accountColors[index % accountColors.length],
    type: "account",
  }));
}

function allTimelineSeries() {
  return [...timelineSeries, ...accountSeries()];
}

function valueOf(row, key) {
  return Number(row[key] || 0);
}

function rowTotal(row) {
  return categories.reduce((sum, category) => sum + valueOf(row, category.key), 0);
}

function totalsFor(period) {
  const rows = snapshots[period].rows;
  return categories.reduce((totals, category) => {
    totals[category.key] = rows.reduce((sum, row) => sum + valueOf(row, category.key), 0);
    return totals;
  }, {});
}

function sumTotals(totals) {
  return categories.reduce((sum, category) => sum + totals[category.key], 0);
}

function accountMap(period) {
  return new Map(snapshots[period].rows.map((row) => [accountLabel(row.account), row]));
}

function formatK(value) {
  if (Math.abs(value) < 0.05) return "$0k";
  const rounded = Math.abs(value) >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1).replace(".0", "");
  return `$${rounded}k`;
}

function formatDelta(value) {
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  return `${sign}${formatK(Math.abs(value))}`;
}

function formatCell(value) {
  if (!value) return " ";
  return Math.abs(value) >= 100 ? Math.round(value).toLocaleString() : value.toFixed(1).replace(".0", "");
}

function percent(part, total) {
  return total ? `${Math.round((part / total) * 100)}%` : "0%";
}

function niceChartMax(value) {
  if (value <= 0) return 1;
  const exponent = Math.floor(Math.log10(value));
  const magnitude = 10 ** exponent;
  const normalized = value / magnitude;
  const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return niceNormalized * magnitude;
}

function timelinePoints() {
  return periodOrder.map((period) => {
    const totals = totalsFor(period);
    const accountTotals = snapshots[period].rows.reduce((result, row) => {
      result[accountKey(row.account)] = (result[accountKey(row.account)] || 0) + rowTotal(row);
      return result;
    }, {});
    return {
      period,
      label: snapshots[period].shortLabel,
      total: sumTotals(totals),
      ...totals,
      ...accountTotals,
    };
  });
}

function getVisiblePeriod() {
  return state.period === "compare" ? state.compareTarget : state.period;
}

function getBasePeriod() {
  return state.period === "compare" ? state.compareBase : "jan";
}

function isCompareMode() {
  return state.period === "compare";
}

function renderSummary() {
  const visiblePeriod = getVisiblePeriod();
  const basePeriod = getBasePeriod();
  const totals = totalsFor(visiblePeriod);
  const baseTotals = totalsFor(basePeriod);
  const total = sumTotals(totals);
  const baseTotal = sumTotals(baseTotals);
  const equity = totals.sp500 + totals.stock;
  const defensive = totals.bnd + totals.treasury + totals.uninvested;

  els.totalValue.textContent = formatK(total);
  els.totalDelta.textContent = `${snapshots[visiblePeriod].shortLabel} is ${formatDelta(total - baseTotal)} vs ${snapshots[basePeriod].shortLabel}`;
  els.equityValue.textContent = percent(equity, total);
  els.equityNote.textContent = `${formatK(equity)} in S&P 500 + stock`;
  els.defensiveValue.textContent = percent(defensive, total);
  els.defensiveNote.textContent = `${formatK(defensive)} in BND, Treasury, cash`;
}

function renderChart() {
  const visiblePeriod = getVisiblePeriod();
  const totals = totalsFor(visiblePeriod);
  const total = sumTotals(totals);
  const ctx = els.chart.getContext("2d");
  const size = els.chart.width;
  const center = size / 2;
  const radius = size * 0.42;
  const innerRadius = size * 0.25;
  let start = -Math.PI / 2;

  ctx.clearRect(0, 0, size, size);
  ctx.lineWidth = 1;

  categories.forEach((category) => {
    const value = totals[category.key];
    if (!value) return;
    const angle = (value / total) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(center, center);
    ctx.arc(center, center, radius, start, start + angle);
    ctx.closePath();
    ctx.fillStyle = category.color;
    ctx.fill();
    start += angle;
  });

  ctx.globalCompositeOperation = "destination-out";
  ctx.beginPath();
  ctx.arc(center, center, innerRadius, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalCompositeOperation = "source-over";

  ctx.beginPath();
  ctx.arc(center, center, radius, 0, Math.PI * 2);
  ctx.strokeStyle = "#151512";
  ctx.stroke();

  els.allocationTitle.textContent = state.period === "compare" ? `${snapshots[visiblePeriod].shortLabel} mix` : snapshots[visiblePeriod].label;
  els.centerPeriod.textContent = snapshots[visiblePeriod].shortLabel;
  els.centerTotal.textContent = formatK(total);
  els.legend.innerHTML = categories
    .map((category) => {
      const value = totals[category.key];
      return `
        <div class="legend-item">
          <span class="swatch" style="--color:${category.color}"></span>
          <span class="legend-name">${category.label}</span>
          <span class="legend-percent">${percent(value, total)}</span>
          <span class="legend-value">${formatK(value)}</span>
        </div>
      `;
    })
    .join("");
}

function renderSeriesToggles() {
  const categoryMarkup = timelineSeries
    .map((series) => {
      const pressed = state.visibleSeries.has(series.key) ? "true" : "false";
      return `
        <button class="series-button" type="button" data-series="${series.key}" aria-pressed="${pressed}">
          <span class="swatch" style="--color:${series.color}"></span>
          ${series.label}
        </button>
      `;
    })
    .join("");
  const accountMarkup = accountSeries()
    .map((series) => {
      const pressed = state.visibleSeries.has(series.key) ? "true" : "false";
      return `
        <button class="series-button" type="button" data-series="${series.key}" aria-pressed="${pressed}">
          <span class="swatch" style="--color:${series.color}"></span>
          ${series.label}
        </button>
      `;
    })
    .join("");
  els.seriesToggles.innerHTML = `
    <div class="series-group">
      <span class="series-group-label">Allocation</span>
      <div class="series-button-row">${categoryMarkup}</div>
    </div>
    <div class="series-group">
      <span class="series-group-label">Accounts</span>
      <div class="series-button-row">${accountMarkup}</div>
    </div>
  `;
}

function renderTimelineChart() {
  const points = timelinePoints();
  const visibleSeries = allTimelineSeries().filter((series) => state.visibleSeries.has(series.key));
  const seriesToDraw = visibleSeries.length ? visibleSeries : [timelineSeries[0]];
  state.timelineHitPoints = [];
  const ctx = els.timelineChart.getContext("2d");
  const width = els.timelineChart.width;
  const height = els.timelineChart.height;
  const padding = { top: 26, right: 92, bottom: 72, left: 78 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const activePeriod = getVisiblePeriod();
  const maxValue = Math.max(...points.flatMap((point) => seriesToDraw.map((series) => point[series.key] || 0)), 1);
  const yMax = niceChartMax(maxValue);
  const xFor = (index) => padding.left + (index / (points.length - 1)) * chartWidth;
  const yFor = (value) => padding.top + chartHeight - (value / yMax) * chartHeight;

  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(0, 0, width, height);

  for (let i = 0; i <= 4; i += 1) {
    const value = (yMax / 4) * i;
    const y = yFor(value);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.strokeStyle = i === 0 ? "#151512" : "#d7d0bd";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#6d6b61";
    ctx.font = "18px ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(formatK(value), padding.left - 12, y);
  }

  points.forEach((point, index) => {
    const x = xFor(index);
    if (point.period === activePeriod) {
      ctx.fillStyle = "rgba(21, 21, 18, 0.06)";
      ctx.fillRect(x - chartWidth / points.length / 2, padding.top, chartWidth / points.length, chartHeight);
    }
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.strokeStyle = point.period === activePeriod ? "#151512" : "rgba(215, 208, 189, 0.7)";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.translate(x, height - 28);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = point.period === activePeriod ? "#151512" : "#6d6b61";
    ctx.font = point.period === activePeriod ? "bold 17px ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" : "16px ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(point.label, 0, 0);
    ctx.restore();
  });

  seriesToDraw.forEach((series) => {
    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xFor(index);
      const y = yFor(point[series.key] || 0);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = series.color;
    ctx.lineWidth = series.key === "total" ? 4 : series.type === "account" ? 2 : 2.5;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();

    points.forEach((point, index) => {
      const x = xFor(index);
      const y = yFor(point[series.key] || 0);
      state.timelineHitPoints.push({
        x,
        y,
        value: point[series.key] || 0,
        period: point.period,
        periodLabel: snapshots[point.period].label,
        seriesLabel: series.label,
        color: series.color,
      });
      ctx.beginPath();
      ctx.arc(x, y, point.period === activePeriod ? 5 : 3.25, 0, Math.PI * 2);
      ctx.fillStyle = "#fffdf7";
      ctx.fill();
      ctx.strokeStyle = series.color;
      ctx.lineWidth = point.period === activePeriod ? 3 : 2;
      ctx.stroke();
    });

    if (series.key === "total" || seriesToDraw.length <= 8) {
      const lastPoint = points[points.length - 1];
      ctx.fillStyle = series.color;
      ctx.font = "bold 16px ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(series.label, xFor(points.length - 1) + 10, yFor(lastPoint[series.key] || 0));
    }
  });
}

function renderDriftChart() {
  const points = timelinePoints();
  const ctx = els.driftChart.getContext("2d");
  const width = els.driftChart.width;
  const height = els.driftChart.height;
  const padding = { top: 24, right: 38, bottom: 64, left: 60 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const activePeriod = getVisiblePeriod();
  const xFor = (index) => padding.left + (index / (points.length - 1)) * chartWidth;
  const yFor = (share) => padding.top + chartHeight - share * chartHeight;

  state.driftHitColumns = points.map((point, index) => ({ x: xFor(index), point }));
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = "#fffdf7";
  ctx.fillRect(0, 0, width, height);

  [0, 0.25, 0.5, 0.75, 1].forEach((share) => {
    const y = yFor(share);
    ctx.beginPath();
    ctx.moveTo(padding.left, y);
    ctx.lineTo(width - padding.right, y);
    ctx.strokeStyle = share === 0 ? "#151512" : "#d7d0bd";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = "#6d6b61";
    ctx.font = "17px ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(`${Math.round(share * 100)}%`, padding.left - 12, y);
  });

  points.forEach((point, index) => {
    const x = xFor(index);
    if (point.period === activePeriod) {
      ctx.fillStyle = "rgba(21, 21, 18, 0.06)";
      ctx.fillRect(x - chartWidth / points.length / 2, padding.top, chartWidth / points.length, chartHeight);
    }
    ctx.beginPath();
    ctx.moveTo(x, padding.top);
    ctx.lineTo(x, padding.top + chartHeight);
    ctx.strokeStyle = point.period === activePeriod ? "#151512" : "rgba(215, 208, 189, 0.65)";
    ctx.lineWidth = 1;
    ctx.stroke();
  });

  let lowerShares = points.map(() => 0);
  categories.forEach((category) => {
    const upperShares = points.map((point, index) => {
      const total = point.total || 1;
      return lowerShares[index] + (point[category.key] || 0) / total;
    });

    ctx.beginPath();
    points.forEach((point, index) => {
      const x = xFor(index);
      const y = yFor(upperShares[index]);
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    [...points].reverse().forEach((point, reverseIndex) => {
      const index = points.length - 1 - reverseIndex;
      ctx.lineTo(xFor(index), yFor(lowerShares[index]));
    });
    ctx.closePath();
    ctx.fillStyle = category.color;
    ctx.globalAlpha = 0.82;
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.strokeStyle = "#fffdf7";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    lowerShares = upperShares;
  });

  points.forEach((point, index) => {
    const x = xFor(index);
    ctx.save();
    ctx.translate(x, height - 24);
    ctx.rotate(-Math.PI / 5);
    ctx.fillStyle = point.period === activePeriod ? "#151512" : "#6d6b61";
    ctx.font = point.period === activePeriod ? "bold 16px ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif" : "15px ui-sans-serif, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    ctx.fillText(point.label, 0, 0);
    ctx.restore();
  });
}

function renderDeltaBars() {
  const basePeriod = getBasePeriod();
  const visiblePeriod = getVisiblePeriod();
  const baseTotals = totalsFor(basePeriod);
  const currentTotals = totalsFor(visiblePeriod);
  const deltas = categories.map((category) => ({
    ...category,
    delta: currentTotals[category.key] - baseTotals[category.key],
  }));
  const maxAbs = Math.max(...deltas.map((item) => Math.abs(item.delta)), 1);

  els.deltaBars.innerHTML = deltas
    .map((item) => {
      const width = `${Math.max(2, (Math.abs(item.delta) / maxAbs) * 50)}%`;
      const direction = item.delta < 0 ? "negative" : "positive";
      const color = item.delta < 0 ? "var(--loss)" : "var(--gain)";
      return `
        <div class="delta-row">
          <span class="bar-label">${item.label}</span>
          <span class="bar-track">
            <span class="bar-fill ${direction}" style="--bar-width:${width}; --bar-color:${color}"></span>
          </span>
          <span class="bar-value ${item.delta < 0 ? "delta-negative" : "delta-positive"}">${formatDelta(item.delta)}</span>
        </div>
      `;
    })
    .join("");
}

function renderRows() {
  const visiblePeriod = getVisiblePeriod();
  const basePeriod = getBasePeriod();
  const currentMap = accountMap(visiblePeriod);
  const baseMap = accountMap(basePeriod);
  const rows = isCompareMode()
    ? [...new Set([...currentMap.keys(), ...baseMap.keys()])].map((account) => ({
        account,
        current: currentMap.get(account) || { account },
        base: baseMap.get(account) || { account },
      }))
    : snapshots[visiblePeriod].rows.map((row, index) => ({
        account: row.account,
        index,
        current: row,
        base: baseMap.get(accountLabel(row.account)) || {},
      }));
  const query = state.query.trim().toLowerCase();
  const filteredRows = rows.filter((row) => accountLabel(row.account).toLowerCase().includes(query));

  els.rows.innerHTML = filteredRows
    .map((row) => {
      const current = rowTotal(row.current);
      const other = rowTotal(row.base);
      const delta = current - other;
      const account = accountLabel(row.account);
      const taxStatus = accountMeta[account] || inferTaxStatus(account);
      return `
        <tr>
          <td>${isCompareMode() ? account : `<button class="inline-edit account-edit" type="button" data-row="${row.index}" data-field="account">${account}</button>`}</td>
          <td><button class="inline-edit tax-status-edit" type="button" data-account="${account}">${taxStatusOptions.find((option) => option.value === taxStatus)?.label || "Taxable"}</button></td>
          ${categories
            .map((category) => {
              const value = isCompareMode()
                ? valueOf(row.current, category.key) - valueOf(row.base, category.key)
                : valueOf(row.current, category.key);
              const className = isCompareMode() && value < 0 ? "delta-negative" : isCompareMode() && value > 0 ? "delta-positive" : "";
              return `<td class="${className}">${isCompareMode() ? formatDelta(value) : `<button class="inline-edit number-edit" type="button" data-row="${row.index}" data-field="${category.key}">${formatCell(value) || "-"}</button>`}</td>`;
            })
            .join("")}
          <td><strong>${isCompareMode() ? formatDelta(delta) : formatCell(current)}</strong></td>
          <td class="${delta < 0 ? "delta-negative" : "delta-positive"}">${formatDelta(delta)}</td>
        </tr>
      `;
    })
    .join("");
}

function renderTableHeaders() {
  const headers = document.querySelectorAll("thead th");
  const prefix = isCompareMode() ? "Δ " : "";
  headers[2].textContent = `${prefix}S&P 500`;
  headers[3].textContent = `${prefix}BND`;
  headers[4].textContent = `${prefix}Treasury`;
  headers[5].textContent = `${prefix}Stock`;
  headers[6].textContent = `${prefix}Uninvested`;
  headers[7].textContent = isCompareMode() ? "Δ Total" : "Total";
}

function timelineCanvasPoint(event) {
  const rect = els.timelineChart.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * els.timelineChart.width,
    y: ((event.clientY - rect.top) / rect.height) * els.timelineChart.height,
    cssX: event.clientX - rect.left,
    cssY: event.clientY - rect.top,
  };
}

function hideTimelineTooltip() {
  els.timelineTooltip.classList.remove("visible");
  els.timelineChart.style.cursor = "default";
}

function showTimelineTooltip(hitPoint, pointer) {
  const wrapRect = els.timelineChart.parentElement.getBoundingClientRect();
  const canvasRect = els.timelineChart.getBoundingClientRect();
  const left = canvasRect.left - wrapRect.left + pointer.cssX;
  const top = canvasRect.top - wrapRect.top + pointer.cssY;

  els.timelineTooltip.innerHTML = `
    <span class="tooltip-period">${hitPoint.periodLabel}</span>
    <strong>${hitPoint.seriesLabel}</strong>
    <span class="tooltip-value">${formatK(hitPoint.value)}</span>
  `;
  els.timelineTooltip.style.setProperty("--tooltip-color", hitPoint.color);
  els.timelineTooltip.style.left = `${Math.min(left + 14, wrapRect.width - 190)}px`;
  els.timelineTooltip.style.top = `${Math.max(12, top - 78)}px`;
  els.timelineTooltip.classList.add("visible");
  els.timelineChart.style.cursor = "crosshair";
}

function handleTimelineHover(event) {
  const pointer = timelineCanvasPoint(event);
  const hitPoint = state.timelineHitPoints
    .map((point) => ({
      ...point,
      distance: Math.hypot(point.x - pointer.x, point.y - pointer.y),
    }))
    .filter((point) => point.distance <= 18)
    .sort((a, b) => a.distance - b.distance)[0];

  if (!hitPoint) {
    hideTimelineTooltip();
    return;
  }
  showTimelineTooltip(hitPoint, pointer);
}

function driftCanvasPoint(event) {
  const rect = els.driftChart.getBoundingClientRect();
  return {
    x: ((event.clientX - rect.left) / rect.width) * els.driftChart.width,
    cssX: event.clientX - rect.left,
    cssY: event.clientY - rect.top,
  };
}

function hideDriftTooltip() {
  els.driftTooltip.classList.remove("visible");
  els.driftChart.style.cursor = "default";
}

function showDriftTooltip(column, pointer) {
  const wrapRect = els.driftChart.parentElement.getBoundingClientRect();
  const canvasRect = els.driftChart.getBoundingClientRect();
  const left = canvasRect.left - wrapRect.left + pointer.cssX;
  const top = canvasRect.top - wrapRect.top + pointer.cssY;
  const rows = categories
    .map((category) => {
      const value = column.point[category.key] || 0;
      const share = column.point.total ? Math.round((value / column.point.total) * 100) : 0;
      return `
        <span class="drift-tooltip-row">
          <span><i style="--color:${category.color}"></i>${category.label}</span>
          <strong>${share}%</strong>
          <em>${formatK(value)}</em>
        </span>
      `;
    })
    .join("");

  els.driftTooltip.innerHTML = `
    <span class="tooltip-period">${snapshots[column.point.period].label}</span>
    <strong>Total ${formatK(column.point.total)}</strong>
    <span class="drift-tooltip-list">${rows}</span>
  `;
  els.driftTooltip.style.setProperty("--tooltip-color", "#151512");
  els.driftTooltip.style.left = `${Math.min(left + 14, wrapRect.width - 260)}px`;
  els.driftTooltip.style.top = `${Math.max(12, top - 128)}px`;
  els.driftTooltip.classList.add("visible");
  els.driftChart.style.cursor = "crosshair";
}

function handleDriftHover(event) {
  const pointer = driftCanvasPoint(event);
  const column = state.driftHitColumns
    .map((item) => ({ ...item, distance: Math.abs(item.x - pointer.x) }))
    .filter((item) => item.distance <= 28)
    .sort((a, b) => a.distance - b.distance)[0];

  if (!column) {
    hideDriftTooltip();
    return;
  }
  showDriftTooltip(column, pointer);
}

function render() {
  els.buttons.forEach((button) => button.classList.toggle("active", button.dataset.period === state.period));
  els.compareControls.hidden = !isCompareMode();
  els.addHolding.disabled = isCompareMode();
  els.addSnapshot.disabled = isCompareMode();
  els.search.value = state.query;

  const basePeriod = getBasePeriod();
  const visiblePeriod = getVisiblePeriod();
  els.movementTitle.textContent = isCompareMode() ? `${snapshots[visiblePeriod].shortLabel} vs ${snapshots[basePeriod].shortLabel}` : `Change since ${snapshots[basePeriod].shortLabel}`;
  els.tableDeltaHeader.textContent = `${snapshots[basePeriod].shortLabel} to ${snapshots[visiblePeriod].shortLabel}`;

  renderSummary();
  renderTimelineChart();
  renderDriftChart();
  renderChart();
  renderDeltaBars();
  renderTableHeaders();
  renderRows();
}

els.periodSwitch.addEventListener("click", (event) => {
  const button = event.target.closest("[data-period]");
  if (!button) return;
  state.period = button.dataset.period;
  saveUiState();
  render();
});

els.compareTarget.addEventListener("change", (event) => {
  state.compareTarget = event.target.value;
  saveUiState();
  render();
});

els.compareBase.addEventListener("change", (event) => {
  state.compareBase = event.target.value;
  saveUiState();
  render();
});

els.seriesToggles.addEventListener("click", (event) => {
  const button = event.target.closest("[data-series]");
  if (!button) return;
  const key = button.dataset.series;
  if (state.visibleSeries.has(key) && state.visibleSeries.size > 1) {
    state.visibleSeries.delete(key);
  } else {
    state.visibleSeries.add(key);
  }
  saveUiState();
  renderSeriesToggles();
  renderTimelineChart();
});

els.timelineChart.addEventListener("mousemove", handleTimelineHover);
els.timelineChart.addEventListener("mouseleave", hideTimelineTooltip);
els.driftChart.addEventListener("mousemove", handleDriftHover);
els.driftChart.addEventListener("mouseleave", hideDriftTooltip);

els.search.addEventListener("input", (event) => {
  state.query = event.target.value;
  saveUiState();
  renderRows();
});

els.rows.addEventListener("click", (event) => {
  const taxButton = event.target.closest(".tax-status-edit");
  if (taxButton) {
    startTaxStatusEdit(taxButton);
    return;
  }
  const editButton = event.target.closest(".inline-edit");
  if (editButton) startInlineEdit(editButton);
});

els.addHolding.addEventListener("click", () => {
  if (isCompareMode()) return;
  snapshots[getVisiblePeriod()].rows.push({ account: "New account" });
  updateAndSave();
});

els.addSnapshot.addEventListener("click", () => {
  let nextNumber = periodOrder.length + 1;
  let id = `snapshot${nextNumber}`;
  while (snapshots[id]) {
    nextNumber += 1;
    id = `snapshot${nextNumber}`;
  }
  const label = "New snapshot";
  const shortLabel = "New";
  periodOrder.push(id);
  snapshots[id] = { label, shortLabel, rows: [] };
  state.period = id;
  saveUiState();
  updateAndSave();
});

async function init() {
  await loadAllocationData();
  restoreUiState();
  if (!snapshots[state.period]) state.period = periodOrder[periodOrder.length - 1];
  if (!snapshots[state.compareTarget]) state.compareTarget = periodOrder[periodOrder.length - 1];
  if (!snapshots[state.compareBase]) state.compareBase = periodOrder[0];
  saveUiState();
  renderPeriodButtons();
  renderCompareControls();
  renderSeriesToggles();
  render();
}

init().catch((error) => {
  console.error(error);
  els.periodSwitch.textContent = "Could not load data.toon";
});
