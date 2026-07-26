export interface ChartSeries {
  name: string;
  values: number[];
}

export interface ChartTheme {
  palette?: string[];
  fontFamily?: string;
  titleColor?: string;
  textColor?: string;
  gridColor?: string;
  backgroundColor?: string;
}

export interface ChartInput {
  title?: string;
  description?: string;
  labels: string[];
  series: ChartSeries[];
  width?: number;
  height?: number;
  valueFormatter?: (value: number) => string;
  theme?: ChartTheme;
}

export interface DonutChartInput {
  title?: string;
  description?: string;
  labels: string[];
  values: number[];
  width?: number;
  height?: number;
  valueFormatter?: (value: number) => string;
  theme?: ChartTheme;
}

const defaultPalette = ["#3262a8", "#2f855a", "#b7791f", "#805ad5", "#c53030", "#0f766e"];

export function renderLineChartSvg(input: ChartInput): string {
  const width = chartDimension(input.width, 800);
  const height = chartDimension(input.height, 320);
  const padding = { top: 42, right: 24, bottom: 52, left: 64 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const values = input.series.flatMap((series) => series.values);
  const [minimum, maximum] = domain(values);
  const x = (index: number) => padding.left + (input.labels.length <= 1 ? 0 : index / (input.labels.length - 1)) * plotWidth;
  const y = (value: number) => padding.top + (1 - (value - minimum) / Math.max(1e-9, maximum - minimum)) * plotHeight;
  const theme = resolveTheme(input.theme);
  const grid = Array.from({ length: 5 }, (_, index) => {
    const value = minimum + ((maximum - minimum) * index) / 4;
    const py = y(value);
    return `<line x1="${padding.left}" y1="${py}" x2="${width - padding.right}" y2="${py}" class="grid"/><text x="${padding.left - 10}" y="${py + 4}" text-anchor="end" class="axis">${escapeXml(format(input, value))}</text>`;
  }).join("");
  const lines = input.series.map((series, seriesIndex) => {
    const points = series.values.map((value, index) => `${x(index)},${y(value)}`).join(" ");
    const color = theme.palette[seriesIndex % theme.palette.length] ?? defaultPalette[0]!;
    return `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/><text x="${padding.left + seriesIndex * 130}" y="${height - 12}" class="legend" fill="${color}">${escapeXml(series.name)}</text>`;
  }).join("");
  return svgShell(width, height, input.title, input.description, theme, `${grid}${axisLabels(input, height, padding, x)}${lines}`);
}

export function renderBarChartSvg(input: ChartInput): string {
  const width = chartDimension(input.width, 800);
  const height = chartDimension(input.height, 320);
  const padding = { top: 42, right: 24, bottom: 62, left: 64 };
  const plotWidth = Math.max(1, width - padding.left - padding.right);
  const plotHeight = Math.max(1, height - padding.top - padding.bottom);
  const values = input.series.flatMap((series) => series.values);
  const [, maximum] = domain([0, ...values]);
  const groupWidth = plotWidth / Math.max(1, input.labels.length);
  const barWidth = Math.max(2, (groupWidth * 0.78) / Math.max(1, input.series.length));
  const theme = resolveTheme(input.theme);
  const bars = input.labels.flatMap((_, labelIndex) => input.series.map((series, seriesIndex) => {
    const value = series.values[labelIndex] ?? 0;
    const barHeight = (value / Math.max(1e-9, maximum)) * plotHeight;
    const bx = padding.left + labelIndex * groupWidth + groupWidth * 0.11 + seriesIndex * barWidth;
    const by = padding.top + plotHeight - barHeight;
    const color = theme.palette[seriesIndex % theme.palette.length] ?? defaultPalette[0]!;
    return `<rect x="${bx}" y="${by}" width="${Math.max(1, barWidth - 2)}" height="${barHeight}" rx="2" fill="${color}"><title>${escapeXml(series.name)}: ${escapeXml(format(input, value))}</title></rect>`;
  })).join("");
  const labels = input.labels.map((label, index) => `<text x="${padding.left + index * groupWidth + groupWidth / 2}" y="${height - 34}" text-anchor="middle" class="axis">${escapeXml(shorten(label, 14))}</text>`).join("");
  return svgShell(width, height, input.title, input.description, theme, `${bars}${labels}`);
}

export function renderDonutChartSvg(input: DonutChartInput): string {
  const width = chartDimension(input.width, 520);
  const height = chartDimension(input.height, 320);
  const centerX = Math.min(width * 0.38, 190);
  const centerY = height / 2 + 10;
  const radius = Math.min(100, height * 0.32);
  const strokeWidth = 34;
  const total = input.values.reduce((sum, value) => sum + Math.max(0, value), 0) || 1;
  const circumference = 2 * Math.PI * radius;
  const theme = resolveTheme(input.theme);
  let offset = 0;
  const segments = input.values.map((value, index) => {
    const length = (Math.max(0, value) / total) * circumference;
    const color = theme.palette[index % theme.palette.length] ?? defaultPalette[0]!;
    const segment = `<circle cx="${centerX}" cy="${centerY}" r="${radius}" fill="none" stroke="${color}" stroke-width="${strokeWidth}" stroke-dasharray="${length} ${circumference - length}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${centerX} ${centerY})"><title>${escapeXml(input.labels[index] ?? "")}: ${escapeXml(input.valueFormatter?.(value) ?? String(value))}</title></circle>`;
    offset += length;
    return segment;
  }).join("");
  const legend = input.labels.map((label, index) => {
    const color = theme.palette[index % theme.palette.length] ?? defaultPalette[0]!;
    const value = input.values[index] ?? 0;
    return `<rect x="${width * 0.64}" y="${70 + index * 28}" width="12" height="12" rx="2" fill="${color}"/><text x="${width * 0.64 + 20}" y="${81 + index * 28}" class="legend">${escapeXml(label)} (${escapeXml(input.valueFormatter?.(value) ?? String(value))})</text>`;
  }).join("");
  return svgShell(width, height, input.title, input.description, theme, `${segments}<text x="${centerX}" y="${centerY + 7}" text-anchor="middle" class="total">${escapeXml(input.valueFormatter?.(total) ?? String(total))}</text>${legend}`);
}

function svgShell(width: number, height: number, title: string | undefined, description: string | undefined, theme: ResolvedTheme, body: string): string {
  const accessible = `${title ? `<title>${escapeXml(title)}</title>` : ""}${description ? `<desc>${escapeXml(description)}</desc>` : ""}`;
  const background = theme.backgroundColor ? `<rect width="100%" height="100%" fill="${theme.backgroundColor}"/>` : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">${accessible}<style>text{font-family:${escapeCss(theme.fontFamily)}}.title{font-size:18px;font-weight:650;fill:${theme.titleColor}}.axis{font-size:11px;fill:${theme.textColor}}.legend{font-size:12px;fill:${theme.textColor}}.grid{stroke:${theme.gridColor};stroke-width:1}.total{font-size:23px;font-weight:700;fill:${theme.titleColor}}</style>${background}${title ? `<text x="24" y="28" class="title">${escapeXml(title)}</text>` : ""}${body}</svg>`;
}

function axisLabels(input: ChartInput, height: number, padding: { left: number; right: number; top: number; bottom: number }, x: (index: number) => number): string {
  return input.labels.map((label, index) => `<text x="${x(index)}" y="${height - padding.bottom + 24}" text-anchor="middle" class="axis">${escapeXml(shorten(label, 12))}</text>`).join("");
}

function domain(values: number[]): [number, number] {
  const finite = values.filter(Number.isFinite);
  if (!finite.length) return [0, 1];
  const minimum = Math.min(...finite);
  const maximum = Math.max(...finite);
  if (minimum === maximum) return [Math.min(0, minimum), maximum + 1];
  return [minimum, maximum];
}

function format(input: ChartInput, value: number): string {
  return input.valueFormatter?.(value) ?? new Intl.NumberFormat("en", { maximumFractionDigits: 2 }).format(value);
}

function shorten(value: string, length: number): string {
  return value.length <= length ? value : `${value.slice(0, length - 1)}…`;
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

function escapeCss(value: string): string {
  return value.replace(/[^a-zA-Z0-9 ,._'"-]/g, "").slice(0, 160);
}

function safeColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const trimmed = value.trim();
  if (/^#[0-9a-fA-F]{3,8}$/.test(trimmed)) return trimmed;
  if (/^(?:rgb|hsl)a?\([0-9.% ,+-]+\)$/.test(trimmed)) return trimmed;
  if (/^[a-zA-Z]{1,24}$/.test(trimmed)) return trimmed;
  return fallback;
}

function chartDimension(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value)) return fallback;
  return Math.max(120, Math.min(4_096, Math.round(value)));
}

interface ResolvedTheme {
  palette: string[];
  fontFamily: string;
  titleColor: string;
  textColor: string;
  gridColor: string;
  backgroundColor?: string;
}

function resolveTheme(theme: ChartTheme | undefined): ResolvedTheme {
  return {
    palette: theme?.palette?.length
      ? theme.palette.slice(0, 24).map((color, index) => safeColor(color, defaultPalette[index % defaultPalette.length]!))
      : [...defaultPalette],
    fontFamily: escapeCss(theme?.fontFamily ?? "Inter,system-ui,sans-serif"),
    titleColor: safeColor(theme?.titleColor, "#111827"),
    textColor: safeColor(theme?.textColor, "#4b5563"),
    gridColor: safeColor(theme?.gridColor, "#e5e7eb"),
    ...(theme?.backgroundColor ? { backgroundColor: safeColor(theme.backgroundColor, "transparent") } : {}),
  };
}
