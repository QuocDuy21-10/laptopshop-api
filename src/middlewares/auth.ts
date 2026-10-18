import { NextFunction, Request, Response } from "express";
const isLogin = (req: Request, res: Response, next: NextFunction) => {
  if (req.isAuthenticated()) {
    return res.redirect("/");
  }
  next();
};
const isAdmin = (req: Request, res: Response, next: NextFunction) => {
  // apply only for admin routes
  if (req.path.startsWith("/admin")) {
    const user = req.user as any;
    if (user?.role?.name === "ADMIN") {
      next();
    } else {
      res.render("status/403.ejs");
    }
    return;
  }

  // client routes
  next();
};
export { isLogin, isAdmin };
