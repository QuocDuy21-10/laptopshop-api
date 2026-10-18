import {
  createUsersAPI,
  deleteUserByIdAPI,
  fetchAccountAPI,
  getAllUsersAPI,
  getUserByIdAPI,
  loginAPI,
  postAddProductToCartAPI,
  updataUserByIdAPI,
} from "controllers/client/api.controller";
import express, { Express } from "express";
import { checkValidJWT } from "middlewares/jwt.middleware";

const router = express.Router();

const apiRoutes = (app: Express) => {
  router.post("/add-product-to-cart", postAddProductToCartAPI);

  // RESTful API
  // user
  router.get("/users", getAllUsersAPI);
  router.get("/users/:id", getUserByIdAPI);
  router.post("/users", createUsersAPI);
  router.put("/users/:id", updataUserByIdAPI);
  router.delete("/users/:id", deleteUserByIdAPI);

  router.post("/login", loginAPI);

  router.get("/account", fetchAccountAPI);

  app.use("/api", checkValidJWT, router);
};

export default apiRoutes;
