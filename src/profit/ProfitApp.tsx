import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { AlertTriangle, ArrowDownUp, BarChart3, Calculator, Check, ChevronDown, RefreshCw, ShieldCheck, TreePine } from "lucide-react";
import { fetchHypixelShardPrices, HypixelSnapshotError } from "./hypixel";
import { applySnapshotFailure, applySnapshotReport, initialSnapshotState, isCurrentSnapshotRequest } from "./snapshot-state";
import { formatCoins, formatPercent, formatQuantity } from "./format";
import { ProfitOptimizer, rankProfits } from "./optimizer";
import { normalizeFusionData } from "./recipes";
import type { AcquisitionNode, BuyMode, ProfitResult, ProfitSettings, RawFusionData, RecipeBook, ShardPrice } from "./types";

const defaultSettings: ProfitSettings = {
  buyMode: "BUY_ORDER",
  sellMode: "SELL_ORDER",
  taxRate: 0.0125,
  rarityFilter: "all",
  typeFilter: "all",
  minimumProfit: 0,
  minimumVolume: 0,
  sortMode: "profit",
};

const buyModeLabels = {
  BUY_ORDER: "Buy Order",
  INSTA_BUY: "Insta Buy",
} as const;

const sellModeLabels = {
  SELL_ORDER: "Sell Order",
  INSTA_SELL: "Insta Sell",
} as const;

const riskStyles = {
  LOW: "border-emerald-400/40 bg-emerald-400/10 text-emerald-200",
  MEDIUM_LOW: "border-lime-400/40 bg-lime-400/10 text-lime-100",
  MEDIUM: "border-amber-400/40 bg-amber-400/10 text-amber-100",
  MEDIUM_HIGH: "border-orange-400/40 bg-orange-400/10 text-orange-100",
  HIGH: "border-red-400/40 bg-red-400/10 text-red-100",
} as const;

const riskLabels = {
  LOW: "LOW",
  MEDIUM_LOW: "MEDIUM LOW",
  MEDIUM: "MEDIUM",
  MEDIUM_HIGH: "MEDIUM HIGH",
  HIGH: "HIGH",
} as const;

const rarityOrder = ["legendary", "rare", "epic", "uncommon", "common"];
const typeOrder = ["Global", "Taming", "Farming", "Hunting", "Mining", "Combat", "Foraging", "Fishing", "Enchanting"];
const sortWithPreferredOrder = (values: string[], preferred: string[]) =>
  [...values].sort((left, right) => {
    const leftIndex = preferred.indexOf(left);
    const rightIndex = preferred.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      if (leftIndex === -1) return 1;
      if (rightIndex === -1) return -1;
      return leftIndex - rightIndex;
    }
    return left.localeCompare(right);
  });

const formatFilterLabel = (value: string) => (value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : value);

interface SelectOption {
  label: string;
  value: string;
}

const AnimatedSelect = ({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: SelectOption[];
  value: string;
  onChange: (value: string) => void;
}) => {
  const [isOpen, setIsOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const selectedOption = options.find((option) => option.value === value) ?? options[0];

  useEffect(() => {
    if (!isOpen) return;

    const closeOnOutsideClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("mousedown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [isOpen]);

  return (
    <div className="control-field flex flex-col gap-1 text-xs text-stone-400">
      <span>{label}</span>
      <div className="select-shell" data-open={isOpen} ref={rootRef}>
        <button
          aria-expanded={isOpen}
          className="select-trigger"
          data-open={isOpen}
          onClick={() => setIsOpen((current) => !current)}
          type="button"
        >
          <span className="truncate">{selectedOption?.label ?? "Select"}</span>
          <ChevronDown className="select-chevron h-4 w-4 shrink-0" />
        </button>
        {isOpen && (
          <div className="select-menu" role="listbox">
            {options.map((option) => {
              const isSelected = option.value === value;
              return (
                <button
                  className="select-option"
                  data-selected={isSelected}
                  key={option.value}
                  onClick={() => {
                    onChange(option.value);
                    setIsOpen(false);
                  }}
                  role="option"
                  type="button"
                >
                  <span className="truncate">{option.label}</span>
                  <Check className="select-check h-4 w-4 shrink-0" />
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

const loadFusionData = async () => {
  const response = await fetch(`${import.meta.env.BASE_URL}fusion-data.json`);
  if (!response.ok) throw new Error(`Unable to load fusion-data.json: ${response.status}`);
  return normalizeFusionData((await response.json()) as RawFusionData);
};

const getShardName = (book: RecipeBook, shardId: string) => book.shards[shardId]?.name ?? shardId;

const formatSnapshotAge = (lastUpdatedMs: number) => {
  const ageMs = Date.now() - lastUpdatedMs;
  if (ageMs < 0) return "timestamp ahead of local clock";
  const ageMinutes = Math.floor(ageMs / 60_000);
  if (ageMinutes < 1) return "less than 1m old";
  if (ageMinutes < 60) return `${ageMinutes}m old`;
  return `${Math.floor(ageMinutes / 60)}h old`;
};

const formatSnapshotLabel = (report: { coverage: { loaded: number; expected: number; matched: number; missing: number; malformed: number }; lastUpdated: string; lastUpdatedMs: number }) =>
  `Hypixel Bazaar snapshot | ${report.coverage.loaded}/${report.coverage.expected} loaded | ${report.coverage.matched} matched | ${report.coverage.missing} missing | ${report.coverage.malformed} malformed | updated ${report.lastUpdated} (${formatSnapshotAge(report.lastUpdatedMs)})`;

type AppTab = "opportunities" | "craft";
interface CraftNode {
  shardId: string;
  quantity: number;
  producedQuantity: number;
  method: "BUY" | "FUSE";
  unitCost: number;
  totalCost: number;
  reason: string;
  craftsNeeded?: number;
  children?: CraftNode[];
}

const getDirectBuyCost = (prices: Record<string, ShardPrice>, shardId: string, buyMode: BuyMode) => {
  const price = prices[shardId];
  if (!price) return null;
  return buyMode === "BUY_ORDER" ? price.buyOrderPrice : price.instaBuyPrice;
};

const buildCraftTree = (
  template: AcquisitionNode,
  requiredQuantity: number,
  prices: Record<string, ShardPrice>,
  buyMode: BuyMode,
  finalRevenueAfterTax?: number
): CraftNode => {
  const directUnitCost = getDirectBuyCost(prices, template.shardId, buyMode);
  const directNode = (): CraftNode => ({
    shardId: template.shardId,
    quantity: requiredQuantity,
    producedQuantity: requiredQuantity,
    method: "BUY",
    unitCost: directUnitCost ?? template.unitCost,
    totalCost: (directUnitCost ?? template.unitCost) * requiredQuantity,
    reason: "buy exact quantity directly",
  });

  if (template.method === "BUY" || !template.recipe || !template.children?.length) {
    return directNode();
  }

  const craftsNeeded = Math.ceil(requiredQuantity / template.recipe.resultQuantity);
  const producedQuantity = craftsNeeded * template.recipe.resultQuantity;
  const children = template.children.map((child, index) => {
    const inputQuantity = (template.recipe?.inputs[index]?.quantity ?? child.quantity * template.recipe!.resultQuantity) * craftsNeeded;
    return buildCraftTree(child, inputQuantity, prices, buyMode);
  });
  const fusionTotalCost = children.reduce((sum, child) => sum + child.totalCost, 0);

  if (finalRevenueAfterTax !== undefined && directUnitCost !== null) {
    const directProfit = finalRevenueAfterTax * requiredQuantity - directUnitCost * requiredQuantity;
    const fusionProfit = finalRevenueAfterTax * producedQuantity - fusionTotalCost;
    if (directProfit >= fusionProfit) {
      return {
        ...directNode(),
        reason: "direct buy has the best executable profit",
      };
    }
  } else if (directUnitCost !== null && directUnitCost * requiredQuantity <= fusionTotalCost) {
    return {
      ...directNode(),
      reason: "direct buy is the lowest executable input cost",
    };
  }

  return {
    shardId: template.shardId,
    quantity: requiredQuantity,
    producedQuantity,
    method: "FUSE",
    unitCost: fusionTotalCost / producedQuantity,
    totalCost: fusionTotalCost,
    reason: finalRevenueAfterTax === undefined ? "fusion is the lowest executable input cost" : "fusion has the best executable profit",
    craftsNeeded,
    children,
  };
};

const CraftTree = ({ node, book, depth = 0 }: { node: CraftNode; book: RecipeBook; depth?: number }) => {
  const shard = book.shards[node.shardId];
  const name = shard?.name ?? node.shardId;
  const children = node.children ?? [];

  return (
    <div className="space-y-2">
      <div className="tree-node grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2" style={{ marginLeft: depth * 16 }}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-50">{name}</span>
            <span className={node.method === "FUSE" ? "rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-xs text-cyan-100" : "rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-xs text-emerald-100"}>
              {node.method}
            </span>
            {node.craftsNeeded !== undefined && <span className="text-xs text-stone-400">{node.craftsNeeded} crafts</span>}
            <span className="text-xs text-stone-500">{node.reason}</span>
          </div>
          <div className="mt-1 text-xs text-stone-400">
            Need {formatQuantity(node.quantity)}x
            {node.producedQuantity !== node.quantity ? `, produces ${formatQuantity(node.producedQuantity)}x` : ""} at {formatCoins(node.unitCost)} each
          </div>
        </div>
        <div className="text-right">
          <div className="numeric text-sm font-semibold text-stone-100">{formatCoins(node.totalCost)}</div>
          <div className="text-xs text-stone-500">total cost</div>
        </div>
      </div>
      {children.map((child, index) => (
        <CraftTree key={`${child.shardId}-${depth}-${index}`} node={child} book={book} depth={depth + 1} />
      ))}
    </div>
  );
};

const CraftCalculations = ({
  result,
  book,
  prices,
  quantity,
  onQuantityChange,
}: {
  result: ProfitResult;
  book: RecipeBook;
  prices: Record<string, ShardPrice>;
  quantity: number;
  onQuantityChange: (quantity: number) => void;
}) => {
  const shard = book.shards[result.shardId];
  const craftTree = useMemo(
    () => buildCraftTree(result.acquisitionTree, quantity, prices, result.buyMode, result.revenueAfterTax),
    [prices, quantity, result.acquisitionTree, result.buyMode, result.revenueAfterTax]
  );
  const sellableQuantity = craftTree.producedQuantity;
  const grossRevenue = result.grossRevenue * sellableQuantity;
  const revenueAfterTax = result.revenueAfterTax * sellableQuantity;
  const profit = revenueAfterTax - craftTree.totalCost;
  const roi = craftTree.totalCost > 0 ? (profit / craftTree.totalCost) * 100 : 0;

  return (
    <div className="surface-panel p-5">
      <div className="grid gap-5 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <div className="space-y-4">
          <div>
            <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-200">
              <Calculator className="h-4 w-4 text-amber-200" />
              Craft Calculations
            </div>
            <h2 className="text-2xl font-semibold text-stone-50">{shard?.name ?? result.shardId}</h2>
            <p className="mt-2 text-sm leading-6 text-stone-400">
              Plan an exact output goal. If a fusion recipe produces extra shards, the totals assume you sell the full produced amount.
            </p>
          </div>

          <label className="flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
            Desired output shards
            <input
              className="numeric rounded-md border border-stone-700/80 bg-stone-950/70 px-3 py-2 text-base font-semibold text-stone-100"
              type="number"
              min="1"
              step="1"
              value={quantity}
              onChange={(event) => onQuantityChange(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
            />
          </label>

          <div className="grid grid-cols-2 gap-2 text-sm">
            <Metric label="Requested" value={`${formatQuantity(quantity)}x`} />
            <Metric label="Produced" value={`${formatQuantity(sellableQuantity)}x`} />
            <Metric label="Total Cost" value={formatCoins(craftTree.totalCost)} />
            <Metric label="After Tax" value={formatCoins(revenueAfterTax)} />
            <Metric label="Profit" value={formatCoins(profit)} tone={profit >= 0 ? "green" : "red"} />
            <Metric label="ROI" value={formatPercent(roi)} tone={profit >= 0 ? "green" : "red"} />
          </div>

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            <div className="metric-card px-3 py-2">
              <div className="text-xs text-stone-500">Gross Revenue</div>
              <div className="numeric mt-1 font-semibold text-stone-100">{formatCoins(grossRevenue)}</div>
            </div>
            <div className="metric-card px-3 py-2">
              <div className="text-xs text-stone-500">Market Route</div>
              <div className="mt-1 font-semibold text-stone-100">
                {buyModeLabels[result.buyMode]} into {sellModeLabels[result.sellMode]}
              </div>
            </div>
          </div>
        </div>

        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-200">
            <TreePine className="h-4 w-4 text-cyan-200" />
            Required shard tree
          </div>
          <CraftTree node={craftTree} book={book} />
        </div>
      </div>
    </div>
  );
};

const AcquisitionTree = ({ node, book, depth = 0 }: { node: AcquisitionNode; book: RecipeBook; depth?: number }) => {
  const shard = book.shards[node.shardId];
  const name = shard?.name ?? node.shardId;
  const children = node.children ?? [];
  const producedQuantity = node.producedQuantity ?? node.quantity;

  return (
    <div className="space-y-2">
      <div
        className="tree-node grid grid-cols-[minmax(0,1fr)_auto] gap-3 px-3 py-2"
        style={{ marginLeft: depth * 16 }}
      >
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-stone-50">{name}</span>
            <span className={node.method === "FUSE" ? "rounded border border-cyan-400/30 bg-cyan-400/10 px-1.5 py-0.5 text-xs text-cyan-100" : "rounded border border-emerald-400/30 bg-emerald-400/10 px-1.5 py-0.5 text-xs text-emerald-100"}>
              {node.method}
            </span>
            {node.craftsNeeded !== undefined && <span className="text-xs text-stone-400">{node.craftsNeeded} crafts</span>}
            <span className="text-xs text-stone-400">{node.reason}</span>
          </div>
          <div className="mt-1 text-xs text-stone-400">
            Need {formatQuantity(node.quantity)}x
            {producedQuantity !== node.quantity ? `, produces ${formatQuantity(producedQuantity)}x` : ""} at {formatCoins(node.unitCost)} each
          </div>
        </div>
        <div className="numeric text-right text-sm font-semibold text-stone-100">{formatCoins(node.totalCost)}</div>
      </div>
      {children.map((child, index) => (
        <AcquisitionTree key={`${child.shardId}-${depth}-${child.method}-${index}`} node={child} book={book} depth={depth + 1} />
      ))}
    </div>
  );
};

const ProfitTable = ({
  results,
  selected,
  book,
  onSelect,
}: {
  results: ProfitResult[];
  selected: ProfitResult | null;
  book: RecipeBook;
  onSelect: (result: ProfitResult) => void;
}) => (
  <div className="market-table overflow-hidden">
    <div className="max-h-[620px] overflow-auto">
      <table className="w-full min-w-[960px] text-left text-sm">
        <thead className="sticky top-0 z-10 bg-stone-950/95 text-xs uppercase tracking-wide text-stone-400 backdrop-blur">
          <tr>
            <th className="px-3 py-3">Shard</th>
            <th className="px-3 py-3 text-right">Profit</th>
            <th className="px-3 py-3 text-right">ROI</th>
            <th className="px-3 py-3 text-right">Cost</th>
            <th className="px-3 py-3 text-right">After Tax</th>
            <th className="px-3 py-3 text-right">Volume</th>
            <th className="px-3 py-3 text-right">7d Buy Activity</th>
            <th className="px-3 py-3">Risk</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-stone-800">
          {results.map((result) => {
            const isSelected = selected?.shardId === result.shardId;
            const volume = Math.min(result.buyVolume, result.sellVolume);
            return (
              <tr
                key={`${result.shardId}-${result.buyMode}-${result.sellMode}`}
                className={`cursor-pointer transition ${isSelected ? "bg-cyan-500/10 shadow-[inset_3px_0_0_rgba(139,223,242,0.72)]" : "hover:bg-stone-900/70"}`}
                onClick={() => onSelect(result)}
              >
                <td className="px-3 py-3">
                  <div className="font-medium text-stone-100">{getShardName(book, result.shardId)}</div>
                  <div className="text-xs text-stone-500">{result.shardId}</div>
                </td>
                <td className={`numeric px-3 py-3 text-right font-semibold ${result.profit >= 0 ? "text-emerald-200" : "text-red-200"}`}>
                  {formatCoins(result.profit)}
                </td>
                <td className="numeric px-3 py-3 text-right text-stone-200">{formatPercent(result.roi)}</td>
                <td className="numeric px-3 py-3 text-right text-stone-300">{formatCoins(result.totalCost)}</td>
                <td className="numeric px-3 py-3 text-right text-stone-300">{formatCoins(result.revenueAfterTax * result.producedQuantity)}</td>
                <td className="numeric px-3 py-3 text-right text-stone-300">{formatCoins(volume)}</td>
                <td className="numeric px-3 py-3 text-right text-stone-300">{formatCoins(result.buyActivity7d)}</td>
                <td className="px-3 py-3">
                  <span className={`inline-flex rounded border px-2 py-1 text-xs font-medium ${riskStyles[result.risk]}`}>
                    {riskLabels[result.risk]}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {results.length === 0 && <div className="px-4 py-10 text-center text-sm text-stone-400">No profitable shards match the current filters.</div>}
    </div>
  </div>
);

export const ProfitApp = () => {
  const [recipeBook, setRecipeBook] = useState<RecipeBook | null>(null);
  const [snapshotState, setSnapshotState] = useState(initialSnapshotState);
  const [settings, setSettings] = useState(defaultSettings);
  const [selected, setSelected] = useState<ProfitResult | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("opportunities");
  const [craftTargetId, setCraftTargetId] = useState<string | null>(null);
  const [craftQuantity, setCraftQuantity] = useState(1);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sourceLabel, setSourceLabel] = useState("Hypixel Bazaar snapshot unavailable");
  const [loadingMessage, setLoadingMessage] = useState("Loading fusion graph...");
  const loadSequenceRef = useRef(0);
  const requestControllerRef = useRef<AbortController | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadFusionData()
      .then((book) => {
        if (cancelled) return;
        setRecipeBook(book);
        setLoadingMessage("");
      })
      .catch((error: unknown) => {
        setLoadingMessage(error instanceof Error ? error.message : "Unable to load fusion data");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  const allResults = useMemo(() => {
    if (!recipeBook || snapshotState.status === "unavailable") return [];
    const optimizer = new ProfitOptimizer(recipeBook, snapshotState.prices);
    return optimizer.calculateAllProfits(settings);
  }, [recipeBook, settings, snapshotState.prices, snapshotState.status]);

  const rankedResults = useMemo(() => rankProfits(allResults, settings).slice(0, 250), [allResults, settings]);

  const rarityOptions = useMemo(() => {
    if (!recipeBook) return [];
    const values = Object.values(recipeBook.shards)
      .map((shard) => shard.rarity)
      .filter((rarity): rarity is string => Boolean(rarity));
    return sortWithPreferredOrder(Array.from(new Set(values)), rarityOrder);
  }, [recipeBook]);

  const typeOptions = useMemo(() => {
    if (!recipeBook) return [];
    const values = Object.values(recipeBook.shards)
      .map((shard) => shard.type)
      .filter((type): type is string => Boolean(type));
    return sortWithPreferredOrder(Array.from(new Set(values)), typeOrder);
  }, [recipeBook]);

  const raritySelectOptions = useMemo(
    () => [{ label: "All Rarities", value: "all" }, ...rarityOptions.map((rarity) => ({ label: formatFilterLabel(rarity), value: rarity }))],
    [rarityOptions]
  );

  const typeSelectOptions = useMemo(
    () => [{ label: "All Types", value: "all" }, ...typeOptions.map((shardType) => ({ label: formatFilterLabel(shardType), value: shardType }))],
    [typeOptions]
  );

  const craftTarget = useMemo(() => {
    if (!craftTargetId) return null;
    return allResults.find((result) => result.shardId === craftTargetId) ?? null;
  }, [allResults, craftTargetId]);

  useEffect(() => {
    startTransition(() => {
      setSelected((current) => {
        if (current && rankedResults.some((result) => result.shardId === current.shardId)) {
          return rankedResults.find((result) => result.shardId === current.shardId) ?? current;
        }
        return rankedResults[0] ?? null;
      });
    });
  }, [rankedResults]);

  useEffect(() => {
    if (craftTargetId && !craftTarget) {
      setCraftTargetId(null);
      setActiveTab("opportunities");
    }
  }, [craftTarget, craftTargetId]);

  const loadBazaarSnapshot = useCallback(async () => {
    if (!recipeBook) return;

    requestControllerRef.current?.abort();
    const controller = new AbortController();
    requestControllerRef.current = controller;
    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    setIsRefreshing(true);
    setSourceLabel("Refreshing Hypixel Bazaar snapshot...");
    setLoadingMessage("Loading Hypixel Bazaar snapshot...");

    try {
      const report = await fetchHypixelShardPrices(recipeBook, controller.signal);
      if (!isCurrentSnapshotRequest(loadSequenceRef.current, loadSequence)) return;

      setSnapshotState((current) => applySnapshotReport(current, report));
      setSourceLabel(formatSnapshotLabel(report));
      setLoadingMessage(report.coverage.loaded < report.coverage.expected ? "Rainbug is unavailable in this official snapshot." : "");
    } catch (error) {
      if (!isCurrentSnapshotRequest(loadSequenceRef.current, loadSequence)) return;
      const message = error instanceof HypixelSnapshotError ? error.message : "Unable to load the Hypixel Bazaar snapshot";
      setSnapshotState((current) => applySnapshotFailure(current, message));
      setSourceLabel("Hypixel Bazaar snapshot unavailable or stale");
      setLoadingMessage(message);
    } finally {
      if (isCurrentSnapshotRequest(loadSequenceRef.current, loadSequence)) {
        requestControllerRef.current = null;
        setIsRefreshing(false);
      }
    }
  }, [recipeBook]);

  useEffect(() => {
    if (recipeBook) void loadBazaarSnapshot();
  }, [loadBazaarSnapshot, recipeBook]);

  useEffect(() => () => requestControllerRef.current?.abort(), []);

  const profitableCount = rankedResults.filter((result) => result.profit > 0).length;
  const selectedShard = selected && recipeBook ? recipeBook.shards[selected.shardId] : null;
  const isReady = snapshotState.status !== "unavailable";
  const loadSelectedIntoCraftTab = () => {
    if (!selected) return;
    setCraftTargetId(selected.shardId);
    setCraftQuantity(1);
    setActiveTab("craft");
  };

  return (
    <>
      <main className="app-shell min-h-screen text-stone-100">
        <div className="page-enter mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="hero-panel grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              FlipShards official Bazaar snapshot profit calculator
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-stone-50 sm:text-5xl">FlipShards</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-400">
              Official Hypixel Bazaar snapshots meet SkyShards fusion math. Find profitable direct buys, recursive fusions, and custom craft plans.
            </p>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-md border border-stone-700/70 bg-stone-950/70 p-2 text-center shadow-2xl shadow-black/20">
            <div className="px-3 py-2">
              <div className="numeric text-xl font-semibold text-stone-50">{recipeBook ? Object.keys(recipeBook.shards).length : 0}</div>
              <div className="text-xs text-stone-500">shards</div>
            </div>
            <div className="px-3 py-2">
              <div className="numeric text-xl font-semibold text-emerald-200">{profitableCount}</div>
              <div className="text-xs text-stone-500">visible profit</div>
            </div>
            <div className="px-3 py-2">
              <div className="status-pulse flex items-center justify-center gap-2 text-xl font-semibold text-cyan-200">{isRefreshing ? "Loading" : isReady ? (snapshotState.status === "stale" ? "Stale" : "Snapshot") : "Unavailable"}</div>
              <div className="text-xs text-stone-500">prices</div>
            </div>
          </div>
        </header>

        {isReady && (
          <section className="control-grid glass-panel relative z-30 grid gap-3 overflow-visible p-3 md:grid-cols-2 xl:grid-cols-[repeat(8,minmax(0,1fr))]">
          <AnimatedSelect
            label="Input Mode"
            onChange={(value) => setSettings((current) => ({ ...current, buyMode: value as ProfitSettings["buyMode"] }))}
            options={[
              { label: buyModeLabels.BUY_ORDER, value: "BUY_ORDER" },
              { label: buyModeLabels.INSTA_BUY, value: "INSTA_BUY" },
            ]}
            value={settings.buyMode}
          />
          <AnimatedSelect
            label="Output Mode"
            onChange={(value) => setSettings((current) => ({ ...current, sellMode: value as ProfitSettings["sellMode"] }))}
            options={[
              { label: sellModeLabels.SELL_ORDER, value: "SELL_ORDER" },
              { label: sellModeLabels.INSTA_SELL, value: "INSTA_SELL" },
            ]}
            value={settings.sellMode}
          />
          <label className="flex flex-col gap-1 text-xs text-stone-400">
            Bazaar Tax
            <input
              className="numeric rounded-md border border-stone-700/80 bg-stone-950/70 px-3 py-2 text-sm text-stone-100"
              type="number"
              min="0"
              step="0.1"
              value={settings.taxRate * 100}
              onChange={(event) => setSettings((current) => ({ ...current, taxRate: Number(event.target.value) / 100 }))}
            />
          </label>
          <AnimatedSelect
            label="Rarity"
            onChange={(value) => setSettings((current) => ({ ...current, rarityFilter: value }))}
            options={raritySelectOptions}
            value={settings.rarityFilter}
          />
          <AnimatedSelect
            label="Type"
            onChange={(value) => setSettings((current) => ({ ...current, typeFilter: value }))}
            options={typeSelectOptions}
            value={settings.typeFilter}
          />
          <label className="flex flex-col gap-1 text-xs text-stone-400">
            Min Profit
            <input
              className="numeric rounded-md border border-stone-700/80 bg-stone-950/70 px-3 py-2 text-sm text-stone-100"
              type="number"
              min="0"
              value={settings.minimumProfit}
              onChange={(event) => setSettings((current) => ({ ...current, minimumProfit: Number(event.target.value) }))}
            />
          </label>
          <label className="flex flex-col gap-1 text-xs text-stone-400">
            Min Volume
            <input
              className="numeric rounded-md border border-stone-700/80 bg-stone-950/70 px-3 py-2 text-sm text-stone-100"
              type="number"
              min="0"
              value={settings.minimumVolume}
              onChange={(event) => setSettings((current) => ({ ...current, minimumVolume: Number(event.target.value) }))}
            />
          </label>
          <AnimatedSelect
            label="Sort"
            onChange={(value) => setSettings((current) => ({ ...current, sortMode: value as ProfitSettings["sortMode"] }))}
            options={[
              { label: "Raw Profit", value: "profit" },
              { label: "ROI", value: "roi" },
              { label: "Liquidity Score", value: "liquidity" },
              { label: "Volume", value: "volume" },
            ]}
            value={settings.sortMode}
          />
        </section>
        )}

        {recipeBook && (
          <section className="glass-panel relative z-10 flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="min-w-0 text-sm text-stone-400">
              <div className="font-medium text-stone-200">{sourceLabel}</div>
              {snapshotState.coverage && (
                <div className="mt-1 text-xs text-stone-500">
                  Coverage: {snapshotState.coverage.loaded}/{snapshotState.coverage.expected} loaded, {snapshotState.coverage.missing} missing, {snapshotState.coverage.malformed} malformed.
                </div>
              )}
              {snapshotState.lastUpdatedMs !== null && (
                <div className="mt-1 text-xs text-stone-500">Official timestamp: {new Date(snapshotState.lastUpdatedMs).toISOString()}</div>
              )}
              {snapshotState.status === "stale" && <div className="mt-1 text-xs text-amber-200">Showing last valid snapshot. {snapshotState.errorMessage}</div>}
              {snapshotState.status === "unavailable" && snapshotState.errorMessage && <div className="mt-1 text-xs text-red-200">Snapshot unavailable: {snapshotState.errorMessage}</div>}
              <div className="mt-1 text-xs text-stone-500">Risk is a provisional heuristic based on official seven-day buy activity, not a CoflNet average.</div>
            </div>
            <button
              type="button"
              className="premium-button inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
              onClick={() => void loadBazaarSnapshot()}
              disabled={!recipeBook || isRefreshing}
            >
              <RefreshCw className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`} />
              Reload Bazaar Snapshot
            </button>
          </section>
        )}

        {loadingMessage && (
          <div className="glass-panel flex items-center gap-2 px-3 py-2 text-sm text-amber-100">
            <AlertTriangle className="h-4 w-4" />
            {loadingMessage}
          </div>
        )}

        {recipeBook && isReady && (
          <section className="stagger-in flex flex-col gap-6">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={`premium-button inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition ${
                    activeTab === "opportunities"
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-100"
                      : "border-stone-700 bg-stone-950 text-stone-300 hover:bg-stone-900"
                  }`}
                  onClick={() => setActiveTab("opportunities")}
                >
                  <BarChart3 className="h-4 w-4" />
                  Ranked Opportunities
                </button>
                <button
                  type="button"
                  className={`premium-button inline-flex items-center gap-2 rounded-md border px-3 py-2 text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
                    activeTab === "craft"
                      ? "border-amber-400/40 bg-amber-400/10 text-amber-100"
                      : "border-stone-700 bg-stone-950 text-stone-300 hover:bg-stone-900"
                  }`}
                  onClick={() => setActiveTab("craft")}
                  disabled={!craftTarget}
                >
                  <Calculator className="h-4 w-4" />
                  Craft Calculations
                </button>
              </div>
              <button
                type="button"
                className="premium-button inline-flex items-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-3 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={loadSelectedIntoCraftTab}
                disabled={!selected}
              >
                <TreePine className="h-4 w-4" />
                Load Selected into Craft Tab
              </button>
            </div>

            {activeTab === "opportunities" ? (
              <>
                <div>
                  <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-stone-200">
                    <BarChart3 className="h-4 w-4 text-emerald-200" />
                    Ranked opportunities
                    <span className="text-xs font-normal text-stone-500">{sourceLabel}</span>
                  </div>
                  <ProfitTable results={rankedResults} selected={selected} book={recipeBook} onSelect={setSelected} />
                </div>

                <section>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold text-stone-200">
                      <TreePine className="h-4 w-4 text-cyan-200" />
                      Acquisition tree
                    </div>
                    {selectedShard && <span className="text-xs text-stone-500">Selected: {selectedShard.name}</span>}
                  </div>
                  <div className="surface-panel p-5">
                    {selected && selectedShard ? (
                      <div className="space-y-4">
                        <div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <h2 className="text-xl font-semibold text-stone-50">{selectedShard.name}</h2>
                            <span className={`rounded border px-2 py-1 text-xs font-medium ${riskStyles[selected.risk]}`}>
                              {riskLabels[selected.risk]}
                            </span>
                          </div>
                          <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                            <Metric label="Profit" value={formatCoins(selected.profit)} tone={selected.profit >= 0 ? "green" : "red"} />
                            <Metric label="ROI" value={formatPercent(selected.roi)} />
                            <Metric label="Cost" value={formatCoins(selected.totalCost)} />
                            <Metric label="After Tax" value={formatCoins(selected.revenueAfterTax * selected.producedQuantity)} />
                            <Metric label="Produced" value={`${formatQuantity(selected.producedQuantity)}x`} />
                          </div>
                        </div>
                        <div className="tree-node flex items-center gap-2 px-3 py-2 text-xs text-stone-400">
                          <ArrowDownUp className="h-4 w-4 text-stone-300" />
                          {buyModeLabels[selected.buyMode]} into {sellModeLabels[selected.sellMode]}
                        </div>
                        <AcquisitionTree node={selected.acquisitionTree} book={recipeBook} />
                      </div>
                    ) : (
                      <div className="py-12 text-center text-sm text-stone-400">Select a row to inspect its fusion path.</div>
                    )}
                  </div>
                </section>
              </>
            ) : craftTarget ? (
              <CraftCalculations result={craftTarget} book={recipeBook} prices={snapshotState.prices} quantity={craftQuantity} onQuantityChange={setCraftQuantity} />
            ) : (
              <div className="surface-panel p-10 text-center text-sm text-stone-400">
                Select a ranked opportunity, then load it into this tab to run custom craft calculations.
              </div>
            )}
          </section>
        )}

        {recipeBook && !isReady && (
          <div className="surface-panel p-8 text-center text-sm text-stone-400">
            The official Hypixel Bazaar snapshot is unavailable. The calculator will unlock after a valid snapshot is loaded.
          </div>
        )}
        </div>
      </main>

    </>
  );
};

const Metric = ({ label, value, tone = "stone" }: { label: string; value: string; tone?: "green" | "red" | "stone" }) => (
  <div className="metric-card px-3 py-2">
    <div className="text-xs text-stone-500">{label}</div>
    <div className={`numeric mt-1 font-semibold ${tone === "green" ? "text-emerald-200" : tone === "red" ? "text-red-200" : "text-stone-100"}`}>
      {value}
    </div>
  </div>
);
