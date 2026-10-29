import { Router } from "express";
import { getStoreInfo } from "modules/store-info/store-info.controller";

export const storeInfoRoutes = Router();

storeInfoRoutes.get("/", getStoreInfo);
