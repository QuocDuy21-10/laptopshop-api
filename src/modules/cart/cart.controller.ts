import { RequestHandler } from "express";
import { IdParams } from "lib/http";
import { AddItemBody, UpdateItemBody } from "modules/cart/cart.schema";
import { addItem, getCart, removeItem, updateItem } from "modules/cart/cart.service";

export const getCartHandler: RequestHandler = async (req, res) => {
  res.json({ data: await getCart(req.auth!.id) });
};

export const addItemHandler: RequestHandler = async (req, res) => {
  res.json({ data: await addItem(req.auth!.id, req.body as AddItemBody) });
};

export const updateItemHandler: RequestHandler = async (req, res) => {
  const { id } = res.locals.params as IdParams;
  res.json({ data: await updateItem(req.auth!.id, id, (req.body as UpdateItemBody).quantity) });
};

export const removeItemHandler: RequestHandler = async (req, res) => {
  await removeItem(req.auth!.id, (res.locals.params as IdParams).id);
  res.sendStatus(204);
};
