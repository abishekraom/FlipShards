export const BUY_MODES = ["BUY_ORDER", "INSTA_BUY"] as const;
export const SELL_MODES = ["SELL_ORDER", "INSTA_SELL"] as const;

export type BuyMode = (typeof BUY_MODES)[number];
export type SellMode = (typeof SELL_MODES)[number];
export type ShardId = string;
export type RiskLevel = "LOW" | "MEDIUM_LOW" | "MEDIUM" | "MEDIUM_HIGH" | "HIGH";

export interface RawShard {
  name: string;
  family: string;
  type: string;
  rarity: string;
  fuse_amount: number;
  internal_id: string;
}

export interface RawFusionData {
  recipes: Record<ShardId, Record<string, [ShardId, ShardId][]>>;
  shards: Record<ShardId, RawShard>;
}

export interface Shard extends RawShard {
  id: ShardId;
}

export interface FusionInput {
  shardId: ShardId;
  quantity: number;
}

export interface FusionRecipe {
  resultShardId: ShardId;
  resultQuantity: number;
  inputs: FusionInput[];
}

export interface RecipeBook {
  shards: Record<ShardId, Shard>;
  recipesByResult: Record<ShardId, FusionRecipe[]>;
}

export interface ShardPrice {
  shardId: ShardId;
  itemTag: string;
  buyOrderPrice: number | null;
  instaBuyPrice: number | null;
  sellOrderPrice: number | null;
  instaSellPrice: number | null;
  buyVolume: number;
  sellVolume: number;
  averageInstaBuys: number;
  averageInstaSells: number;
  lastUpdated: string;
  source: "coflnet";
}

export interface AcquisitionNode {
  shardId: ShardId;
  quantity: number;
  producedQuantity?: number;
  method: "BUY" | "FUSE";
  unitCost: number;
  totalCost: number;
  recipe?: FusionRecipe;
  reason: string;
  craftsNeeded?: number;
  children?: AcquisitionNode[];
}

export interface AcquisitionResult {
  available: boolean;
  unitCost: number;
  totalCost?: number;
  producedQuantity?: number;
  tree: AcquisitionNode | null;
}

export interface ProfitResult {
  shardId: ShardId;
  rarity: string;
  shardType: string;
  buyMode: BuyMode;
  sellMode: SellMode;
  totalCost: number;
  producedQuantity: number;
  grossRevenue: number;
  revenueAfterTax: number;
  profit: number;
  roi: number;
  buyVolume: number;
  sellVolume: number;
  averageInstaBuys: number;
  averageInstaSells: number;
  liquidityScore: number;
  risk: RiskLevel;
  acquisitionTree: AcquisitionNode;
}

export interface ProfitSettings {
  buyMode: BuyMode;
  sellMode: SellMode;
  taxRate: number;
  rarityFilter: string;
  typeFilter: string;
  minimumProfit: number;
  minimumVolume: number;
  sortMode: "profit" | "roi" | "liquidity" | "volume";
}
