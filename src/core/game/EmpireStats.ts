import { ClientID } from "../Schemas";

/**
 * A single time-series snapshot of a player's stats, captured every
 * SNAPSHOT_INTERVAL ticks by EmpireTrackerExecution.
 */
export interface PlayerSnapshot {
  tick: number;
  tiles: number; // territory / area
  troops: number; // manpower
  gold: number; // money (converted from bigint for serialization)
  // Cumulative nuke counts at this tick (from stats)
  abombsLaunched: number;
  hbombsLaunched: number;
  mirvsLaunched: number;
  mirvWarheadsLaunched: number;
}

/**
 * Per-player empire data computed at game-end.
 */
export interface EmpirePlayerData {
  clientID: ClientID | null;
  playerID: string;
  name: string;
  isHuman: boolean;

  /** Raw time-series snapshots */
  snapshots: PlayerSnapshot[];

  /** Integrals: sum of metric * snapshotInterval across all snapshots */
  areaIntegral: number;
  manpowerIntegral: number;
  goldIntegral: number;

  /**
   * Weighted, normalised empire score (0–1).
   * 50 % manpower integral + 25 % area integral + 25 % gold integral.
   * Normalisation is max-norm across all players in the game.
   */
  empireScore: number;

  /** 1-based rank among all players (sorted by empireScore descending) */
  empireRank: number;

  // ── Records ────────────────────────────────────────────────────────────
  peakTiles: number;
  peakTroops: number;
  /** Largest single-window territory gain (tiles gained in GAIN_LOSS_WINDOW snapshots) */
  maxTerritoryGain: number;
  /** Largest single-window territory loss */
  maxTerritoryLoss: number;
  /** Max troops / tiles ratio at any snapshot (most condensed empire) */
  peakDensity: number;

  // ── Nuke totals at game-end ────────────────────────────────────────────
  totalNukes: number;
  atomBombsLaunched: number;
  hydroBombsLaunched: number;
  mirvsLaunched: number;
  mirvWarheadsLaunched: number;
}

/**
 * Top-level empire data attached to WinUpdate and consumed by the client modal.
 */
export interface EmpireGameData {
  /** Number of game ticks between consecutive snapshots */
  snapshotInterval: number;
  totalTicks: number;

  /** All players (human + bot + nation) sorted by empireRank ascending */
  players: EmpirePlayerData[];

  // ── Game-wide nuke totals ──────────────────────────────────────────────
  totalNukesLaunched: number;
  totalAtomBombs: number;
  totalHydroBombs: number;
  totalMirvs: number;
  totalMirvWarheads: number;
}
