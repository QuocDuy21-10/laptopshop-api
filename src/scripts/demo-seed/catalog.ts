import type { Prisma } from "@prisma/client";

import { BANNERS, FACTORY_IMAGES, PRODUCT_FAMILIES, SUPPLIERS } from "scripts/demo-seed/data";
import type { BaseProduct, DemoProduct, StockEndState, WithId } from "scripts/demo-seed/types";
import { DAY, HOUR, shift, type Rng } from "scripts/demo-seed/random";
import {
  inferCpuBrand,
  inferGpuProfile,
  inferResolutionTier,
} from "modules/products/products.normalization";

export type PostedReceipt = {
  id: string;
  postedAt: Date;
  items: { productId: number; quantity: number }[];
};

export type CatalogResult = {
  products: DemoProduct[];
  productRows: WithId<Prisma.ProductCreateManyInput>[];
  openingAt: Date;
  receipts: PostedReceipt[];
  stockReceipts: Prisma.StockReceiptCreateManyInput[];
  stockReceiptItems: Prisma.StockReceiptItemCreateManyInput[];
  homeBanners: Prisma.HomeBannerCreateManyInput[];
  bannerImages: { from: string; to: string }[];
};

const storageLabel = (gb: number) => (gb >= 1024 ? `${gb / 1024}TB` : `${gb}GB`);
const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const RECEIPT_DAYS_AGO = [170, 140, 110, 80, 50, 20];

export const buildCatalog = (
  rng: Rng,
  now: Date,
  baseProducts: BaseProduct[],
  adminId: number,
): CatalogResult => {
  let nextId = Math.max(0, ...baseProducts.map((p) => p.id)) + 1;
  const productRows: WithId<Prisma.ProductCreateManyInput>[] = PRODUCT_FAMILIES.flatMap((family) =>
    [false, true].map((upgraded) => {
      const ramGb = upgraded ? family.ramGb * 2 : family.ramGb;
      const storageGb = upgraded ? Math.min(family.storageGb * 2, 2048) : family.storageGb;
      const gpu = inferGpuProfile(family.gpu);
      return {
        id: nextId++,
        name: `${family.name} ${ramGb}GB/${storageLabel(storageGb)}`,
        price: upgraded ? family.price + roundTo(family.price * 0.12, 100_000) : family.price,
        image: rng.pick(FACTORY_IMAGES[family.factory]),
        shortDesc: `${family.cpu} · ${ramGb}GB · ${storageLabel(storageGb)}`,
        detailDesc: `${family.name} trang bị ${family.cpu}, ${family.gpu}, màn hình ${family.screenSizeInch} inch ${family.screenResolution} ${family.refreshRateHz}Hz, pin ${family.batteryWh}Wh, nặng ${(family.weightGrams / 1000).toFixed(2)} kg. Bảo hành chính hãng ${family.warrantyMonths} tháng.`,
        // quantity and sold are replaced by the simulated stock ledger in build.ts
        quantity: 0,
        sold: 0,
        factory: family.factory,
        target: family.target,
        isActive: true,
        cpu: family.cpu,
        gpu: family.gpu,
        cpuBrand: inferCpuBrand(family.cpu),
        gpuBrand: gpu?.gpuBrand ?? null,
        gpuType: gpu?.gpuType ?? null,
        ramGb,
        storageGb,
        screenSizeInch: family.screenSizeInch,
        screenResolution: family.screenResolution,
        resolutionTier: inferResolutionTier(family.screenResolution),
        refreshRateHz: family.refreshRateHz,
        batteryWh: family.batteryWh,
        weightGrams: family.weightGrams,
        warrantyMonths: family.warrantyMonths,
      };
    }),
  );

  const shuffledNew = rng.shuffle(productRows.map((row) => row.id));
  const endStates = new Map<number, StockEndState>();
  shuffledNew.slice(0, 3).forEach((id) => endStates.set(id, "OUT_OF_STOCK"));
  shuffledNew.slice(3, 7).forEach((id) => endStates.set(id, "LOW_STOCK"));
  const inactive = new Set(shuffledNew.slice(7, 9));
  productRows.forEach((row) => {
    if (inactive.has(row.id)) row.isActive = false;
  });

  const products: DemoProduct[] = [
    ...baseProducts.map((p) => ({
      id: p.id,
      name: p.name,
      price: p.price,
      factory: p.factory ?? "",
      target: p.target ?? "",
      warrantyMonths: p.warrantyMonths ?? 0,
      isActive: p.isActive,
      openingQuantity: p.quantity,
      endState: "NORMAL" as const,
    })),
    ...productRows.map((row) => ({
      id: row.id,
      name: row.name,
      price: row.price,
      factory: row.factory ?? "",
      target: row.target ?? "",
      warrantyMonths: row.warrantyMonths ?? 0,
      isActive: row.isActive !== false,
      openingQuantity: rng.int(15, 40),
      endState: endStates.get(row.id) ?? "NORMAL",
    })),
  ];

  const activeProducts = products.filter((p) => p.isActive);
  const stockReceipts: Prisma.StockReceiptCreateManyInput[] = [];
  const stockReceiptItems: Prisma.StockReceiptItemCreateManyInput[] = [];
  const receipts: PostedReceipt[] = [];
  const addReceipt = (index: number, createdAt: Date, postedAt: Date | null) => {
    const id = rng.uuid();
    const items = rng.shuffle(activeProducts).slice(0, rng.int(2, 4));
    stockReceipts.push({
      id,
      code: `PN-DEMO-${String(index + 1).padStart(3, "0")}`,
      supplierName: rng.pick(SUPPLIERS),
      status: postedAt ? "POSTED" : "DRAFT",
      note: postedAt ? "Nhập hàng định kỳ" : "Phiếu nháp chờ duyệt",
      createdAt,
      postedAt,
      createdById: adminId,
      postedById: postedAt ? adminId : null,
    });
    const receiptItems = items.map((product) => ({
      productId: product.id,
      quantity: rng.int(5, 20),
    }));
    receiptItems.forEach((item) =>
      stockReceiptItems.push({
        receiptId: id,
        productId: item.productId,
        quantity: item.quantity,
        unitCost: roundTo((products.find((p) => p.id === item.productId)?.price ?? 0) * 0.8, 1000),
      }),
    );
    if (postedAt) receipts.push({ id, postedAt, items: receiptItems });
  };
  RECEIPT_DAYS_AGO.forEach((days, index) => {
    const postedAt = shift(now, -days * DAY + rng.int(1, 9) * HOUR);
    addReceipt(index, shift(postedAt, -rng.int(1, 3) * DAY), postedAt);
  });
  addReceipt(6, shift(now, -3 * DAY), null);
  addReceipt(7, shift(now, -1 * DAY), null);

  const bannerImages: { from: string; to: string }[] = [];
  const homeBanners: Prisma.HomeBannerCreateManyInput[] = BANNERS.map((banner, index) => {
    const imagePath = `demo-${banner.placement.toLowerCase()}-${index + 1}.png`;
    bannerImages.push({ from: banner.image, to: imagePath });
    return {
      placement: banner.placement,
      eyebrow: banner.eyebrow ?? null,
      title: banner.title,
      highlight: banner.highlight ?? null,
      description: banner.description ?? null,
      ctaText: banner.ctaText ?? null,
      linkUrl: banner.linkUrl ?? null,
      secondaryCtaText: banner.secondaryCtaText ?? null,
      secondaryLinkUrl: banner.secondaryLinkUrl ?? null,
      badges: banner.badges,
      imagePath,
      imageAlt: banner.imageAlt,
      position: index,
      isActive: true,
      startsAt: banner.expired ? shift(now, -60 * DAY) : shift(now, -10 * DAY),
      endsAt: banner.expired ? shift(now, -30 * DAY) : shift(now, 30 * DAY),
    };
  });

  return {
    products,
    productRows,
    // before the oldest demo order (18 months back)
    openingAt: shift(now, -19 * 30 * DAY),
    receipts,
    stockReceipts,
    stockReceiptItems,
    homeBanners,
    bannerImages,
  };
};
