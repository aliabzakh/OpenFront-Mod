import { html, LitElement, TemplateResult } from "lit";
import { customElement, state } from "lit/decorators.js";
import { GameEvent, EventBus } from "../../../core/EventBus";
import { EmpireGameData, EmpirePlayerData, PlayerSnapshot } from "../../../core/game/EmpireStats";
import { Layer } from "./Layer";

// ── Event fired by WinModal when empire data arrives ──────────────────────────
export class ShowEmpireStatsEvent implements GameEvent {
  constructor(public readonly data: EmpireGameData) {}
}

// ── Colour palette for up to 20 players ───────────────────────────────────────
const PALETTE = [
  "#4e79a7", "#f28e2b", "#e15759", "#76b7b2", "#59a14f",
  "#edc948", "#b07aa1", "#ff9da7", "#9c755f", "#bab0ac",
  "#86bcb6", "#f1ce63", "#d37295", "#a0cbe8", "#ffbe7d",
  "#8cd17d", "#b6992d", "#499894", "#e15759", "#79706e",
];

// ── Minimal chart helpers ─────────────────────────────────────────────────────

function fmtNum(v: number): string {
  if (v >= 1_000_000) return (v / 1_000_000).toFixed(1) + "M";
  if (v >= 1_000) return (v / 1_000).toFixed(1) + "K";
  return Math.round(v).toString();
}

function fmtPct(v: number): string {
  return (v * 100).toFixed(1) + "%";
}

interface Dataset {
  label: string;
  color: string;
  data: number[];
}

function drawLineChart(
  canvas: HTMLCanvasElement,
  datasets: Dataset[],
  yLabel: string,
  snapshotInterval: number,
  title: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const PAD_L = 65;
  const PAD_R = 170;
  const PAD_T = 30;
  const PAD_B = 35;
  const CW = W - PAD_L - PAD_R;
  const CH = H - PAD_T - PAD_B;

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, W, H);

  const nonEmpty = datasets.filter((d) => d.data.length > 0);
  if (nonEmpty.length === 0) return;

  const numPoints = Math.max(...nonEmpty.map((d) => d.data.length));
  const allVals = nonEmpty.flatMap((d) => d.data);
  const maxVal = Math.max(...allVals, 1);

  // Title
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(title, W / 2, 18);

  // Grid + Y labels
  const numY = 5;
  for (let i = 0; i <= numY; i++) {
    const y = PAD_T + CH - (i / numY) * CH;
    const val = (i / numY) * maxVal;

    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(PAD_L + CW, y);
    ctx.stroke();

    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(fmtNum(val), PAD_L - 5, y + 4);
  }

  // X labels (time in minutes)
  const TICKS_PER_SEC = 10;
  const numX = 8;
  for (let i = 0; i <= numX; i++) {
    const x = PAD_L + (i / numX) * CW;
    const snapshotIdx = Math.floor((i / numX) * (numPoints - 1));
    const seconds = (snapshotIdx * snapshotInterval) / TICKS_PER_SEC;
    const minutes = Math.floor(seconds / 60);

    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(x, PAD_T);
    ctx.lineTo(x, PAD_T + CH);
    ctx.stroke();

    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${minutes}m`, x, PAD_T + CH + 14);
  }

  // Axes
  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T);
  ctx.lineTo(PAD_L, PAD_T + CH);
  ctx.lineTo(PAD_L + CW, PAD_T + CH);
  ctx.stroke();

  // Y-axis label
  ctx.save();
  ctx.fillStyle = "#9ca3af";
  ctx.font = "10px sans-serif";
  ctx.textAlign = "center";
  ctx.translate(12, PAD_T + CH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(yLabel, 0, 0);
  ctx.restore();

  // Draw lines
  for (const ds of nonEmpty) {
    if (ds.data.length < 2) continue;
    ctx.strokeStyle = ds.color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let i = 0; i < ds.data.length; i++) {
      const x = PAD_L + (i / Math.max(numPoints - 1, 1)) * CW;
      const y = PAD_T + CH - (ds.data[i] / maxVal) * CH;
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    }
    ctx.stroke();
  }

  // Legend (right panel)
  const lx = W - PAD_R + 12;
  let ly = PAD_T + 8;
  ctx.font = "11px sans-serif";
  for (const ds of nonEmpty) {
    ctx.fillStyle = ds.color;
    ctx.fillRect(lx, ly - 7, 14, 3);
    ctx.fillStyle = "#d1d5db";
    ctx.textAlign = "left";
    ctx.fillText(ds.label.slice(0, 18), lx + 18, ly);
    ly += 18;
    if (ly > H - PAD_B) break; // overflow guard
  }
}

function drawBarChart(
  canvas: HTMLCanvasElement,
  categories: string[],
  series: { label: string; color: string; values: number[] }[],
  title: string,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const W = canvas.width;
  const H = canvas.height;
  const PAD_L = 60;
  const PAD_R = 170;
  const PAD_T = 30;
  const PAD_B = 60;
  const CW = W - PAD_L - PAD_R;
  const CH = H - PAD_T - PAD_B;

  ctx.fillStyle = "#111827";
  ctx.fillRect(0, 0, W, H);

  const maxVal = Math.max(
    ...series.flatMap((s) => s.values),
    1,
  );

  // Title
  ctx.fillStyle = "#e5e7eb";
  ctx.font = "bold 13px sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(title, W / 2, 18);

  // Grid
  for (let i = 0; i <= 5; i++) {
    const y = PAD_T + CH - (i / 5) * CH;
    ctx.strokeStyle = "#374151";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(PAD_L, y);
    ctx.lineTo(PAD_L + CW, y);
    ctx.stroke();
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px monospace";
    ctx.textAlign = "right";
    ctx.fillText(fmtNum((i / 5) * maxVal), PAD_L - 4, y + 4);
  }

  // Grouped bars
  const nCat = categories.length;
  const nSer = series.length;
  const groupW = CW / Math.max(nCat, 1);
  const barW = Math.min(groupW / (nSer + 1), 30);

  for (let ci = 0; ci < nCat; ci++) {
    const groupX = PAD_L + ci * groupW + groupW / 2 - (nSer * barW) / 2;

    for (let si = 0; si < nSer; si++) {
      const val = series[si].values[ci] ?? 0;
      const bh = (val / maxVal) * CH;
      const bx = groupX + si * barW;
      const by = PAD_T + CH - bh;

      ctx.fillStyle = series[si].color;
      ctx.fillRect(bx, by, barW - 2, bh);
    }

    // X label
    ctx.fillStyle = "#9ca3af";
    ctx.font = "10px sans-serif";
    ctx.textAlign = "center";
    const label = categories[ci];
    ctx.fillText(label.slice(0, 12), PAD_L + ci * groupW + groupW / 2, PAD_T + CH + 14);
  }

  // Axes
  ctx.strokeStyle = "#6b7280";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PAD_L, PAD_T);
  ctx.lineTo(PAD_L, PAD_T + CH);
  ctx.lineTo(PAD_L + CW, PAD_T + CH);
  ctx.stroke();

  // Legend
  const lx = W - PAD_R + 12;
  let ly = PAD_T + 8;
  for (const s of series) {
    ctx.fillStyle = s.color;
    ctx.fillRect(lx, ly - 9, 14, 12);
    ctx.fillStyle = "#d1d5db";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(s.label.slice(0, 18), lx + 18, ly);
    ly += 18;
  }
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type Tab = "rankings" | "territory" | "manpower" | "economy" | "nukes" | "highlights";

@customElement("empire-stats-modal")
export class EmpireStatsModal extends LitElement implements Layer {
  public eventBus!: EventBus;

  @state() private isVisible = false;
  @state() private activeTab: Tab = "rankings";
  @state() private empireData: EmpireGameData | null = null;

  createRenderRoot() {
    return this;
  }

  init() {
    this.eventBus.on(ShowEmpireStatsEvent, (evt) => {
      this.empireData = evt.data;
      this.activeTab = "rankings";
      this.isVisible = true;
      this.requestUpdate();
    });
  }

  tick() {}
  renderLayer() {}
  shouldTransform() { return false; }

  // ── After Lit renders, draw canvases in the active tab ─────────────────────
  protected updated() {
    if (!this.isVisible || !this.empireData) return;
    this._drawActiveChart();
  }

  private _drawActiveChart() {
    const data = this.empireData!;
    const humans = data.players.filter((p) => p.isHuman);
    const allPlayers = data.players; // use all for charts

    switch (this.activeTab) {
      case "territory":
        this._drawLineCanvas("canvas-territory", allPlayers, "tiles", "Tiles owned", "Territory over time");
        break;
      case "manpower":
        this._drawLineCanvas("canvas-manpower", allPlayers, "troops", "Troops", "Manpower over time");
        break;
      case "economy":
        this._drawLineCanvas("canvas-economy", allPlayers, "gold", "Gold", "Economy over time");
        break;
      case "nukes":
        this._drawNukesChart(data);
        break;
    }
  }

  private _drawLineCanvas(
    canvasId: string,
    players: EmpirePlayerData[],
    field: keyof PlayerSnapshot,
    yLabel: string,
    title: string,
  ) {
    const canvas = this.querySelector<HTMLCanvasElement>(`#${canvasId}`);
    if (!canvas || !this.empireData) return;

    const datasets: Dataset[] = players.map((p, i) => ({
      label: p.name,
      color: PALETTE[i % PALETTE.length],
      data: p.snapshots.map((s) => s[field] as number),
    }));

    drawLineChart(canvas, datasets, yLabel, this.empireData.snapshotInterval, title);
  }

  private _drawNukesChart(data: EmpireGameData) {
    const canvas = this.querySelector<HTMLCanvasElement>("#canvas-nukes");
    if (!canvas) return;

    // Cumulative nukes over time – line chart per player showing total nukes
    const datasets: Dataset[] = data.players
      .filter((p) => p.totalNukes > 0)
      .map((p, i) => ({
        label: p.name,
        color: PALETTE[i % PALETTE.length],
        data: p.snapshots.map(
          (s) => s.abombsLaunched + s.hbombsLaunched + s.mirvsLaunched + s.mirvWarheadsLaunched,
        ),
      }));

    drawLineChart(canvas, datasets, "Nukes launched", data.snapshotInterval, "Cumulative nukes over time");
  }

  // ── Rendering ─────────────────────────────────────────────────────────────

  render() {
    if (!this.isVisible || !this.empireData) return html``;

    return html`
      <div
        class="fixed inset-0 z-[10020] bg-black/80 flex items-center justify-center p-2"
        @click=${this._onBackdrop}
      >
        <div
          class="bg-gray-900 rounded-lg shadow-2xl flex flex-col w-full max-w-5xl max-h-[95vh] text-white overflow-hidden"
          @click=${(e: Event) => e.stopPropagation()}
        >
          <!-- Header -->
          <div class="flex items-center justify-between px-5 py-3 border-b border-gray-700 shrink-0">
            <h2 class="text-xl font-bold text-yellow-400 m-0">Empire Rankings</h2>
            <button
              @click=${this._close}
              class="text-gray-400 hover:text-white text-2xl leading-none cursor-pointer bg-transparent border-0"
            >✕</button>
          </div>

          <!-- Tab bar -->
          <div class="flex gap-1 px-4 pt-3 border-b border-gray-700 shrink-0 flex-wrap">
            ${(["rankings", "territory", "manpower", "economy", "nukes", "highlights"] as Tab[]).map(
              (tab) => html`
                <button
                  class="${this.activeTab === tab
                    ? "bg-yellow-500 text-gray-900 font-semibold"
                    : "bg-gray-700 text-gray-300 hover:bg-gray-600"} px-3 py-1.5 rounded-t text-sm cursor-pointer border-0 transition-colors"
                  @click=${() => this._switchTab(tab)}
                >
                  ${this._tabLabel(tab)}
                </button>
              `,
            )}
          </div>

          <!-- Content -->
          <div class="overflow-y-auto flex-1 p-4">
            ${this._renderTab()}
          </div>

          <!-- Footer -->
          <div class="px-5 py-3 border-t border-gray-700 shrink-0 flex justify-end">
            <button
              @click=${this._close}
              class="px-5 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-semibold cursor-pointer border-0 transition-colors"
            >Close</button>
          </div>
        </div>
      </div>
    `;
  }

  private _tabLabel(tab: Tab): string {
    const labels: Record<Tab, string> = {
      rankings: "🏆 Rankings",
      territory: "🗺 Territory",
      manpower: "⚔️ Manpower",
      economy: "💰 Economy",
      nukes: "☢️ Nukes",
      highlights: "⭐ Highlights",
    };
    return labels[tab];
  }

  private _switchTab(tab: Tab) {
    this.activeTab = tab;
    this.requestUpdate();
  }

  private _renderTab(): TemplateResult {
    const data = this.empireData!;
    switch (this.activeTab) {
      case "rankings":  return this._renderRankings(data);
      case "territory": return this._renderChartTab("canvas-territory");
      case "manpower":  return this._renderChartTab("canvas-manpower");
      case "economy":   return this._renderChartTab("canvas-economy");
      case "nukes":     return this._renderNukesTab(data);
      case "highlights": return this._renderHighlights(data);
    }
  }

  // ── Rankings tab ──────────────────────────────────────────────────────────

  private _renderRankings(data: EmpireGameData): TemplateResult {
    return html`
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-gray-400 text-left border-b border-gray-700">
              <th class="pb-2 pr-3">Rank</th>
              <th class="pb-2 pr-3">Player</th>
              <th class="pb-2 pr-3 text-right">Empire Score</th>
              <th class="pb-2 pr-3 text-right">Manpower (50%)</th>
              <th class="pb-2 pr-3 text-right">Territory (25%)</th>
              <th class="pb-2 pr-3 text-right">Economy (25%)</th>
              <th class="pb-2 pr-3 text-right">Peak Tiles</th>
              <th class="pb-2 text-right">Nukes</th>
            </tr>
          </thead>
          <tbody>
            ${data.players.map((p, i) => this._rankRow(p, i, data.players.length))}
          </tbody>
        </table>
      </div>

      <p class="text-gray-500 text-xs mt-4">
        Empire score = 50% manpower × time + 25% territory × time + 25% economy × time,
        normalised to the game's maximum across all players.
      </p>
    `;
  }

  private _rankRow(p: EmpirePlayerData, idx: number, total: number): TemplateResult {
    const medal = ["🥇", "🥈", "🥉"][p.empireRank - 1] ?? `#${p.empireRank}`;
    const color = PALETTE[idx % PALETTE.length];
    const isTopHuman = p.isHuman && p.empireRank === 1;

    return html`
      <tr class="${isTopHuman ? "bg-yellow-900/30" : idx % 2 === 0 ? "bg-gray-800/30" : ""} border-b border-gray-800">
        <td class="py-2 pr-3 font-bold text-lg">${medal}</td>
        <td class="py-2 pr-3">
          <span
            class="inline-block w-3 h-3 rounded-full mr-2"
            style="background:${color}"
          ></span>
          ${p.name}
          ${!p.isHuman ? html`<span class="text-gray-500 text-xs ml-1">(bot)</span>` : ""}
        </td>
        <td class="py-2 pr-3 text-right font-semibold text-yellow-400">${fmtPct(p.empireScore)}</td>
        <td class="py-2 pr-3 text-right text-blue-300">${fmtNum(p.manpowerIntegral)}</td>
        <td class="py-2 pr-3 text-right text-green-300">${fmtNum(p.areaIntegral)}</td>
        <td class="py-2 pr-3 text-right text-orange-300">${fmtNum(p.goldIntegral)}</td>
        <td class="py-2 pr-3 text-right">${fmtNum(p.peakTiles)}</td>
        <td class="py-2 text-right text-red-400">${p.totalNukes > 0 ? p.totalNukes : "—"}</td>
      </tr>
    `;
  }

  // ── Chart tabs ────────────────────────────────────────────────────────────

  private _renderChartTab(canvasId: string): TemplateResult {
    return html`
      <div class="w-full">
        <canvas
          id="${canvasId}"
          width="900"
          height="380"
          class="w-full h-auto rounded bg-gray-950"
        ></canvas>
      </div>
    `;
  }

  // ── Nukes tab ─────────────────────────────────────────────────────────────

  private _renderNukesTab(data: EmpireGameData): TemplateResult {
    return html`
      <!-- Summary cards -->
      <div class="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        ${this._nukeCard("☢️ Total", data.totalNukesLaunched)}
        ${this._nukeCard("💣 Atom", data.totalAtomBombs)}
        ${this._nukeCard("💥 H-Bomb", data.totalHydroBombs)}
        ${this._nukeCard("🚀 MIRV", data.totalMirvs)}
      </div>

      <!-- Cumulative nukes over time -->
      <canvas
        id="canvas-nukes"
        width="900"
        height="320"
        class="w-full h-auto rounded bg-gray-950 mb-4"
      ></canvas>

      <!-- Per-player nuke breakdown -->
      <div class="overflow-x-auto">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-gray-400 text-left border-b border-gray-700">
              <th class="pb-2 pr-3">Player</th>
              <th class="pb-2 pr-3 text-right">Atom Bombs</th>
              <th class="pb-2 pr-3 text-right">H-Bombs</th>
              <th class="pb-2 pr-3 text-right">MIRVs</th>
              <th class="pb-2 pr-3 text-right">MIRV Warheads</th>
              <th class="pb-2 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            ${data.players
              .filter((p) => p.totalNukes > 0)
              .sort((a, b) => b.totalNukes - a.totalNukes)
              .map(
                (p, i) => html`
                  <tr class="${i % 2 === 0 ? "bg-gray-800/30" : ""} border-b border-gray-800">
                    <td class="py-1.5 pr-3">${p.name}</td>
                    <td class="py-1.5 pr-3 text-right">${p.atomBombsLaunched || "—"}</td>
                    <td class="py-1.5 pr-3 text-right">${p.hydroBombsLaunched || "—"}</td>
                    <td class="py-1.5 pr-3 text-right">${p.mirvsLaunched || "—"}</td>
                    <td class="py-1.5 pr-3 text-right">${p.mirvWarheadsLaunched || "—"}</td>
                    <td class="py-1.5 text-right font-bold text-red-400">${p.totalNukes}</td>
                  </tr>
                `,
              )}
          </tbody>
        </table>
        ${data.totalNukesLaunched === 0
          ? html`<p class="text-center text-gray-500 py-6">No nuclear weapons were launched this game.</p>`
          : ""}
      </div>
    `;
  }

  private _nukeCard(label: string, value: number): TemplateResult {
    return html`
      <div class="bg-gray-800 rounded p-3 text-center">
        <div class="text-2xl font-bold text-red-400">${value}</div>
        <div class="text-gray-400 text-xs mt-1">${label}</div>
      </div>
    `;
  }

  // ── Highlights tab ────────────────────────────────────────────────────────

  private _renderHighlights(data: EmpireGameData): TemplateResult {
    const players = data.players;
    if (players.length === 0) return html`<p class="text-gray-400">No data.</p>`;

    const topEmpire = players[0]; // already sorted by empireRank
    const mostTerrGain = [...players].sort((a, b) => b.maxTerritoryGain - a.maxTerritoryGain)[0];
    const mostTerrLoss = [...players].sort((a, b) => b.maxTerritoryLoss - a.maxTerritoryLoss)[0];
    const mostCondensed = [...players].sort((a, b) => b.peakDensity - a.peakDensity)[0];
    const mostNukes = [...players].sort((a, b) => b.totalNukes - a.totalNukes)[0];
    const biggestPeak = [...players].sort((a, b) => b.peakTiles - a.peakTiles)[0];
    const richest = [...players].sort((a, b) => b.goldIntegral - a.goldIntegral)[0];
    const mostTroops = [...players].sort((a, b) => b.peakTroops - a.peakTroops)[0];

    const durationMin = Math.round((data.totalTicks / 10) / 60);

    return html`
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        ${this._highlightCard("🏆 Greatest Empire", topEmpire.name,
          `Score: ${fmtPct(topEmpire.empireScore)} — dominated across manpower, territory & economy`)}

        ${this._highlightCard("🗺 Largest Territory", biggestPeak.name,
          `Peak: ${fmtNum(biggestPeak.peakTiles)} tiles`)}

        ${this._highlightCard("⚔️ Most Manpower", mostTroops.name,
          `Peak: ${fmtNum(mostTroops.peakTroops)} troops`)}

        ${this._highlightCard("📈 Greatest Territorial Gain", mostTerrGain.name,
          `+${fmtNum(mostTerrGain.maxTerritoryGain)} tiles in ~50 sec`)}

        ${this._highlightCard("📉 Greatest Territorial Loss", mostTerrLoss.name,
          `-${fmtNum(mostTerrLoss.maxTerritoryLoss)} tiles in ~50 sec`)}

        ${this._highlightCard("🔬 Most Condensed Empire", mostCondensed.name,
          `Peak density: ${mostCondensed.peakDensity.toFixed(1)} troops/tile`)}

        ${mostNukes.totalNukes > 0
          ? this._highlightCard("☢️ Nuclear Superpower", mostNukes.name,
              `${mostNukes.totalNukes} total launches (${mostNukes.atomBombsLaunched}×💣 + ${mostNukes.hydroBombsLaunched}×💥 + ${mostNukes.mirvsLaunched}×🚀)`)
          : this._highlightCard("☮️ Peaceful Game", "Nobody", "Not a single nuke was launched!")}

        ${this._highlightCard("💰 Wealthiest Empire", richest.name,
          `Gold accumulated: ${fmtNum(richest.goldIntegral)}`)}

        ${this._highlightCard("⏱ Game Duration", `${durationMin} minutes`,
          `${fmtNum(data.totalTicks)} game ticks total`)}
      </div>
    `;
  }

  private _highlightCard(title: string, value: string, description: string): TemplateResult {
    return html`
      <div class="bg-gray-800 rounded-lg p-4 border border-gray-700">
        <div class="text-xs text-gray-400 mb-1">${title}</div>
        <div class="text-lg font-bold text-white mb-1">${value}</div>
        <div class="text-xs text-gray-400">${description}</div>
      </div>
    `;
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private _close() {
    this.isVisible = false;
    this.requestUpdate();
  }

  private _onBackdrop(e: Event) {
    if (e.target === e.currentTarget) this._close();
  }
}
