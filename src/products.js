/**
 * Multi-product settings helpers.
 * Each product gets its own browser window at sale time.
 */

function newId() {
  return `p_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

export function createEmptyProduct(overrides = {}) {
  return {
    id: newId(),
    productUrl: "",
    quantity: 1,
    variants: "",
    selectedVariants: [],
    variantScan: null,
    ...overrides,
  };
}

/**
 * Normalize settings.products. Migrates legacy single-product fields.
 */
export function normalizeProducts(settings = {}) {
  const list = Array.isArray(settings.products) ? settings.products : [];
  const cleaned = list
    .map((p, i) => ({
      id: String(p?.id || `p${i + 1}`),
      productUrl: String(p?.productUrl || "").trim(),
      quantity: Math.max(1, Math.min(99, Number(p?.quantity) || 1)),
      variants: String(p?.variants || "").trim(),
      selectedVariants: Array.isArray(p?.selectedVariants) ? p.selectedVariants : [],
      variantScan: p?.variantScan || null,
    }))
    .filter((p) => p.productUrl || p.variantScan || p.variants);

  if (cleaned.length > 0) return cleaned;

  // Legacy single-product → one entry
  const url = String(settings.productUrl || "").trim();
  if (!url && !settings.variantScan) return [];
  return [
    createEmptyProduct({
      id: "p1",
      productUrl: url,
      quantity: Math.max(1, Number(settings.quantity) || 1),
      variants: String(settings.variants || "").trim(),
      selectedVariants: Array.isArray(settings.selectedVariants)
        ? settings.selectedVariants
        : [],
      variantScan: settings.variantScan || null,
    }),
  ];
}

export function productShortLabel(product, index = 0) {
  const scanName = product?.variantScan?.itemName;
  if (scanName) return String(scanName).slice(0, 40);
  try {
    const u = new URL(product.productUrl);
    const last = u.pathname.split("/").filter(Boolean).pop() || "";
    return decodeURIComponent(last).slice(0, 40) || `สินค้า #${index + 1}`;
  } catch {
    return `สินค้า #${index + 1}`;
  }
}
