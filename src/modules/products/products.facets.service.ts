import {
  facetDefinitions,
  type FacetDefinition,
  type ProductFacetKey,
} from "modules/products/products.facets";
import {
  queryProductFacetRows,
  type FacetAggregateRow,
} from "modules/products/products.facets.repository";
import type { ProductFilterQuery } from "modules/products/products.schema";
import type { CatalogPricingContext } from "modules/products/products.catalog.repository";

export type FacetCount = { value: string; count: number };
export type ProductFacetsResult = {
  total: number;
  groups: Partial<Record<ProductFacetKey, FacetCount[]>>;
};

const numericSort = (a: FacetCount, b: FacetCount) => Number(a.value) - Number(b.value);

const valuesForDefinition = (
  definition: FacetDefinition,
  rows: Map<string, number>,
  query: ProductFilterQuery,
): string[] => {
  const staticValues = definition.options?.map((option) => option.value) ?? [];
  const dynamicValues = definition.kind === "exact" ? [...rows.keys()] : [];
  const selectedValues = Array.isArray(query[definition.key])
    ? (query[definition.key] as string[] | number[]).map(String)
    : [];
  return [...new Set([...staticValues, ...dynamicValues, ...selectedValues])];
};

const rowMap = (rows: FacetAggregateRow[], key: ProductFacetKey) => {
  const map = new Map<string, number>();
  for (const row of rows) {
    if (row.facetKey === key) map.set(String(row.value), Number(row.count));
  }
  return map;
};

export const getProductFacets = async (
  query: ProductFilterQuery,
  context: CatalogPricingContext = { asOf: new Date(), mode: "LIST_PRICE" },
): Promise<ProductFacetsResult> => {
  const rows = await queryProductFacetRows(query, context);
  const total = Number(rows.find((row) => row.facetKey === "__total__")?.count ?? 0);
  const groups: Partial<Record<ProductFacetKey, FacetCount[]>> = {};

  for (const definition of facetDefinitions) {
    const counts = rowMap(rows, definition.key);
    const values = valuesForDefinition(definition, counts, query);
    const group = values.map((value) => ({ value, count: counts.get(value) ?? 0 }));
    if (definition.kind === "exact") group.sort(numericSort);
    groups[definition.key] = group;
  }

  return { total, groups };
};
