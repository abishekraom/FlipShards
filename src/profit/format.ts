export const formatCoins = (value: number) => {
  if (!Number.isFinite(value)) return "n/a";
  return Intl.NumberFormat("en-US", {
    notation: Math.abs(value) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(value) >= 1_000_000 ? 2 : 0,
  }).format(value);
};

export const formatPercent = (value: number) =>
  `${Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;

export const formatQuantity = (value: number) =>
  Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(value);
