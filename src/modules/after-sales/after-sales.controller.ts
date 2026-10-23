import type { RequestHandler } from "express";
import { idempotencyKeyHeader } from "lib/idempotency";
import type { PageQuery } from "lib/http";
import {
  createServiceRequest,
  getMyServiceRequest,
  listMyEligibleDevices,
  listMyServiceRequests,
  assignServiceRequest,
  getAdminServiceRequest,
  getAfterSalesAssignees,
  getAdminServiceRequestSummary,
  listAdminServiceRequestCases,
} from "modules/after-sales/after-sales.service";
import {
  cancelMyItem,
  confirmMyItem,
  disputeMyItem,
  transitionItem,
} from "modules/after-sales/after-sales.actions";
import { addInternalNote, addPublicMessage } from "modules/after-sales/after-sales.events";
import { decideQuote, sendQuote } from "modules/after-sales/after-sales.quotes";
import type { SendQuoteInput } from "modules/after-sales/after-sales.quotes";
import type {
  CreateServiceRequestBody,
  DeviceEligibilityQuery,
  ServiceRequestQuery,
  AdminServiceRequestQuery,
  QuoteDecisionBody,
} from "modules/after-sales/after-sales.schema";

export const listEligibleDevicesHandler: RequestHandler = async (req, res) => {
  const result = await listMyEligibleDevices(
    req.auth!.id,
    res.locals.query as DeviceEligibilityQuery,
  );
  res.json({ data: result.items, meta: result.meta });
};

export const createServiceRequestHandler: RequestHandler = async (req, res) => {
  const key = idempotencyKeyHeader.parse(req.get("idempotency-key"));
  const result = await createServiceRequest(
    req.auth!.id,
    key,
    req.body as CreateServiceRequestBody,
  );
  res.status(result.created ? 201 : 200).json({ data: result.request });
};

export const listMyServiceRequestsHandler: RequestHandler = async (req, res) => {
  const result = await listMyServiceRequests(
    req.auth!.id,
    res.locals.query as ServiceRequestQuery & PageQuery,
  );
  res.json({ data: result.items, meta: result.meta });
};

export const getMyServiceRequestHandler: RequestHandler = async (req, res) => {
  const id = Number((res.locals.params as { id: number }).id);
  res.json({ data: await getMyServiceRequest(req.auth!.id, id) });
};

export const cancelMyItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await cancelMyItem(req.auth!.id, id, itemId) });
};

export const confirmMyItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await confirmMyItem(req.auth!.id, id, itemId) });
};

export const disputeMyItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await disputeMyItem(req.auth!.id, id, itemId, req.body) });
};

export const transitionItemHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res.json({ data: await transitionItem({ id: req.auth!.id }, id, itemId, req.body) });
};

export const addPublicMessageHandler: RequestHandler = async (req, res) => {
  const id = Number((res.locals.params as { id: number }).id);
  res.status(201).json({
    data: await addPublicMessage({ id: req.auth!.id, role: "USER" }, id, req.body),
  });
};

export const addAdminMessageHandler: RequestHandler = async (req, res) => {
  const id = Number((res.locals.params as { id: number }).id);
  res
    .status(201)
    .json({ data: await addPublicMessage({ id: req.auth!.id, role: "ADMIN" }, id, req.body) });
};

export const addInternalNoteHandler: RequestHandler = async (req, res) => {
  const id = Number((res.locals.params as { id: number }).id);
  res.status(201).json({ data: await addInternalNote(req.auth!.id, id, req.body) });
};

export const listAdminServiceRequestsHandler: RequestHandler = async (req, res) => {
  const result = await listAdminServiceRequestCases(res.locals.query as AdminServiceRequestQuery);
  res.json({ data: result.items, meta: result.meta });
};

export const getAdminServiceRequestHandler: RequestHandler = async (req, res) => {
  const id = Number((res.locals.params as { id: number }).id);
  res.json({ data: await getAdminServiceRequest(id) });
};

export const listAfterSalesAssigneesHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getAfterSalesAssignees() });
};

export const getAdminServiceRequestSummaryHandler: RequestHandler = async (_req, res) => {
  res.json({ data: await getAdminServiceRequestSummary() });
};

export const assignServiceRequestHandler: RequestHandler = async (req, res) => {
  const id = Number((res.locals.params as { id: number }).id);
  res.json({ data: await assignServiceRequest(req.auth!.id, id, req.body) });
};

export const sendQuoteHandler: RequestHandler = async (req, res) => {
  const { id, itemId } = res.locals.params as { id: number; itemId: number };
  res
    .status(201)
    .json({ data: await sendQuote(req.auth!.id, id, itemId, req.body as SendQuoteInput) });
};

export const decideQuoteHandler: RequestHandler = async (req, res) => {
  const { id, itemId, quoteId } = res.locals.params as {
    id: number;
    itemId: number;
    quoteId: number;
  };
  res.json({
    data: await decideQuote(
      req.auth!.id,
      id,
      itemId,
      quoteId,
      (req.body as QuoteDecisionBody).decision,
    ),
  });
};
