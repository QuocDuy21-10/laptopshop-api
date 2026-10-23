import { describe, expect, it, jest } from "@jest/globals";
import {
  acquirePriceAlertLock,
  renewPriceAlertLock,
  releasePriceAlertLock,
} from "modules/price-alerts/price-alert.lock";

describe("price alert Redis lock", () => {
  it("acquires with NX and PX options", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>();
    set.mockResolvedValue("OK");
    const redis = { set } as never;

    await expect(
      acquirePriceAlertLock(redis, "worker:price-alert:sweep", "token", 20_000),
    ).resolves.toBe(true);
    expect((redis as { set: jest.Mock }).set).toHaveBeenCalledWith(
      "worker:price-alert:sweep",
      "token",
      { NX: true, PX: 20_000 },
    );
  });

  it("returns false when another worker owns the lock", async () => {
    const set = jest.fn<() => Promise<"OK" | null>>();
    set.mockResolvedValue(null);
    const redis = { set } as never;
    await expect(acquirePriceAlertLock(redis, "key", "token", 10_000)).resolves.toBe(false);
  });

  it("releases only when the Lua compare-and-delete returns one", async () => {
    const evalMock = jest.fn<() => Promise<number>>();
    evalMock.mockResolvedValueOnce(1).mockResolvedValueOnce(0);
    const redis = { eval: evalMock } as never;
    await expect(releasePriceAlertLock(redis, "key", "token")).resolves.toBe(true);
    await expect(releasePriceAlertLock(redis, "key", "other-token")).resolves.toBe(false);
    expect((redis as { eval: jest.Mock }).eval).toHaveBeenCalledWith(
      expect.stringContaining("GET"),
      { keys: ["key"], arguments: ["token"] },
    );
  });

  it("renews only when the same token still owns the lock", async () => {
    const evalMock = jest.fn<() => Promise<number>>();
    evalMock.mockResolvedValue(1);
    const redis = { eval: evalMock } as never;

    await expect(renewPriceAlertLock(redis, "key", "token", 20_000)).resolves.toBe(true);
    expect((redis as { eval: jest.Mock }).eval).toHaveBeenCalledWith(
      expect.stringContaining("PEXPIRE"),
      { keys: ["key"], arguments: ["token", "20000"] },
    );
  });
});
