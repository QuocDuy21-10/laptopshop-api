import type { Prisma } from "@prisma/client";

import { ACCOUNT_TYPE } from "config/constant";
import { FAMILY_NAMES, GIVEN_NAMES, MIDDLE_NAMES, PLACES, STREETS } from "scripts/demo-seed/data";
import type { DemoProduct, DemoUser, WithId } from "scripts/demo-seed/types";
import { DAY, HOUR, earlier, shift, type Rng } from "scripts/demo-seed/random";

export const DEMO_USER_COUNT = 30;
const CART_COUNT = 10;
const WISHLIST_COUNT = 60;
const NEWSLETTER_COUNT = 40;

const pad2 = (n: number) => String(n).padStart(2, "0");
const roundTo = (value: number, step: number) => Math.round(value / step) * step;

export type CustomersResult = {
  users: DemoUser[];
  userRows: WithId<Prisma.UserCreateManyInput>[];
  carts: Prisma.CartCreateManyInput[];
  cartDetails: Prisma.CartDetailCreateManyInput[];
  wishlistItems: Prisma.WishlistItemCreateManyInput[];
  newsletterSubscribers: Prisma.NewsletterSubscriberCreateManyInput[];
};

export const randomFullName = (rng: Rng) =>
  `${rng.pick(FAMILY_NAMES)} ${rng.pick(MIDDLE_NAMES)} ${rng.pick(GIVEN_NAMES)}`;
export const randomPhone = (rng: Rng) => `09${String(rng.int(0, 99_999_999)).padStart(8, "0")}`;

export const buildCustomers = (
  rng: Rng,
  now: Date,
  input: { firstUserId: number; userRoleId: number; passwordHash: string; products: DemoProduct[] },
): CustomersResult => {
  const users: DemoUser[] = Array.from({ length: DEMO_USER_COUNT }, (_, index) => {
    const place = rng.pick(PLACES);
    return {
      id: input.firstUserId + index,
      username: `user${pad2(index + 1)}@demo.local`,
      fullName: randomFullName(rng),
      phone: randomPhone(rng),
      address: `${rng.pick(STREETS)}, ${place.district}, ${place.city}`,
    };
  });
  const userRows = users.map((user) => ({
    ...user,
    password: input.passwordHash,
    accountType: ACCOUNT_TYPE.SYSTEM,
    roleId: input.userRoleId,
    emailVerifiedAt: rng.chance(0.9) ? shift(now, -rng.int(1, 200) * DAY) : null,
  }));

  const shoppable = input.products.filter((p) => p.isActive && p.endState === "NORMAL");
  const carts = rng
    .shuffle(users)
    .slice(0, CART_COUNT)
    .map((user, index) => ({ id: index + 1, userId: user.id }));
  const cartDetails = carts.flatMap((cart) =>
    rng
      .shuffle(shoppable)
      .slice(0, rng.int(1, 3))
      .map((product) => ({ cartId: cart.id, productId: product.id, quantity: rng.int(1, 2) })),
  );

  const active = input.products.filter((p) => p.isActive);
  const wishlistItems: Prisma.WishlistItemCreateManyInput[] = [];
  const wished = new Set<string>();
  while (wishlistItems.length < WISHLIST_COUNT) {
    const user = rng.pick(users);
    const product = rng.pick(active);
    const key = `${user.id}:${product.id}`;
    if (wished.has(key)) continue;
    wished.add(key);
    const roll = rng.next();
    const createdAt = shift(now, -rng.int(1, 90) * DAY);
    wishlistItems.push({
      userId: user.id,
      productId: product.id,
      alertMode: roll < 1 / 6 ? "PERCENT_DROP" : roll < 1 / 3 ? "TARGET_PRICE" : null,
      targetPrice: roll >= 1 / 6 && roll < 1 / 3 ? roundTo(product.price * 0.9, 100_000) : null,
      referencePrice: roll < 1 / 3 ? product.price : null,
      createdAt,
      updatedAt: createdAt,
    });
  }

  const newsletterSubscribers = Array.from({ length: NEWSLETTER_COUNT }, (_, index) => {
    const email = index < 15 ? users[index].username : `docgia${pad2(index - 14)}@demo.local`;
    const createdAt = shift(now, -rng.int(1, 150) * DAY);
    const status = rng.weighted([
      ["CONFIRMED", 60],
      ["PENDING", 25],
      ["UNSUBSCRIBED", 15],
    ] as const);
    const confirmedAt = status === "PENDING" ? null : shift(createdAt, rng.int(1, 12) * HOUR);
    return {
      email,
      status,
      confirmTokenHash: status === "PENDING" ? rng.hex(64) : null,
      confirmExpiresAt: status === "PENDING" ? shift(now, 2 * DAY) : null,
      lastConfirmationSentAt: status === "PENDING" ? shift(now, -HOUR) : null,
      confirmedAt,
      unsubscribedAt:
        status === "UNSUBSCRIBED" && confirmedAt
          ? earlier(shift(confirmedAt, rng.int(5, 30) * DAY), shift(now, -HOUR))
          : null,
      createdAt,
      updatedAt: createdAt,
    };
  });

  return { users, userRows, carts, cartDetails, wishlistItems, newsletterSubscribers };
};
