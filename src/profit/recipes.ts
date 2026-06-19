import type { FusionRecipe, RawFusionData, RecipeBook, Shard } from "./types";

const makeRecipeKey = (recipe: FusionRecipe) => {
  const inputs = recipe.inputs
    .map((input) => `${input.shardId}:${input.quantity}`)
    .sort()
    .join("|");
  return `${recipe.resultShardId}:${recipe.resultQuantity}:${inputs}`;
};

export const normalizeFusionData = (raw: RawFusionData): RecipeBook => {
  const shards: Record<string, Shard> = Object.fromEntries(
    Object.entries(raw.shards).map(([id, shard]) => [id, { ...shard, id }])
  );

  const recipesByResult: Record<string, FusionRecipe[]> = {};

  for (const [resultShardId, quantityGroups] of Object.entries(raw.recipes)) {
    const recipes: FusionRecipe[] = [];
    const seen = new Set<string>();

    for (const [resultQuantityText, recipeList] of Object.entries(quantityGroups)) {
      const resultQuantity = Number(resultQuantityText);
      if (!Number.isFinite(resultQuantity) || resultQuantity <= 0) continue;

      for (const pair of recipeList) {
        if (pair.length !== 2) continue;
        const [firstInput, secondInput] = pair;
        const firstShard = shards[firstInput];
        const secondShard = shards[secondInput];
        if (!firstShard || !secondShard) continue;

        const recipe: FusionRecipe = {
          resultShardId,
          resultQuantity,
          inputs: [
            { shardId: firstInput, quantity: firstShard.fuse_amount },
            { shardId: secondInput, quantity: secondShard.fuse_amount },
          ],
        };
        const key = makeRecipeKey(recipe);
        if (!seen.has(key)) {
          seen.add(key);
          recipes.push(recipe);
        }
      }
    }

    recipesByResult[resultShardId] = recipes;
  }

  return { shards, recipesByResult };
};
