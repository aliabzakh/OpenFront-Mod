import { EmpireGameData, EmpirePlayerData, PlayerSnapshot } from "../game/EmpireStats";
import { Execution, Game, PlayerType, UnitType } from "../game/Game";
import { ClientID } from "../Schemas";

/** Take a snapshot every 100 ticks (10 seconds of game time at 10 ticks/sec). */
const SNAPSHOT_INTERVAL = 100;

/**
 * Number of snapshots back to measure territory gain/loss windows.
 * 5 × 100 ticks = 500 ticks = ~50 seconds of game time.
 */
const GAIN_LOSS_WINDOW = 5;

interface NukeCounts {
  abombs: number;
  hbombs: number;
  mirvs: number;
  mirvws: number;
}

interface PlayerAccumulator {
  playerID: string;
  clientID: ClientID | null;
  name: string;
  isHuman: boolean;
  snapshots: PlayerSnapshot[];
}

/**
 * EmpireTrackerExecution – records a lightweight snapshot of every player's
 * stats (tiles, troops, gold, cumulative nukes) at a fixed interval throughout
 * the game.  At game-end, WinCheckExecution calls computeEmpireData() to
 * produce the full EmpireGameData that is sent to clients in the WinUpdate.
 *
 * Nuke counts are tracked by directly observing new nuke units each tick so
 * that bot- and nation-launched nukes are captured (Stats only records human
 * players that have a clientID).
 */
export class EmpireTrackerExecution implements Execution {
  private active = true;
  private mg: Game | null = null;

  private readonly playerData = new Map<string, PlayerAccumulator>();

  // Nuke tracking – keyed by player.id() so bots / nations are included
  private readonly seenNukeUnitIds = new Set<number>();
  private readonly nukeCountsByPlayer = new Map<string, NukeCounts>();

  init(mg: Game, _ticks: number): void {
    this.mg = mg;
  }

  tick(ticks: number): void {
    if (this.mg === null) return;

    // ── Nuke detection runs every tick so we never miss a launch ───────────
    // We observe all active nuke units and remember their IDs; once a unit ID
    // is seen it is counted exactly once even if it was already destroyed.
    for (const unit of this.mg.units(
      UnitType.AtomBomb,
      UnitType.HydrogenBomb,
      UnitType.MIRV,
      UnitType.MIRVWarhead,
    )) {
      if (this.seenNukeUnitIds.has(unit.id())) continue;
      this.seenNukeUnitIds.add(unit.id());

      const pid = unit.owner().id();
      if (!this.nukeCountsByPlayer.has(pid)) {
        this.nukeCountsByPlayer.set(pid, { abombs: 0, hbombs: 0, mirvs: 0, mirvws: 0 });
      }
      const counts = this.nukeCountsByPlayer.get(pid)!;
      switch (unit.type()) {
        case UnitType.AtomBomb:     counts.abombs++; break;
        case UnitType.HydrogenBomb: counts.hbombs++; break;
        case UnitType.MIRV:         counts.mirvs++;  break;
        case UnitType.MIRVWarhead:  counts.mirvws++; break;
      }
    }

    // ── Periodic snapshot ─────────────────────────────────────────────────
    if (ticks % SNAPSHOT_INTERVAL !== 0) return;

    for (const player of this.mg.players()) {
      const pid = player.id();

      if (!this.playerData.has(pid)) {
        this.playerData.set(pid, {
          playerID: pid,
          clientID: player.clientID(),
          name: player.name(),
          isHuman: player.type() === PlayerType.Human,
          snapshots: [],
        });
      }

      const acc = this.playerData.get(pid)!;
      const counts = this.nukeCountsByPlayer.get(pid) ?? { abombs: 0, hbombs: 0, mirvs: 0, mirvws: 0 };

      const goldRaw = player.gold();
      const gold =
        goldRaw > BigInt(Number.MAX_SAFE_INTEGER)
          ? Number.MAX_SAFE_INTEGER
          : Number(goldRaw);

      acc.snapshots.push({
        tick: ticks,
        tiles: player.numTilesOwned(),
        troops: player.troops(),
        gold,
        abombsLaunched: counts.abombs,
        hbombsLaunched: counts.hbombs,
        mirvsLaunched: counts.mirvs,
        mirvWarheadsLaunched: counts.mirvws,
      });
    }
  }

  /**
   * Called once by WinCheckExecution when a winner is decided.
   * Computes integrals, normalised scores, and territory records for all
   * players, then returns the complete EmpireGameData.
   */
  computeEmpireData(): EmpireGameData {
    if (this.mg === null) {
      return this.emptyData();
    }

    const players: EmpirePlayerData[] = [];

    for (const [, acc] of this.playerData) {
      if (acc.snapshots.length === 0) continue;

      let areaIntegral = 0;
      let manpowerIntegral = 0;
      let goldIntegral = 0;
      let peakTiles = 0;
      let peakTroops = 0;
      let maxGain = 0;
      let maxLoss = 0;
      let peakDensity = 0;

      for (let i = 0; i < acc.snapshots.length; i++) {
        const s = acc.snapshots[i];
        areaIntegral += s.tiles;
        manpowerIntegral += s.troops;
        goldIntegral += s.gold;

        if (s.tiles > peakTiles) peakTiles = s.tiles;
        if (s.troops > peakTroops) peakTroops = s.troops;

        if (s.tiles > 0) {
          const density = s.troops / s.tiles;
          if (density > peakDensity) peakDensity = density;
        }

        if (i >= GAIN_LOSS_WINDOW) {
          const prev = acc.snapshots[i - GAIN_LOSS_WINDOW];
          const delta = s.tiles - prev.tiles;
          if (delta > 0 && delta > maxGain) maxGain = delta;
          if (delta < 0 && -delta > maxLoss) maxLoss = -delta;
        }
      }

      const last = acc.snapshots[acc.snapshots.length - 1];

      players.push({
        clientID: acc.clientID,
        playerID: acc.playerID,
        name: acc.name,
        isHuman: acc.isHuman,
        snapshots: acc.snapshots,
        areaIntegral,
        manpowerIntegral,
        goldIntegral,
        empireScore: 0,
        empireRank: 0,
        peakTiles,
        peakTroops,
        maxTerritoryGain: maxGain,
        maxTerritoryLoss: maxLoss,
        peakDensity,
        totalNukes:
          last.abombsLaunched +
          last.hbombsLaunched +
          last.mirvsLaunched +
          last.mirvWarheadsLaunched,
        atomBombsLaunched: last.abombsLaunched,
        hydroBombsLaunched: last.hbombsLaunched,
        mirvsLaunched: last.mirvsLaunched,
        mirvWarheadsLaunched: last.mirvWarheadsLaunched,
      });
    }

    // ── Normalise and compute weighted empire score ────────────────────────
    const maxArea = Math.max(...players.map((p) => p.areaIntegral), 1);
    const maxManpower = Math.max(...players.map((p) => p.manpowerIntegral), 1);
    const maxGold = Math.max(...players.map((p) => p.goldIntegral), 1);

    for (const p of players) {
      const normArea = p.areaIntegral / maxArea;
      const normManpower = p.manpowerIntegral / maxManpower;
      const normGold = p.goldIntegral / maxGold;
      p.empireScore = 0.5 * normManpower + 0.25 * normArea + 0.25 * normGold;
    }

    // ── Assign ranks ──────────────────────────────────────────────────────
    players.sort((a, b) => b.empireScore - a.empireScore);
    players.forEach((p, i) => { p.empireRank = i + 1; });

    // ── Game-wide nuke totals ─────────────────────────────────────────────
    const totalAtomBombs  = players.reduce((s, p) => s + p.atomBombsLaunched,    0);
    const totalHydroBombs = players.reduce((s, p) => s + p.hydroBombsLaunched,   0);
    const totalMirvs      = players.reduce((s, p) => s + p.mirvsLaunched,        0);
    const totalMirvWarheads = players.reduce((s, p) => s + p.mirvWarheadsLaunched, 0);

    return {
      snapshotInterval: SNAPSHOT_INTERVAL,
      totalTicks: this.mg.ticks(),
      players,
      totalNukesLaunched: totalAtomBombs + totalHydroBombs + totalMirvs + totalMirvWarheads,
      totalAtomBombs,
      totalHydroBombs,
      totalMirvs,
      totalMirvWarheads,
    };
  }

  private emptyData(): EmpireGameData {
    return {
      snapshotInterval: SNAPSHOT_INTERVAL,
      totalTicks: 0,
      players: [],
      totalNukesLaunched: 0,
      totalAtomBombs: 0,
      totalHydroBombs: 0,
      totalMirvs: 0,
      totalMirvWarheads: 0,
    };
  }

  isActive(): boolean {
    return this.active;
  }

  activeDuringSpawnPhase(): boolean {
    return true;
  }
}
