/**
 * barchart.js — the Visualize tab's bar chart, drawn as plain SVG.
 *
 * Replaces Plotly (377 KB compressed) for the one chart the portal draws:
 * record counts by year, in the look of the original ggplot theme_bw() chart
 * — portal-blue bars, a bold serif title "Attribute | Item", a boxed plot
 * area with light gridlines, and year labels turned on their side.
 *
 * barChartSvg() returns SVG markup for a given size, so the same function
 * draws the on-screen chart (sized to its container) and the 1920 × 720 PNG
 * export (see svgToPngBlob()).
 */
import { escapeHtml } from './util.js';

const BLUE = '#0b5394';
const INK = '#1b2733';
const GRID = '#e5e5e5';
const UI = "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif";
const DISPLAY = "'Source Serif 4', Georgia, 'Times New Roman', serif";

// A "nice" step (1, 2 or 5 × 10^k, at least 1) giving about five gridlines.
function niceStep(max) {
  const raw = Math.max(max / 5, 1);
  const pow = 10 ** Math.floor(Math.log10(raw));
  const f = raw / pow;
  return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow);
}

/**
 * @param width, height        drawing size in pixels
 * @param title, xLabel, yLabel text
 * @param categories           x values (strings), already in display order
 * @param values               counts, same length as categories
 * @param formatNumber         formats y-axis tick labels (locale-aware)
 */
export function barChartSvg({ width, height, title, xLabel, yLabel, categories, values, formatNumber = String }) {
  const n = categories.length;
  const longest = Math.max(1, ...categories.map((c) => String(c).length));
  const m = { top: 56, right: 20, left: 70, bottom: Math.min(150, Math.max(78, longest * 7.5 + 46)) };
  const x0 = m.left, x1 = width - m.right, y0 = m.top, y1 = height - m.bottom;
  const plotW = Math.max(10, x1 - x0), plotH = Math.max(10, y1 - y0);

  const max = Math.max(1, ...values);
  const step = niceStep(max);
  const top = Math.ceil(max / step) * step;
  const y = (v) => y1 - (v / top) * plotH;
  const band = plotW / Math.max(n, 1);
  const barW = Math.max(1, band * 0.85);
  // Show every k-th year label so labels never overlap (about 15 px apart).
  const every = Math.max(1, Math.ceil(15 / band));

  const parts = [];
  parts.push(`<rect x="0" y="0" width="${width}" height="${height}" fill="#ffffff"/>`);
  // gridlines and y-axis ticks
  for (let v = 0; v <= top; v += step) {
    const yy = y(v).toFixed(1);
    parts.push(`<line x1="${x0}" x2="${x1}" y1="${yy}" y2="${yy}" stroke="${GRID}" stroke-width="1"/>`);
    parts.push(`<text x="${x0 - 7}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="12" fill="${INK}">${escapeHtml(formatNumber(v))}</text>`);
  }
  // bars
  values.forEach((v, i) => {
    const bx = (x0 + i * band + (band - barW) / 2).toFixed(1);
    const by = y(v).toFixed(1);
    parts.push(`<rect class="portal-bar" data-i="${i}" x="${bx}" y="${by}" width="${barW.toFixed(1)}" height="${(y1 - by).toFixed(1)}" fill="${BLUE}"/>`);
  });
  // year labels, turned on their side under each bar
  categories.forEach((c, i) => {
    if (i % every) return;
    const cx = (x0 + (i + 0.5) * band).toFixed(1);
    const ly = (y1 + 7).toFixed(1);
    parts.push(`<text x="${cx}" y="${ly}" transform="rotate(-90 ${cx} ${ly})" text-anchor="end" dominant-baseline="middle" font-size="12" fill="${INK}">${escapeHtml(c)}</text>`);
  });
  // plot frame, axis titles, chart title
  parts.push(`<rect x="${x0}" y="${y0}" width="${plotW}" height="${plotH}" fill="none" stroke="#333333" stroke-width="1"/>`);
  parts.push(`<text x="${(x0 + x1) / 2}" y="${height - 12}" text-anchor="middle" font-size="13" fill="${INK}">${escapeHtml(xLabel)}</text>`);
  parts.push(`<text x="18" y="${(y0 + y1) / 2}" transform="rotate(-90 18 ${(y0 + y1) / 2})" text-anchor="middle" dominant-baseline="middle" font-size="13" fill="${INK}">${escapeHtml(yLabel)}</text>`);
  parts.push(`<text x="${x0}" y="32" font-family="${DISPLAY}" font-size="19" font-weight="600" fill="${BLUE}">${escapeHtml(title)}</text>`);

  const summary = `${title}: ${n} ${n === 1 ? 'bar' : 'bars'}, highest ${formatNumber(max)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-label="${escapeHtml(summary)}" font-family="${UI}">${parts.join('')}</svg>`;
}

/** Render SVG markup to a PNG blob of the given size (used for "Download the chart"). */
export async function svgToPngBlob(svg, width, height) {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = Object.assign(document.createElement('canvas'), { width, height });
  canvas.getContext('2d').drawImage(img, 0, 0, width, height);
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG export failed'))), 'image/png'));
}
