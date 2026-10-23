import { prisma } from "config/client";
import { createUser, resetDb } from "./fixtures";
import {
  getNotificationPreferences,
  updateNotificationPreferences,
} from "modules/notifications/notification-preferences.service";

beforeEach(resetDb);
afterAll(() => prisma.$disconnect());

describe("notification preference persistence", () => {
  it("defaults external channels off and persists an explicit Web Push opt-in", async () => {
    const user = await createUser();
    await expect(getNotificationPreferences(user.id)).resolves.toEqual({
      inAppEnabled: true,
      emailEnabled: false,
      webPushEnabled: false,
    });

    await expect(updateNotificationPreferences(user.id, { webPushEnabled: true })).resolves.toEqual(
      {
        inAppEnabled: true,
        emailEnabled: false,
        webPushEnabled: true,
      },
    );
  });
});
