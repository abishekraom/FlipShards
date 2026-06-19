import type {
  AcquisitionNode,
  AcquisitionResult,
  BuyMode,
  FusionRecipe,
  ProfitResult,
  ProfitSettings,
  RecipeBook,
  RiskLevel,
  SellMode,
  ShardPrice,
} from "./types";

type PriceMap = Record<string, ShardPrice>;
type CostState = {
  costs: Map<string, number>;
  choices: Map<string, FusionRecipe | null>;
};
type ExecutablePlan = {
  available: boolean;
  totalCost: number;
  producedQuantity: number;
  tree: AcquisitionNode | null;
};

const unavailable: AcquisitionResult = {
  available: false,
  unitCost: Number.POSITIVE_INFINITY,
  totalCost: Number.POSITIVE_INFINITY,
  producedQuantity: 0,
  tree: null,
};

const unavailablePlan: ExecutablePlan = {
  available: false,
  totalCost: Number.POSITIVE_INFINITY,
  producedQuantity: 0,
  tree: null,
};

const getBuyCost = (price: ShardPrice | undefined, buyMode: BuyMode) => {
  if (!price) return null;
  return buyMode === "BUY_ORDER" ? price.buyOrderPrice : price.instaBuyPrice;
};

const getSellRevenue = (price: ShardPrice | undefined, sellMode: SellMode) => {
  if (!price) return null;
  return sellMode === "SELL_ORDER" ? price.sellOrderPrice : price.instaSellPrice;
};

const scaleTree = (node: AcquisitionNode, quantity: number): AcquisitionNode => {
  const factor = node.quantity === 0 ? 0 : quantity / node.quantity;

  return {
    ...node,
    quantity,
    totalCost: node.unitCost * quantity,
    children: node.children?.map((child) => scaleTree(child, child.quantity * factor)),
  };
};

export class ProfitOptimizer {
  private costMemo = new Map<BuyMode, CostState>();
  private treeMemo = new Map<string, AcquisitionResult>();
  private readonly recipeBook: RecipeBook;
  private readonly prices: PriceMap;

  constructor(recipeBook: RecipeBook, prices: PriceMap) {
    this.recipeBook = recipeBook;
    this.prices = prices;
  }

  getBestAcquisition(shardId: string, buyMode: BuyMode, visiting = new Set<string>()): AcquisitionResult {
    const memoKey = `${buyMode}:${shardId}`;
    const cached = this.treeMemo.get(memoKey);
    if (cached && !this.treeTouchesVisiting(cached.tree, visiting)) return cached;

    const state = this.computeCostState(buyMode);
    const result = this.buildTreeFromChoices(shardId, buyMode, state, visiting);

    if (!this.treeTouchesVisiting(result.tree, visiting)) this.treeMemo.set(memoKey, result);
    return result;
  }

  calculateAllProfits(settings: Pick<ProfitSettings, "buyMode" | "sellMode" | "taxRate">): ProfitResult[] {
    this.treeMemo.clear();
    const results: ProfitResult[] = [];

    for (const shardId of Object.keys(this.recipeBook.shards)) {
      const shard = this.recipeBook.shards[shardId];
      const acquisition = this.getBestAcquisition(shardId, settings.buyMode);
      const sellPrice = getSellRevenue(this.prices[shardId], settings.sellMode);

      if (!acquisition.available || !acquisition.tree || sellPrice === null || !Number.isFinite(sellPrice)) {
        continue;
      }

      const price = this.prices[shardId];
      const revenueAfterTax = sellPrice * (1 - settings.taxRate);
      const executable = this.buildExecutablePlan(acquisition.tree, 1, settings.buyMode, revenueAfterTax);

      if (!executable.available || !executable.tree) {
        continue;
      }

      const totalRevenueAfterTax = revenueAfterTax * executable.producedQuantity;
      const profit = totalRevenueAfterTax - executable.totalCost;
      const volume = Math.min(price?.buyVolume ?? 0, price?.sellVolume ?? 0);
      const averageInstaBuys = price?.averageInstaBuys ?? 0;
      const averageInstaSells = price?.averageInstaSells ?? 0;
      const liquidityFactor = Math.min(1, volume / 25_000);
      const roi = executable.totalCost > 0 ? (profit / executable.totalCost) * 100 : 0;

      results.push({
        shardId,
        rarity: shard?.rarity ?? "",
        shardType: shard?.type ?? "",
        buyMode: settings.buyMode,
        sellMode: settings.sellMode,
        totalCost: executable.totalCost,
        producedQuantity: executable.producedQuantity,
        grossRevenue: sellPrice,
        revenueAfterTax,
        profit,
        roi,
        buyVolume: price?.buyVolume ?? 0,
        sellVolume: price?.sellVolume ?? 0,
        averageInstaBuys,
        averageInstaSells,
        liquidityScore: Math.max(0, profit) * Math.log(volume + 1) * liquidityFactor,
        risk: this.classifyRisk(averageInstaBuys),
        acquisitionTree: executable.tree,
      });
    }

    return results;
  }

  private buildExecutablePlan(
    template: AcquisitionNode,
    requiredQuantity: number,
    buyMode: BuyMode,
    finalRevenueAfterTax?: number
  ): ExecutablePlan {
    const directUnitCost = getBuyCost(this.prices[template.shardId], buyMode);
    const directPlan =
      directUnitCost === null || !Number.isFinite(directUnitCost)
        ? unavailablePlan
        : {
            available: true,
            totalCost: directUnitCost * requiredQuantity,
            producedQuantity: requiredQuantity,
            tree: {
              shardId: template.shardId,
              quantity: requiredQuantity,
              producedQuantity: requiredQuantity,
              method: "BUY" as const,
              unitCost: directUnitCost,
              totalCost: directUnitCost * requiredQuantity,
              reason: "direct market buy is executable for this quantity",
            },
          };

    if (template.method === "BUY" || !template.recipe || !template.children?.length) {
      return directPlan;
    }

    const craftsNeeded = Math.ceil(requiredQuantity / template.recipe.resultQuantity);
    const producedQuantity = craftsNeeded * template.recipe.resultQuantity;
    const children: AcquisitionNode[] = [];
    let fusionTotalCost = 0;

    for (let index = 0; index < template.children.length; index += 1) {
      const child = template.children[index];
      const input = template.recipe.inputs[index];
      if (!child || !input) return directPlan.available ? directPlan : unavailablePlan;

      const childPlan = this.buildExecutablePlan(child, input.quantity * craftsNeeded, buyMode);
      if (!childPlan.available || !childPlan.tree) return directPlan.available ? directPlan : unavailablePlan;
      children.push(childPlan.tree);
      fusionTotalCost += childPlan.totalCost;
    }

    const fusionPlan: ExecutablePlan = {
      available: true,
      totalCost: fusionTotalCost,
      producedQuantity,
      tree: {
        shardId: template.shardId,
        quantity: requiredQuantity,
        producedQuantity,
        method: "FUSE",
        unitCost: fusionTotalCost / producedQuantity,
        totalCost: fusionTotalCost,
        recipe: template.recipe,
        reason: finalRevenueAfterTax === undefined ? "fusion is the lowest executable input cost" : "fusion has the best executable profit",
        craftsNeeded,
        children,
      },
    };

    if (!directPlan.available) return fusionPlan;

    if (finalRevenueAfterTax !== undefined) {
      const directProfit = finalRevenueAfterTax * directPlan.producedQuantity - directPlan.totalCost;
      const fusionProfit = finalRevenueAfterTax * fusionPlan.producedQuantity - fusionPlan.totalCost;
      if (directProfit >= fusionProfit) {
        return {
          ...directPlan,
          tree: directPlan.tree ? { ...directPlan.tree, reason: "direct buy has the best executable profit" } : null,
        };
      }
      return fusionPlan;
    }

    if (directPlan.totalCost <= fusionPlan.totalCost) {
      return {
        ...directPlan,
        tree: directPlan.tree ? { ...directPlan.tree, reason: "direct buy is the lowest executable input cost" } : null,
      };
    }
    return fusionPlan;
  }

  private classifyRisk(averageInstaBuys: number): RiskLevel {
    if (averageInstaBuys < 9_000) return "HIGH";
    if (averageInstaBuys < 10_000) return "MEDIUM_HIGH";
    if (averageInstaBuys < 20_000) return "MEDIUM";
    if (averageInstaBuys < 22_000) return "MEDIUM_LOW";
    return "LOW";
  }

  private treeTouchesVisiting(node: AcquisitionNode | null, visiting: Set<string>): boolean {
    if (!node || visiting.size === 0) return false;
    if (visiting.has(node.shardId)) return true;
    return (node.children ?? []).some((child) => this.treeTouchesVisiting(child, visiting));
  }

  private computeCostState(buyMode: BuyMode): CostState {
    const cached = this.costMemo.get(buyMode);
    if (cached) return cached;

    const shardIds = Object.keys(this.recipeBook.shards);
    const costs = new Map<string, number>();
    const choices = new Map<string, FusionRecipe | null>();
    const allRecipes = Object.values(this.recipeBook.recipesByResult).flat();

    for (const shardId of shardIds) {
      const directCost = getBuyCost(this.prices[shardId], buyMode);
      costs.set(shardId, directCost ?? Number.POSITIVE_INFINITY);
      choices.set(shardId, null);
    }

    const tolerance = 0.000001;
    for (let pass = 0; pass < shardIds.length; pass += 1) {
      let changed = false;

      for (const recipe of allRecipes) {
        let recipeCost = 0;
        let available = true;

        for (const input of recipe.inputs) {
          const inputCost = costs.get(input.shardId) ?? Number.POSITIVE_INFINITY;
          if (!Number.isFinite(inputCost)) {
            available = false;
            break;
          }
          recipeCost += (inputCost * input.quantity) / recipe.resultQuantity;
        }

        if (!available) continue;
        const currentCost = costs.get(recipe.resultShardId) ?? Number.POSITIVE_INFINITY;
        if (recipeCost + tolerance < currentCost) {
          costs.set(recipe.resultShardId, recipeCost);
          choices.set(recipe.resultShardId, recipe);
          changed = true;
        }
      }

      if (!changed) break;
    }

    const state = { costs, choices };
    this.costMemo.set(buyMode, state);
    return state;
  }

  private buildTreeFromChoices(shardId: string, buyMode: BuyMode, state: CostState, visiting: Set<string>): AcquisitionResult {
    const unitCost = state.costs.get(shardId) ?? Number.POSITIVE_INFINITY;
    if (!Number.isFinite(unitCost)) return unavailable;

    const directCost = getBuyCost(this.prices[shardId], buyMode);
    const choice = state.choices.get(shardId) ?? null;
    if (!choice || visiting.has(shardId)) {
      if (directCost === null || !Number.isFinite(directCost)) return unavailable;
      return {
        available: true,
        unitCost: directCost,
        tree: {
          shardId,
          quantity: 1,
          method: "BUY",
          unitCost: directCost,
          totalCost: directCost,
          reason: "direct market buy is currently cheapest",
        },
      };
    }

    const nextVisiting = new Set(visiting);
    nextVisiting.add(shardId);
    const children: AcquisitionNode[] = [];

    for (const input of choice.inputs) {
      const child = this.buildTreeFromChoices(input.shardId, buyMode, state, nextVisiting);
      if (!child.available || !child.tree) return unavailable;
      children.push(scaleTree(child.tree, input.quantity / choice.resultQuantity));
    }

    return {
      available: true,
      unitCost,
      tree: {
        shardId,
        quantity: 1,
        method: "FUSE",
        unitCost,
        totalCost: unitCost,
        recipe: choice,
        reason: directCost === null ? "direct market price unavailable" : "fusion is currently cheaper",
        children,
      },
    };
  }
}

export const rankProfits = (results: ProfitResult[], settings: ProfitSettings) => {
  const filtered = results.filter((result) => {
    const volume = Math.min(result.buyVolume, result.sellVolume);
    const rarityMatches = settings.rarityFilter === "all" || result.rarity === settings.rarityFilter;
    const typeMatches = settings.typeFilter === "all" || result.shardType === settings.typeFilter;
    return result.profit >= settings.minimumProfit && volume >= settings.minimumVolume && rarityMatches && typeMatches;
  });

  return filtered.sort((left, right) => {
    switch (settings.sortMode) {
      case "roi":
        return right.roi - left.roi;
      case "liquidity":
        return right.liquidityScore - left.liquidityScore;
      case "volume":
        return Math.min(right.buyVolume, right.sellVolume) - Math.min(left.buyVolume, left.sellVolume);
      case "profit":
        return right.profit - left.profit;
    }
  });
};
