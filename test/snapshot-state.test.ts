import assert from "node:assert/strict";
import test from "node:test";
import { buildHypixelSnapshot, type SnapshotLoadReport } from "../src/profit/hypixel";
import {
  applySnapshotFailure,
  applySnapshotReport,
  initialSnapshotState,
  runCurrentSnapshotRequest,
  type SnapshotState,
} from "../src/profit/snapshot-state";
import { clonePayload, createPayload, createRecipeBook, RAINBUG_TAG } from "./helpers";

test("publishes a valid snapshot as one atomic candidate", () => {
  const book = createRecipeBook(3);
  const report = buildHypixelSnapshot(book, createPayload(book, [RAINBUG_TAG]));
  const state = applySnapshotReport(initialSnapshotState, report);

  assert.equal(state.status, "ready");
  assert.strictEqual(state.prices, report.prices);
  assert.strictEqual(state.coverage, report.coverage);
  assert.equal(state.errorMessage, null);
});

test("valid partial snapshots replace the whole map without backfilling old records", () => {
  const book = createRecipeBook(3);
  const firstReport = buildHypixelSnapshot(book, createPayload(book, [RAINBUG_TAG]));
  const readyState = applySnapshotReport(initialSnapshotState, firstReport);
  const partialPayload = clonePayload(createPayload(book, [RAINBUG_TAG, "SHARD_TEST_002"]));
  const partialReport = buildHypixelSnapshot(book, partialPayload);
  const nextState = applySnapshotReport(readyState, partialReport);

  assert.equal(nextState.status, "ready");
  assert.equal(nextState.prices.R2, undefined);
  assert.equal(nextState.prices.R1?.lastUpdated, partialReport.lastUpdated);
  assert.equal(readyState.prices.R2?.lastUpdated, firstReport.lastUpdated);
});

test("failed refresh retains the previous map and marks it stale", () => {
  const book = createRecipeBook(2);
  const report = buildHypixelSnapshot(book, createPayload(book, [RAINBUG_TAG]));
  const readyState = applySnapshotReport(initialSnapshotState, report);
  const failedState = applySnapshotFailure(readyState, "Hypixel Bazaar request timed out");

  assert.equal(failedState.status, "stale");
  assert.strictEqual(failedState.prices, readyState.prices);
  assert.deepEqual(failedState.prices, readyState.prices);
  assert.equal(failedState.errorMessage, "Hypixel Bazaar request timed out");
});

test("failed first load remains unavailable with no prices", () => {
  const state = applySnapshotFailure(initialSnapshotState, "Hypixel Bazaar response was malformed");

  assert.equal(state.status, "unavailable");
  assert.deepEqual(state.prices, {});
  assert.equal(state.coverage, null);
});

test("an older response cannot mutate presentation state after a newer response commits", async () => {
  const book = createRecipeBook(3);
  const olderReport = buildHypixelSnapshot(book, createPayload(book));
  const newerReport = buildHypixelSnapshot(book, createPayload(book, [RAINBUG_TAG, "SHARD_TEST_002"]));
  let resolveOlder!: (report: SnapshotLoadReport) => void;
  let resolveNewer!: (report: SnapshotLoadReport) => void;
  const olderResponse = new Promise<SnapshotLoadReport>((resolve) => { resolveOlder = resolve; });
  const newerResponse = new Promise<SnapshotLoadReport>((resolve) => { resolveNewer = resolve; });
  let currentSequence = 0;
  let view: {
    snapshot: SnapshotState;
    sourceLabel: string;
    loadingMessage: string;
    isRefreshing: boolean;
  } = {
    snapshot: initialSnapshotState,
    sourceLabel: "unavailable",
    loadingMessage: "",
    isRefreshing: false,
  };

  const beginRequest = (response: Promise<SnapshotLoadReport>, label: string) => {
    const requestSequence = currentSequence + 1;
    currentSequence = requestSequence;
    view = { ...view, sourceLabel: `loading ${label}`, loadingMessage: `loading ${label}`, isRefreshing: true };
    return runCurrentSnapshotRequest({
      requestSequence,
      getCurrentSequence: () => currentSequence,
      request: () => response,
      onSuccess: (report) => {
        view = { snapshot: applySnapshotReport(view.snapshot, report), sourceLabel: `${label} ready`, loadingMessage: "", isRefreshing: view.isRefreshing };
      },
      onFailure: (error) => {
        view = { snapshot: applySnapshotFailure(view.snapshot, String(error)), sourceLabel: `${label} failed`, loadingMessage: String(error), isRefreshing: view.isRefreshing };
      },
      onSettled: () => {
        view = { ...view, isRefreshing: false };
      },
    });
  };

  const olderRun = beginRequest(olderResponse, "older");
  const newerRun = beginRequest(newerResponse, "newer");
  resolveNewer(newerReport);
  await newerRun;

  assert.strictEqual(view.snapshot.prices, newerReport.prices);
  assert.strictEqual(view.snapshot.coverage, newerReport.coverage);
  assert.equal(view.sourceLabel, "newer ready");
  assert.equal(view.loadingMessage, "");
  assert.equal(view.isRefreshing, false);

  resolveOlder(olderReport);
  await olderRun;

  assert.strictEqual(view.snapshot.prices, newerReport.prices);
  assert.strictEqual(view.snapshot.coverage, newerReport.coverage);
  assert.equal(view.sourceLabel, "newer ready");
  assert.equal(view.loadingMessage, "");
  assert.equal(view.isRefreshing, false);
});
