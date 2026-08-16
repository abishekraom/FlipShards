import type { SnapshotCoverage, SnapshotLoadReport } from "./hypixel";
import type { ShardPrice } from "./types";

export type SnapshotStatus = "unavailable" | "ready" | "stale";

export interface SnapshotState {
  prices: Record<string, ShardPrice>;
  coverage: SnapshotCoverage | null;
  lastUpdatedMs: number | null;
  receivedAtMs: number | null;
  status: SnapshotStatus;
  errorMessage: string | null;
}

export const initialSnapshotState: SnapshotState = {
  prices: {},
  coverage: null,
  lastUpdatedMs: null,
  receivedAtMs: null,
  status: "unavailable",
  errorMessage: null,
};

export const applySnapshotReport = (_state: SnapshotState, report: SnapshotLoadReport): SnapshotState => ({
  prices: report.prices,
  coverage: report.coverage,
  lastUpdatedMs: report.lastUpdatedMs,
  receivedAtMs: report.receivedAtMs,
  status: "ready",
  errorMessage: null,
});

export const applySnapshotFailure = (state: SnapshotState, errorMessage: string): SnapshotState => ({
  ...state,
  status: Object.keys(state.prices).length > 0 ? "stale" : "unavailable",
  errorMessage,
});

export const isCurrentSnapshotRequest = (currentSequence: number, requestSequence: number) => currentSequence === requestSequence;
