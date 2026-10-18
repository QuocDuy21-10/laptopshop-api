import { RequestHandler } from "express";
import { UpdateMeBody } from "modules/users/users.schema";
import { getMe, updateMe } from "modules/users/users.service";

export const getMeHandler: RequestHandler = async (req, res) => {
  res.json({ data: await getMe(req.auth!.id) });
};

export const updateMeHandler: RequestHandler = async (req, res) => {
  res.json({ data: await updateMe(req.auth!.id, req.body as UpdateMeBody, req.file?.filename) });
};
