import assert from "node:assert/strict";
import test from "node:test";
import { buildHypixelSnapshot } from "../src/profit/hypixel";
import {
  applySnapshotFailure,
  applySnapshotReport,
  initialSnapshotState,
  isCurrentSnapshotRequest,
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

test("a superseded request cannot commit its result", () => {
  const firstRequest = 1;
  const secondRequest = 2;

  assert.equal(isCurrentSnapshotRequest(secondRequest, firstRequest), false);
  assert.equal(isCurrentSnapshotRequest(secondRequest, secondRequest), true);
});
