import { Prisma } from "@prisma/client";
import { prisma } from "config/client";
import { AppError, isUniqueViolation, notFound } from "lib/errors";
import { pageArgs, pageMeta, type PageQuery } from "lib/http";
import {
  toWishlistItemDto,
  wishlistItemInclude,
  type WishlistItemDto,
  type WishlistItemRow,
} from "modules/wishlist/wishlist.mapper";
import { type ConfigurePriceAlertBody, type WishlistQuery } from "modules/wishlist/wishlist.schema";
import {
  resolveAlertPriceSnapshots,
  type AlertPriceRequest,
} from "modules/pricing/alert-price-resolver";
import { requestPricingReevaluation } from "modules/price-alerts/pricing-events";

const WISHLIST_LIMIT = 100;

const productUnavailable = (productId: number) =>
  new AppError("Product is no longer sold", 409, "PRODUCT_UNAVAILABLE", { productId });

const wishlistItemNotFound = () =>
  new AppError("Wishlist item not found", 404, "WISHLIST_ITEM_NOT_FOUND");

const mapItem = async (row: WishlistItemRow, now = new Date()): Promise<WishlistItemDto> => {
  const requests: AlertPriceRequest[] = [
    {
      wishlistItemId: row.id,
      userId: row.userId,
      productId: row.productId,
      includeFlashSale: row.includeFlashSale,
    },
  ];
  const snapshots = await resolveAlertPriceSnapshots(prisma, requests, now);
  return toWishlistItemDto(row, null, snapshots.get(row.id) ?? null);
};

export const listWishlist = async (userId: number, query: WishlistQuery) => {
  const where = { userId };
  const [total, rows] = await Promise.all([
    prisma.wishlistItem.count({ where }),
    prisma.wishlistItem.findMany({
      where,
      include: wishlistItemInclude,
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      ...pageArgs(query),
    }),
  ]);
  const snapshots = await resolveAlertPriceSnapshots(
    prisma,
    rows.map((row) => ({
      wishlistItemId: row.id,
      userId: row.userId,
      productId: row.productId,
      includeFlashSale: row.includeFlashSale,
    })),
    new Date(),
  );
  return {
    items: rows.map((row) => toWishlistItemDto(row, null, snapshots.get(row.id) ?? null)),
    meta: pageMeta(query, total),
  };
};

export const getWishlistSummary = async (userId: number) => ({
  itemCount: await prisma.wishlistItem.count({ where: { userId } }),
});

export const getWishlistStatus = async (userId: number, productIds: number[]) => {
  const rows = await prisma.wishlistItem.findMany({
    where: { userId, productId: { in: productIds } },
    select: { productId: true },
  });
  const wishlisted = new Set(rows.map((row) => row.productId));
  return productIds.map((productId) => ({ productId, isWishlisted: wishlisted.has(productId) }));
};

const findWishlistItem = (userId: number, productId: number) =>
  prisma.wishlistItem.findFirst({
    where: { userId, productId },
    include: wishlistItemInclude,
  });

export const putWishlistItem = async (
  userId: number,
  productId: number,
): Promise<WishlistItemDto> => {
  const row = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw<{ id: number }[]>(
      Prisma.sql`SELECT id FROM users WHERE id = ${userId} FOR UPDATE`,
    );

    const existing = await tx.wishlistItem.findUnique({
      where: { userId_productId: { userId, productId } },
      include: wishlistItemInclude,
    });
    if (existing) return existing;

    const product = await tx.product.findUnique({ where: { id: productId } });
    if (!product) throw notFound("Product");
    if (!product.isActive) throw productUnavailable(productId);

    const count = await tx.wishlistItem.count({ where: { userId } });
    if (count >= WISHLIST_LIMIT) {
      throw new AppError("Wishlist limit reached", 409, "WISHLIST_LIMIT_REACHED", {
        limit: WISHLIST_LIMIT,
      });
    }

    try {
      return await tx.wishlistItem.create({
        data: { userId, productId },
        include: wishlistItemInclude,
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const concurrent = await tx.wishlistItem.findUnique({
        where: { userId_productId: { userId, productId } },
        include: wishlistItemInclude,
      });
      if (concurrent) return concurrent;
      throw error;
    }
  });

  return mapItem(row);
};

export const configureWishlistAlert = async (
  userId: number,
  productId: number,
  input: ConfigurePriceAlertBody,
): Promise<WishlistItemDto> => {
  const existing = await findWishlistItem(userId, productId);
  if (!existing) throw wishlistItemNotFound();

  if (input.mode === null) {
    const updated = await prisma.$transaction(async (tx) => {
      const item = await tx.wishlistItem.update({
        where: { id: existing.id },
        data: {
          alertMode: null,
          targetPrice: null,
          referencePrice: null,
          includeFlashSale: false,
          alertVersion: { increment: 1 },
        },
        include: wishlistItemInclude,
      });
      await requestPricingReevaluation(tx, {
        productIds: [productId],
        eventVersion: String(item.alertVersion),
      });
      return item;
    });
    return mapItem(updated);
  }

  if (!existing.product.isActive) throw productUnavailable(productId);
  const now = new Date();
  const includeFlashSale = "includeFlashSale" in input ? (input.includeFlashSale ?? false) : false;
  const snapshot = (
    await resolveAlertPriceSnapshots(
      prisma,
      [
        {
          wishlistItemId: existing.id,
          userId,
          productId,
          includeFlashSale,
        },
      ],
      now,
    )
  ).get(existing.id);
  if (!snapshot) throw notFound("Product");

  const targetPrice = "targetPrice" in input ? input.targetPrice : null;
  if (
    input.mode === "TARGET_PRICE" &&
    targetPrice !== null &&
    targetPrice >= snapshot.effectivePrice
  ) {
    throw new AppError(
      "Target price must be lower than the current price",
      400,
      "INVALID_TARGET_PRICE",
    );
  }

  const updated = await prisma.$transaction(async (tx) => {
    const item = await tx.wishlistItem.update({
      where: { id: existing.id },
      data: {
        alertMode: input.mode,
        targetPrice: input.mode === "TARGET_PRICE" ? targetPrice : null,
        referencePrice: snapshot.stablePrice,
        includeFlashSale,
        alertVersion: { increment: 1 },
      },
      include: wishlistItemInclude,
    });
    await requestPricingReevaluation(tx, {
      productIds: [productId],
      eventVersion: String(item.alertVersion),
    });
    return item;
  });
  return toWishlistItemDto(updated, null, snapshot);
};

export const deleteWishlistItem = async (userId: number, productId: number) => {
  await prisma.wishlistItem.deleteMany({ where: { userId, productId } });
};

export type { ConfigurePriceAlertBody, PageQuery };
