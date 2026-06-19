import { useCallback, useEffect, useMemo, useRef, useState, startTransition } from "react";
import { AlertTriangle, ArrowDownUp, BarChart3, Calculator, Check, ChevronDown, LockKeyhole, RefreshCw, ShieldCheck, TreePine } from "lucide-react";
import { fetchCoflNetShardPrices } from "./coflnet";
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
const AUTO_REFRESH_INTERVAL_MS = 5 * 60 * 1000;

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

type AppTab = "opportunities" | "craft";
type PriceStatus = "awaiting-token" | "loading" | "ready" | "error";

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

const TokenGate = ({
  token,
  disabled,
  error,
  onTokenChange,
  onSubmit,
}: {
  token: string;
  disabled: boolean;
  error: string;
  onTokenChange: (token: string) => void;
  onSubmit: () => void;
}) => (
  <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-stone-950/85 px-4 backdrop-blur-sm">
    <form
      className="modal-panel w-full max-w-lg rounded-md border border-cyan-400/30 bg-[#151412]/95 p-6 shadow-2xl shadow-cyan-950/30"
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
    >
      <div className="mb-4 inline-flex items-center gap-2 rounded border border-cyan-400/30 bg-cyan-400/10 px-2 py-1 text-xs font-semibold text-cyan-100">
        <LockKeyhole className="h-3.5 w-3.5" />
        CoflNet access required
      </div>
      <h2 className="text-2xl font-semibold text-stone-50">Enter your CoflNet API token</h2>
      <p className="mt-2 text-sm leading-6 text-stone-400">
        The calculator only uses live CoflNet data in production mode. Your token is kept in page memory only, cleared from the input after submit,
        and disappears when you refresh or close this page.
      </p>

      <label className="mt-5 flex flex-col gap-2 text-xs font-medium uppercase tracking-wide text-stone-400">
        CoflNet API token
        <input
          autoComplete="off"
          className="rounded border border-stone-700 bg-stone-900 px-3 py-2 text-sm text-stone-100 outline-none transition focus:border-cyan-400/70"
          disabled={disabled}
          name="coflnet-token"
          onChange={(event) => onTokenChange(event.target.value)}
          placeholder="Paste your Bearer token"
          spellCheck={false}
          type="password"
          value={token}
        />
      </label>

      {error && (
        <div className="mt-4 flex items-start gap-2 rounded border border-red-400/30 bg-red-400/10 px-3 py-2 text-sm text-red-100">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <button
        className="premium-button mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/15 px-4 text-sm font-semibold text-cyan-50 transition hover:bg-cyan-400/25 disabled:cursor-not-allowed disabled:opacity-50"
        disabled={disabled || token.trim().length === 0}
        type="submit"
      >
        <RefreshCw className={`h-4 w-4 ${disabled ? "animate-spin" : ""}`} />
        Load CoflNet Data
      </button>
    </form>
  </div>
);

const AutoRefreshWarning = ({
  onCancel,
  onProceed,
}: {
  onCancel: () => void;
  onProceed: () => void;
}) => (
  <div className="modal-backdrop fixed inset-0 z-50 flex items-center justify-center bg-stone-950/70 px-4 backdrop-blur-sm">
    <div className="modal-panel w-full max-w-md rounded-md border border-amber-400/40 bg-[#181612]/95 p-5 shadow-2xl shadow-amber-950/30">
      <div className="mb-3 inline-flex items-center gap-2 rounded border border-amber-400/40 bg-amber-400/10 px-2 py-1 text-xs font-semibold text-amber-100">
        <AlertTriangle className="h-4 w-4" />
        Auto-refresh warning
      </div>
      <h2 className="text-xl font-semibold text-stone-50">Only enable this with Cofl premium</h2>
      <p className="mt-2 text-sm leading-6 text-stone-300">
        Automatic loading refreshes every 5 minutes and can send many CoflNet snapshot requests. Only use this option if your token is Cofl
        premium. If it is not premium, leave this off or your token might be rate limited or blocked.
      </p>
      <div className="mt-5 grid gap-2 sm:grid-cols-2">
        <button
          className="premium-button inline-flex h-10 items-center justify-center rounded-md border border-stone-600 bg-stone-900 px-4 text-sm font-semibold text-stone-100 transition hover:bg-stone-800"
          onClick={onCancel}
          type="button"
        >
          Leave Off
        </button>
        <button
          className="premium-button inline-flex h-10 items-center justify-center rounded-md border border-amber-400/40 bg-amber-400/15 px-4 text-sm font-semibold text-amber-50 transition hover:bg-amber-400/25"
          onClick={onProceed}
          type="button"
        >
          Proceed and Turn On
        </button>
      </div>
    </div>
  </div>
);

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
            <th className="px-3 py-3 text-right">Avg IB</th>
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
                <td className="numeric px-3 py-3 text-right text-stone-300">{formatCoins(result.averageInstaBuys)}</td>
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
  const [prices, setPrices] = useState<Record<string, ShardPrice>>({});
  const [settings, setSettings] = useState(defaultSettings);
  const [selected, setSelected] = useState<ProfitResult | null>(null);
  const [activeTab, setActiveTab] = useState<AppTab>("opportunities");
  const [craftTargetId, setCraftTargetId] = useState<string | null>(null);
  const [craftQuantity, setCraftQuantity] = useState(1);
  const [apiToken, setApiToken] = useState("");
  const [tokenDraft, setTokenDraft] = useState("");
  const [tokenError, setTokenError] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(false);
  const [showAutoRefreshWarning, setShowAutoRefreshWarning] = useState(false);
  const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false);
  const [priceStatus, setPriceStatus] = useState<PriceStatus>("awaiting-token");
  const [sourceLabel, setSourceLabel] = useState("Awaiting CoflNet token");
  const [loadingMessage, setLoadingMessage] = useState("Loading fusion graph...");
  const loadSequenceRef = useRef(0);
  const backgroundRefreshInFlightRef = useRef(false);

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
    if (!recipeBook || priceStatus !== "ready") return [];
    const optimizer = new ProfitOptimizer(recipeBook, prices);
    return optimizer.calculateAllProfits(settings);
  }, [prices, priceStatus, recipeBook, settings]);

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

  const loadLivePrices = useCallback(async (token: string, options: { background?: boolean } = {}) => {
    if (!recipeBook) return;
    const isBackground = options.background === true;
    if (isBackground && backgroundRefreshInFlightRef.current) return;
    if (isBackground) {
      backgroundRefreshInFlightRef.current = true;
      setIsBackgroundRefreshing(true);
    }

    const loadSequence = loadSequenceRef.current + 1;
    loadSequenceRef.current = loadSequence;
    setTokenError("");

    if (isBackground) {
      setSourceLabel("Refreshing CoflNet in background...");
    } else {
      setPriceStatus("loading");
      setPrices({});
      setSelected(null);
      setCraftTargetId(null);
      setActiveTab("opportunities");
      setLoadingMessage("Loading CoflNet prices: 0%");
    }

    try {
      const report = await fetchCoflNetShardPrices(recipeBook, token, (done, total) => {
        if (loadSequenceRef.current === loadSequence) {
          const percent = Math.round((done / total) * 100);
          if (isBackground) {
            setSourceLabel(`Refreshing CoflNet: ${percent}%`);
          } else {
            setLoadingMessage(`Loading CoflNet prices: ${percent}%`);
          }
        }
      });

      if (loadSequenceRef.current !== loadSequence) return;

      if (report.loaded > 0) {
        setPrices(report.prices);
        setSourceLabel(`CoflNet live, ${report.loaded} loaded${report.failed ? `, ${report.failed} failed` : ""}`);
        setPriceStatus("ready");
        if (!isBackground) setLoadingMessage("");
        return;
      }

      const message = report.errors[0] ?? "CoflNet returned no shard snapshots.";
      if (isBackground) {
        setAutoRefreshEnabled(false);
        setSourceLabel("CoflNet auto-refresh failed; disabled");
        setPriceStatus("ready");
        setLoadingMessage(`Auto-refresh failed and was turned off. First error: ${message}`);
        return;
      }

      setApiToken("");
      setAutoRefreshEnabled(false);
      setSourceLabel("Awaiting CoflNet token");
      setPriceStatus("error");
      setTokenError(`CoflNet load failed. First error: ${message}`);
      setLoadingMessage("");
    } catch (error) {
      if (loadSequenceRef.current !== loadSequence) return;
      const message = error instanceof Error ? error.message : "Unable to load CoflNet prices.";
      if (isBackground) {
        setAutoRefreshEnabled(false);
        setSourceLabel("CoflNet auto-refresh failed; disabled");
        setPriceStatus("ready");
        setLoadingMessage(`Auto-refresh failed and was turned off. ${message}`);
        return;
      }

      setApiToken("");
      setAutoRefreshEnabled(false);
      setSourceLabel("Awaiting CoflNet token");
      setPriceStatus("error");
      setTokenError(message);
      setLoadingMessage("");
    } finally {
      if (isBackground) {
        backgroundRefreshInFlightRef.current = false;
        setIsBackgroundRefreshing(false);
      }
    }
  }, [recipeBook]);

  useEffect(() => {
    if (!autoRefreshEnabled || !apiToken || !recipeBook || priceStatus === "loading") return;

    const timer = window.setInterval(() => {
      if (document.visibilityState === "hidden") return;
      void loadLivePrices(apiToken, { background: true });
    }, AUTO_REFRESH_INTERVAL_MS);

    return () => window.clearInterval(timer);
  }, [apiToken, autoRefreshEnabled, loadLivePrices, priceStatus, recipeBook]);

  const submitToken = () => {
    const token = tokenDraft.trim();
    if (!token) {
      setTokenError("Paste a CoflNet API token to load live Bazaar data.");
      return;
    }

    setApiToken(token);
    setTokenDraft("");
    if (recipeBook) {
      void loadLivePrices(token);
    } else {
      setPriceStatus("loading");
      setLoadingMessage("Loading fusion graph...");
    }
  };

  const profitableCount = rankedResults.filter((result) => result.profit > 0).length;
  const selectedShard = selected && recipeBook ? recipeBook.shards[selected.shardId] : null;
  const showTokenGate = !apiToken && priceStatus !== "loading";
  const isReady = priceStatus === "ready";
  const loadSelectedIntoCraftTab = () => {
    if (!selected) return;
    setCraftTargetId(selected.shardId);
    setCraftQuantity(1);
    setActiveTab("craft");
  };
  const changeToken = () => {
    loadSequenceRef.current += 1;
    setApiToken("");
    setTokenDraft("");
    setAutoRefreshEnabled(false);
    setShowAutoRefreshWarning(false);
    setIsBackgroundRefreshing(false);
    setPrices({});
    setSelected(null);
    setCraftTargetId(null);
    setPriceStatus("awaiting-token");
    setSourceLabel("Awaiting CoflNet token");
    setLoadingMessage("");
  };

  return (
    <>
      <main className="app-shell min-h-screen text-stone-100">
        <div className="page-enter mx-auto flex w-full max-w-7xl flex-col gap-5 px-4 py-5 sm:px-6 lg:px-8">
        <header className="hero-panel grid gap-4 p-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded border border-amber-400/30 bg-amber-400/10 px-2 py-1 text-xs font-medium text-amber-100">
              <ShieldCheck className="h-3.5 w-3.5" />
              FlipShards live Bazaar profit calculator
            </div>
            <h1 className="text-3xl font-semibold tracking-[-0.04em] text-stone-50 sm:text-5xl">FlipShards</h1>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-stone-400">
              Live CoflNet market snapshots meet shard fusion math. Find profitable direct buys, recursive fusions, and custom craft plans.
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
              <div className="status-pulse flex items-center justify-center gap-2 text-xl font-semibold text-cyan-200">{isReady ? "Live" : priceStatus === "loading" ? "Loading" : "Locked"}</div>
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

        {apiToken && (
          <section className="glass-panel relative z-10 flex flex-wrap items-center justify-between gap-3 p-3">
            <div className="text-sm text-stone-400">
              CoflNet token is active in page memory only. Refreshing or closing this page clears it.
            </div>
            <div className="flex flex-wrap items-start gap-2">
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="premium-button inline-flex h-10 items-center justify-center gap-2 rounded-md border border-cyan-400/30 bg-cyan-400/10 px-4 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-400/20 disabled:cursor-not-allowed disabled:opacity-50"
                  onClick={() => void loadLivePrices(apiToken)}
                  disabled={!recipeBook || priceStatus === "loading" || isBackgroundRefreshing}
                >
                  <RefreshCw className={`h-4 w-4 ${priceStatus === "loading" || isBackgroundRefreshing ? "animate-spin" : ""}`} />
                  Reload CoflNet
                </button>
                <label className="flex max-w-xs cursor-pointer items-start gap-2 rounded-md border border-stone-700/80 bg-stone-950/60 px-3 py-2 text-xs text-stone-300 transition hover:border-stone-500/80">
                  <input
                    checked={autoRefreshEnabled}
                    className="mt-0.5 h-4 w-4 accent-cyan-400"
                    disabled={!apiToken}
                    onChange={(event) => {
                      if (event.target.checked) {
                        setShowAutoRefreshWarning(true);
                        return;
                      }
                      setAutoRefreshEnabled(false);
                    }}
                    type="checkbox"
                  />
                  <span>
                    <span className="block font-medium text-stone-100">Automatically load data every 5 minutes</span>
                    <span className="mt-1 block text-stone-500">Off by default. Requires confirmation because non-premium tokens may be rate limited.</span>
                  </span>
                </label>
              </div>
              <button
                type="button"
                className="premium-button inline-flex h-10 items-center justify-center rounded-md border border-stone-600 bg-stone-900 px-4 text-sm font-semibold text-stone-100 transition hover:bg-stone-800"
                onClick={changeToken}
                disabled={priceStatus === "loading"}
              >
                Change Token
              </button>
            </div>
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
              <CraftCalculations result={craftTarget} book={recipeBook} prices={prices} quantity={craftQuantity} onQuantityChange={setCraftQuantity} />
            ) : (
              <div className="surface-panel p-10 text-center text-sm text-stone-400">
                Select a ranked opportunity, then load it into this tab to run custom craft calculations.
              </div>
            )}
          </section>
        )}

        {recipeBook && !isReady && !showTokenGate && (
          <div className="surface-panel p-8 text-center text-sm text-stone-400">
            Live CoflNet data is loading. The calculator will unlock when enough Bazaar snapshots are ready.
          </div>
        )}
        </div>
      </main>
      {showTokenGate && (
        <TokenGate
          disabled={!recipeBook}
          error={tokenError || (recipeBook ? "" : "Loading fusion graph before connecting to CoflNet...")}
          onSubmit={submitToken}
          onTokenChange={setTokenDraft}
          token={tokenDraft}
        />
      )}
      {showAutoRefreshWarning && (
        <AutoRefreshWarning
          onCancel={() => {
            setAutoRefreshEnabled(false);
            setShowAutoRefreshWarning(false);
          }}
          onProceed={() => {
            setAutoRefreshEnabled(true);
            setShowAutoRefreshWarning(false);
          }}
        />
      )}
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
