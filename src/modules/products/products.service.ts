import { Prisma, Product } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isNotFound, notFound } from "lib/errors";
import { assertExportSize, CsvColumn, toCsv } from "lib/csv";
import { pageArgs, pageMeta } from "lib/http";
import { moveStock } from "modules/inventory/inventory.service";
import { requestPricingReevaluation } from "modules/price-alerts/pricing-events";
import { toCatalogProductDto, toProductDto } from "modules/products/products.mapper";
import {
  AdminExportProductsQuery,
  AdminListProductsQuery,
  ListProductsQuery,
  ProductBody,
  ProductPatchBody,
} from "modules/products/products.schema";
import {
  assertProductSpecState,
  mergeProductSpecState,
  type ProductSpecState,
} from "modules/products/products.normalization";
import { productWhere } from "modules/products/products.filter";
import { getReviewStatsForProductIds } from "modules/products/products.review-stats.repository";
import { queryRatedProductPage } from "modules/products/products.rating.repository";
import { resolveAutomaticPromotions } from "modules/promotions/promotion-resolver";

const nonNullEntries = (data: Record<string, unknown>) =>
  Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== null && value !== undefined),
  );

export const listProducts = async (
  q: ListProductsQuery | AdminListProductsQuery,
  admin = false,
) => {
  if (!admin && (q.minRating !== undefined || q.sort === "rating_desc")) {
    const ratedPage = await queryRatedProductPage(q);
    const rows = await prisma.product.findMany({
      where: { id: { in: ratedPage.productIds }, isActive: true },
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const promotions = await resolveAutomaticPromotions(prisma, ratedPage.productIds, new Date());
    return {
      items: ratedPage.productIds
        .map((id) => byId.get(id))
        .filter((row): row is Product => Boolean(row))
        .map((row) =>
          toCatalogProductDto(row, ratedPage.summaries.get(row.id), promotions.get(row.id) ?? null),
        ),
      meta: pageMeta(q, ratedPage.total),
    };
  }
  const where = productWhere(q, { admin });
  const orderBy: Prisma.ProductOrderByWithRelationInput | Prisma.ProductOrderByWithRelationInput[] =
    q.sort ? [{ price: q.sort === "price_asc" ? "asc" : "desc" }, { id: "asc" }] : [{ id: "asc" }];
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, orderBy, ...pageArgs(q) }),
  ]);
  if (admin) return { items: rows.map(toProductDto), meta: pageMeta(q, total) };
  const summaries = await getReviewStatsForProductIds(rows.map((row) => row.id));
  const promotions = await resolveAutomaticPromotions(
    prisma,
    rows.map((row) => row.id),
    new Date(),
  );
  return {
    items: rows.map((row) =>
      toCatalogProductDto(row, summaries.get(row.id), promotions.get(row.id) ?? null),
    ),
    meta: pageMeta(q, total),
  };
};

export const getProduct = async (id: number, admin = false) => {
  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || (!admin && !product.isActive)) throw notFound("Product");
  if (admin) return toProductDto(product);
  const summaries = await getReviewStatsForProductIds([product.id]);
  const promotions = await resolveAutomaticPromotions(prisma, [product.id], new Date());
  return toCatalogProductDto(
    product,
    summaries.get(product.id),
    promotions.get(product.id) ?? null,
  );
};

export const compareProducts = async (ids: number[]) => {
  const rows = await prisma.product.findMany({ where: { id: { in: ids }, isActive: true } });
  const byId = new Map(rows.map((p) => [p.id, p]));
  const missingIds = ids.filter((id) => !byId.has(id));
  if (missingIds.length) {
    throw new AppError("Product not found", 404, "NOT_FOUND", { missingIds });
  }
  const promotions = await resolveAutomaticPromotions(prisma, ids, new Date());
  return ids.map((id) => toCatalogProductDto(byId.get(id)!, undefined, promotions.get(id) ?? null));
};

export const createProduct = async (
  input: ProductBody,
  image: string | undefined,
  actorId: number,
) => {
  const specs = mergeProductSpecState(
    {
      cpu: null,
      cpuBrand: null,
      gpu: null,
      gpuBrand: null,
      gpuType: null,
      screenResolution: null,
      resolutionTier: null,
      panelType: null,
    },
    {
      cpu: input.cpu ?? null,
      cpuBrand: input.cpuBrand ?? null,
      gpu: input.gpu ?? null,
      gpuBrand: input.gpuBrand ?? null,
      gpuType: input.gpuType ?? null,
      screenResolution: input.screenResolution ?? null,
      panelType: input.panelType ?? null,
    },
  );
  assertProductSpecState(specs);

  return prisma.$transaction(async (tx) => {
    const created = await tx.product.create({
      data: {
        name: input.name,
        price: input.price,
        quantity: 0,
        shortDesc: input.shortDesc,
        detailDesc: input.detailDesc,
        factory: input.factory,
        target: input.target,
        ...nonNullEntries({
          cpu: specs.cpu,
          cpuBrand: specs.cpuBrand,
          gpu: specs.gpu,
          gpuBrand: specs.gpuBrand,
          gpuType: specs.gpuType,
        }),
        ramGb: input.ramGb,
        storageGb: input.storageGb,
        screenSizeInch: input.screenSizeInch,
        ...nonNullEntries({
          screenResolution: specs.screenResolution,
          resolutionTier: specs.resolutionTier,
          panelType: specs.panelType,
        }),
        refreshRateHz: input.refreshRateHz,
        batteryWh: input.batteryWh,
        weightGrams: input.weightGrams,
        warrantyMonths: input.warrantyMonths,
        ...(image ? { image } : {}),
      },
    });
    if (input.quantity === 0) return toProductDto(created);
    await moveStock(tx, {
      productId: created.id,
      delta: input.quantity,
      reason: "INITIAL",
      actorId,
    });
    return toProductDto(await tx.product.findUniqueOrThrow({ where: { id: created.id } }));
  });
};

export const updateProduct = async (id: number, input: ProductPatchBody, image?: string) => {
  try {
    const specKeys = [
      "cpu",
      "cpuBrand",
      "gpu",
      "gpuBrand",
      "gpuType",
      "screenResolution",
      "panelType",
    ] as const;
    const hasSpecPatch = specKeys.some((key) => key in input);
    let data: Record<string, unknown> = { ...input };
    if (hasSpecPatch) {
      const current = await prisma.product.findUnique({ where: { id } });
      if (!current) throw notFound("Product");
      const currentSpecs: ProductSpecState = {
        cpu: current.cpu ?? null,
        cpuBrand: (current.cpuBrand as ProductSpecState["cpuBrand"]) ?? null,
        gpu: current.gpu ?? null,
        gpuBrand: (current.gpuBrand as ProductSpecState["gpuBrand"]) ?? null,
        gpuType: (current.gpuType as ProductSpecState["gpuType"]) ?? null,
        screenResolution: current.screenResolution ?? null,
        resolutionTier: (current.resolutionTier as ProductSpecState["resolutionTier"]) ?? null,
        panelType: (current.panelType as ProductSpecState["panelType"]) ?? null,
      };
      const specs = mergeProductSpecState(currentSpecs, {
        ...(Object.prototype.hasOwnProperty.call(input, "cpu") ? { cpu: input.cpu ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "cpuBrand")
          ? { cpuBrand: input.cpuBrand ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "gpu") ? { gpu: input.gpu ?? null } : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "gpuBrand")
          ? { gpuBrand: input.gpuBrand ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "gpuType")
          ? { gpuType: input.gpuType ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "screenResolution")
          ? { screenResolution: input.screenResolution ?? null }
          : {}),
        ...(Object.prototype.hasOwnProperty.call(input, "panelType")
          ? { panelType: input.panelType ?? null }
          : {}),
      });
      assertProductSpecState(specs);
      for (const key of specKeys) delete data[key];
      if ("cpu" in input || "cpuBrand" in input) {
        data = { ...data, cpu: specs.cpu, cpuBrand: specs.cpuBrand };
      }
      if ("gpu" in input || "gpuBrand" in input || "gpuType" in input) {
        data = { ...data, gpu: specs.gpu, gpuBrand: specs.gpuBrand, gpuType: specs.gpuType };
      }
      if ("screenResolution" in input) {
        data = {
          ...data,
          screenResolution: specs.screenResolution,
          resolutionTier: specs.resolutionTier,
        };
      }
      if ("panelType" in input) data = { ...data, panelType: specs.panelType };
    }
    const product = await prisma.$transaction(async (tx) => {
      const updated = await tx.product.update({
        where: { id },
        data: { ...data, ...(image ? { image } : {}) },
      });
      if ("price" in data || "isActive" in data) {
        await requestPricingReevaluation(tx, {
          productIds: [id],
          eventVersion: String(id) + "-" + String(Date.now()),
        });
      }
      return updated;
    });
    return toProductDto(product);
  } catch (e) {
    if (isNotFound(e)) throw notFound("Product");
    throw e;
  }
};

export const deleteProduct = async (id: number) => {
  const [ordered, movements] = await Promise.all([
    prisma.orderDetail.count({ where: { productId: id } }),
    prisma.stockMovement.count({ where: { productId: id } }),
  ]);
  if (ordered > 0 || movements > 0) {
    throw new AppError("Product is in orders; hide it instead", 409, "PRODUCT_IN_USE");
  }
  try {
    await prisma.$transaction([
      prisma.cartDetail.deleteMany({ where: { productId: id } }),
      prisma.product.delete({ where: { id } }),
    ]);
  } catch (e) {
    if (isNotFound(e)) throw notFound("Product");
    throw e;
  }
};

const PRODUCT_COLUMNS: CsvColumn<Product>[] = [
  { header: "Mã", value: (p) => p.id },
  { header: "Tên", value: (p) => p.name },
  { header: "Hãng", value: (p) => p.factory },
  { header: "Nhu cầu", value: (p) => p.target },
  { header: "Giá", value: (p) => p.price },
  { header: "Tồn kho", value: (p) => p.quantity },
  { header: "Đã bán", value: (p) => p.sold ?? 0 },
  { header: "Đang bán", value: (p) => (p.isActive ? 1 : 0) },
];

export const exportProducts = async (q: AdminExportProductsQuery) => {
  const where = productWhere(q, { admin: true });
  assertExportSize(await prisma.product.count({ where }));
  return toCsv(PRODUCT_COLUMNS, await prisma.product.findMany({ where, orderBy: { id: "asc" } }));
};
