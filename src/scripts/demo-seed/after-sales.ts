import type { Prisma } from "@prisma/client";

import {
  INTERNAL_NOTES,
  ISSUE_DESCRIPTIONS,
  PUBLIC_MESSAGES,
  QUOTE_LINES,
  RESOLUTIONS,
  SERVICE_SUBJECTS,
  STATUS_NOTES,
} from "scripts/demo-seed/data";
import type { WithId } from "scripts/demo-seed/types";
import type { PlacedLine, PlacedOrder } from "scripts/demo-seed/orders";
import { DAY, HOUR, MINUTE, shift, type Rng } from "scripts/demo-seed/random";
import type {
  ServiceRequestItemStatus,
  ServiceRequestType,
} from "modules/after-sales/after-sales.types";
import { canTransition } from "modules/after-sales/after-sales.status";
import { deriveRequestStatus } from "modules/after-sales/after-sales.aggregate";
import { classifyCoverage } from "modules/after-sales/after-sales.eligibility";

export type ScenarioStep = {
  to: ServiceRequestItemStatus;
  quote?: "SENT" | "ACCEPTED" | "DECLINED";
  closeMode?: "CUSTOMER_CONFIRMATION";
};

export type Scenario = {
  type: ServiceRequestType;
  coverage: "IN_WARRANTY" | "OUT_OF_WARRANTY";
  verify?: "IN_WARRANTY" | "OUT_OF_WARRANTY";
  items: ScenarioStep[][];
};

const toReceived: ScenarioStep[] = [
  { to: "REVIEWING" },
  { to: "APPROVED" },
  { to: "AWAITING_ITEM" },
  { to: "RECEIVED" },
];
const techDiagnosing: ScenarioStep[] = [
  { to: "REVIEWING" },
  { to: "APPROVED" },
  { to: "DIAGNOSING" },
];
const quoteSent: ScenarioStep = { to: "AWAITING_QUOTE_DECISION", quote: "SENT" };
const repaired: ScenarioStep[] = [
  ...toReceived,
  { to: "DIAGNOSING" },
  { to: "IN_SERVICE" },
  { to: "READY_FOR_RETURN" },
  { to: "RETURNED" },
];
const confirmed: ScenarioStep = { to: "CLOSED", closeMode: "CUSTOMER_CONFIRMATION" };

export const SCENARIOS: Scenario[] = [
  { type: "WARRANTY", coverage: "IN_WARRANTY", items: [[]] },
  { type: "TECHNICAL_SUPPORT", coverage: "IN_WARRANTY", items: [[{ to: "REVIEWING" }]] },
  { type: "WARRANTY", coverage: "IN_WARRANTY", items: [toReceived.slice(0, 3)] },
  {
    type: "WARRANTY",
    coverage: "IN_WARRANTY",
    verify: "IN_WARRANTY",
    items: [[...toReceived, { to: "DIAGNOSING" }]],
  },
  { type: "TECHNICAL_SUPPORT", coverage: "IN_WARRANTY", items: [[...techDiagnosing, quoteSent]] },
  {
    type: "TECHNICAL_SUPPORT",
    coverage: "IN_WARRANTY",
    items: [[...techDiagnosing, quoteSent, { to: "IN_SERVICE", quote: "ACCEPTED" }]],
  },
  {
    type: "WARRANTY",
    coverage: "IN_WARRANTY",
    items: [[...toReceived, { to: "DIAGNOSING" }, { to: "IN_SERVICE" }]],
  },
  { type: "WARRANTY", coverage: "IN_WARRANTY", items: [repaired] },
  {
    type: "TECHNICAL_SUPPORT",
    coverage: "IN_WARRANTY",
    items: [[...techDiagnosing, { to: "RESOLVED" }]],
  },
  { type: "WARRANTY", coverage: "IN_WARRANTY", items: [[...repaired, confirmed]] },
  {
    type: "TECHNICAL_SUPPORT",
    coverage: "IN_WARRANTY",
    items: [[...techDiagnosing, { to: "RESOLVED" }, confirmed]],
  },
  { type: "WARRANTY", coverage: "IN_WARRANTY", items: [[{ to: "REVIEWING" }, { to: "REJECTED" }]] },
  {
    type: "TECHNICAL_SUPPORT",
    coverage: "OUT_OF_WARRANTY",
    verify: "OUT_OF_WARRANTY",
    items: [
      [
        ...techDiagnosing,
        quoteSent,
        { to: "DIAGNOSING", quote: "DECLINED" },
        { to: "READY_FOR_RETURN" },
        { to: "RETURNED" },
      ],
    ],
  },
  { type: "TECHNICAL_SUPPORT", coverage: "IN_WARRANTY", items: [[{ to: "CANCELLED" }]] },
  {
    type: "WARRANTY",
    coverage: "IN_WARRANTY",
    items: [
      [...repaired, confirmed],
      [...toReceived, { to: "DIAGNOSING" }],
    ],
  },
];

// sending a quote moves DIAGNOSING -> AWAITING_QUOTE_DECISION through the quote flow, not canTransition
export const isValidPath = (type: ServiceRequestType, steps: ScenarioStep[]) => {
  let from: ServiceRequestItemStatus = "SUBMITTED";
  let quoteAccepted = false;
  for (const step of steps) {
    if (step.quote === "SENT") {
      if (
        type !== "TECHNICAL_SUPPORT" ||
        from !== "DIAGNOSING" ||
        step.to !== "AWAITING_QUOTE_DECISION"
      )
        return false;
    } else {
      if (step.quote === "ACCEPTED") quoteAccepted = true;
      if (!canTransition(type, from, step.to, { quoteAccepted, closeMode: step.closeMode }))
        return false;
    }
    from = step.to;
  }
  return true;
};

type Device = { userId: number; completedAt: Date; line: PlacedLine };

export const buildAfterSales = (
  rng: Rng,
  input: { now: Date; placed: PlacedOrder[]; productNames: Map<number, string>; adminId: number },
) => {
  const { now, adminId } = input;
  const devices: Device[] = input.placed.flatMap(({ status, completedAt, userId, lines }) =>
    status === "COMPLETED" && completedAt
      ? lines.map((line) => ({ userId, completedAt, line }))
      : [],
  );
  const coverageAt = (device: Device, at: Date) =>
    classifyCoverage(
      {
        months: device.line.warrantyMonths,
        startAt: device.line.warrantyStartAt,
        endAt: device.line.warrantyEndAt,
        policySource: "CHECKOUT_SNAPSHOT",
      },
      at,
    );
  const used = new Set<number>();
  const pickDevices = (count: number, createdAt: Date, coverage: Scenario["coverage"]) => {
    const fits = rng.shuffle(
      devices.filter(
        (d) =>
          !used.has(d.line.detailId) &&
          d.completedAt.getTime() < createdAt.getTime() - DAY &&
          coverageAt(d, createdAt) === coverage,
      ),
    );
    for (const first of fits) {
      const group = [first, ...fits.filter((d) => d !== first && d.userId === first.userId)].slice(
        0,
        count,
      );
      if (group.length === count) {
        group.forEach((d) => used.add(d.line.detailId));
        return group;
      }
    }
    throw new Error(`demo seed: no ${coverage} device for an after-sales scenario`);
  };

  const serviceRequests: WithId<Prisma.ServiceRequestCreateManyInput>[] = [];
  const serviceRequestItems: WithId<Prisma.ServiceRequestItemCreateManyInput>[] = [];
  const warrantyVerifications: Prisma.WarrantyVerificationCreateManyInput[] = [];
  const serviceRequestEvents: Prisma.ServiceRequestEventCreateManyInput[] = [];
  const serviceQuotes: WithId<Prisma.ServiceQuoteCreateManyInput>[] = [];
  const serviceQuoteLines: Prisma.ServiceQuoteLineCreateManyInput[] = [];
  let nextItemId = 1;
  let nextQuoteId = 1;

  SCENARIOS.forEach((scenario, index) => {
    const requestId = index + 1;
    const longest = Math.max(...scenario.items.map((steps) => steps.length));
    const gap = rng.int(6, 36) * HOUR;
    const createdAt =
      longest === 0
        ? shift(now, -rng.int(1, 24) * HOUR)
        : shift(now, -rng.int(2, 48) * HOUR - longest * gap);
    const picked = pickDevices(scenario.items.length, createdAt, scenario.coverage);
    const userId = picked[0].userId;
    const subject = rng.pick(SERVICE_SUBJECTS[scenario.type]);
    const event = (e: Omit<Prisma.ServiceRequestEventCreateManyInput, "serviceRequestId">) =>
      serviceRequestEvents.push({ serviceRequestId: requestId, ...e });
    event({
      actorId: userId,
      kind: "REQUEST_CREATED",
      visibility: "PUBLIC",
      body: subject,
      createdAt,
    });
    if (longest > 0)
      event({
        actorId: adminId,
        kind: "ASSIGNED",
        visibility: "INTERNAL",
        body: "Phân công kỹ thuật viên phụ trách",
        createdAt: shift(createdAt, 30 * MINUTE),
      });
    if (longest >= 3)
      event({
        actorId: adminId,
        kind: "INTERNAL_NOTE",
        visibility: "INTERNAL",
        body: rng.pick(INTERNAL_NOTES),
        createdAt: shift(createdAt, 1.5 * gap),
      });
    if (longest >= 4)
      event({
        actorId: adminId,
        kind: "PUBLIC_MESSAGE",
        visibility: "PUBLIC",
        body: rng.pick(PUBLIC_MESSAGES),
        createdAt: shift(createdAt, 2.5 * gap),
      });

    let lastAt = createdAt;
    const finalStatuses: ServiceRequestItemStatus[] = [];
    scenario.items.forEach((steps, position) => {
      const device = picked[position];
      const itemId = nextItemId++;
      const serial = `SN${rng.hex(10).toUpperCase()}`;
      const item: WithId<Prisma.ServiceRequestItemCreateManyInput> = {
        id: itemId,
        serviceRequestId: requestId,
        orderDetailId: device.line.detailId,
        position: position + 1,
        productNameSnapshot: input.productNames.get(device.line.productId) ?? "Laptop",
        deviceLabel: (input.productNames.get(device.line.productId) ?? "Laptop").slice(0, 100),
        serialNumber: serial,
        serialNumberNormalized: serial.toLowerCase(),
        issueDescription: rng.pick(ISSUE_DESCRIPTIONS),
        coverageAtCreation: coverageAt(device, createdAt),
        status: "SUBMITTED",
        version: 1,
        createdAt,
        updatedAt: createdAt,
      };
      if (scenario.verify && position === 0) {
        const verifiedAt = shift(createdAt, gap + HOUR);
        warrantyVerifications.push({
          orderDetailId: device.line.detailId,
          serviceRequestItemId: itemId,
          decision: scenario.verify,
          warrantyStartAt: device.line.warrantyStartAt,
          warrantyEndAt: device.line.warrantyEndAt,
          verifiedById: adminId,
          internalNote: "Đối chiếu ngày hoàn tất đơn hàng và tem bảo hành.",
          createdAt: verifiedAt,
        });
        event({
          serviceRequestItemId: itemId,
          actorId: adminId,
          kind: "WARRANTY_VERIFIED",
          visibility: "PUBLIC",
          body:
            scenario.verify === "IN_WARRANTY"
              ? "Đã xác minh: máy còn bảo hành."
              : "Đã xác minh: máy đã hết bảo hành.",
          createdAt: verifiedAt,
        });
      }

      let status: ServiceRequestItemStatus = "SUBMITTED";
      let quote: WithId<Prisma.ServiceQuoteCreateManyInput> | null = null;
      steps.forEach((step, stepIndex) => {
        const at = shift(createdAt, (stepIndex + 1) * gap);
        if (step.quote === "SENT") {
          const lines = rng.shuffle(QUOTE_LINES).slice(0, 2);
          const total = lines.reduce((sum, line) => sum + line.quantity * line.unitPrice, 0);
          quote = {
            id: nextQuoteId++,
            serviceRequestItemId: itemId,
            version: 1,
            status: "SENT",
            currency: "VND",
            subtotal: total,
            total,
            note: "Báo giá có hiệu lực 7 ngày.",
            validUntil: shift(at, 7 * DAY),
            createdById: adminId,
            createdAt: at,
          };
          serviceQuotes.push(quote);
          const quoteId = quote.id;
          lines.forEach((line, i) =>
            serviceQuoteLines.push({
              quoteId,
              description: line.description,
              quantity: line.quantity,
              unitPrice: line.unitPrice,
              lineTotal: line.quantity * line.unitPrice,
              position: i + 1,
            }),
          );
          event({
            serviceRequestItemId: itemId,
            actorId: adminId,
            kind: "QUOTE_SENT",
            visibility: "PUBLIC",
            body: `Báo giá ${total.toLocaleString("vi-VN")} VND`,
            createdAt: at,
          });
        }
        if ((step.quote === "ACCEPTED" || step.quote === "DECLINED") && quote) {
          quote.status = step.quote;
          quote.respondedAt = at;
          event({
            serviceRequestItemId: itemId,
            actorId: userId,
            kind: "QUOTE_DECIDED",
            visibility: "PUBLIC",
            body:
              step.quote === "ACCEPTED"
                ? "Khách hàng đồng ý báo giá."
                : "Khách hàng từ chối báo giá.",
            createdAt: at,
          });
        }
        const byCustomer = step.to === "CANCELLED" || step.closeMode === "CUSTOMER_CONFIRMATION";
        event({
          serviceRequestItemId: itemId,
          actorId: byCustomer ? userId : adminId,
          kind: step.closeMode ? "CUSTOMER_CONFIRMED" : "STATUS_CHANGED",
          visibility: "PUBLIC",
          fromStatus: status,
          toStatus: step.to,
          body: STATUS_NOTES[step.to] ?? null,
          createdAt: at,
        });
        if (step.to === "RESOLVED" || step.to === "RETURNED") {
          item.resolution = item.resolution ?? rng.pick(RESOLUTIONS);
          if (step.to === "RESOLVED") item.resolvedAt = at;
          else item.returnedAt = at;
          item.confirmationDueAt = shift(at, 168 * HOUR);
        }
        if (step.to === "CLOSED")
          Object.assign(item, {
            customerConfirmedAt: at,
            closedAt: at,
            closeReason: "CUSTOMER_CONFIRMED",
          });
        if (step.to === "REJECTED")
          Object.assign(item, {
            closedAt: at,
            closeReason: "REJECTED",
            resolution: "Lỗi do va đập, không thuộc phạm vi bảo hành.",
          });
        if (step.to === "CANCELLED")
          Object.assign(item, { closedAt: at, closeReason: "CUSTOMER_CANCELLED" });
        status = step.to;
        item.status = status;
        item.version = stepIndex + 2;
        item.updatedAt = at;
        if (at > lastAt) lastAt = at;
      });
      finalStatuses.push(status);
      serviceRequestItems.push(item);
    });

    const requestStatus = deriveRequestStatus(finalStatuses);
    serviceRequests.push({
      id: requestId,
      code: `AS-${createdAt.getTime()}-${rng.hex(8)}`,
      userId,
      type: scenario.type,
      status: requestStatus,
      subject,
      assignedToId: longest > 0 ? adminId : null,
      idempotencyKey: rng.uuid(),
      requestHash: rng.hex(64),
      version: 1 + scenario.items.reduce((sum, steps) => sum + steps.length, 0),
      createdAt,
      updatedAt: lastAt,
      closedAt: requestStatus === "CLOSED" ? lastAt : null,
    });
  });

  return {
    serviceRequests,
    serviceRequestItems,
    warrantyVerifications,
    serviceRequestEvents,
    serviceQuotes,
    serviceQuoteLines,
  };
};
