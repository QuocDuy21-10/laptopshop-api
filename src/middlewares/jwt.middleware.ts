import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";
import { env } from "config/env";

const whiteList = ["/login", "/add-product-to-cart"];

const unauthorized = (res: Response): void => {
  res.status(401).json({
    data: null,
    message: "Token không hợp lệ (không truyền lên hoặc hết hạn)",
  });
};

const checkValidJWT = (req: Request, res: Response, next: NextFunction): void => {
  if (whiteList.includes(req.path)) {
    next();
    return;
  }
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : undefined; // format: Bearer <token>
  if (!token) {
    unauthorized(res);
    return;
  }
  try {
    req.user = jwt.verify(token, env.JWT_SECRET, {
      algorithms: ["HS256"],
    }) as unknown as Express.User;
    next();
  } catch {
    unauthorized(res);
  }
};

export { checkValidJWT };
