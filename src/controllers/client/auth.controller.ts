import { NextFunction, Request, Response } from "express";
import { registerNewUser } from "services/client/auth.service";
import { RegisterSchema, TRegisterSchema } from "src/validation/register.schema";
const getLoginPage = async (req: Request, res: Response) => {
    const {session} = req as any;
    const messages = session?.messages ?? [];
    return res.render('client/auth/login.ejs', {
        messages
    });
}

const getRegisterPage = async (req: Request, res: Response) => {
    const errors = [];
    const oldData = {
        fullName: '',
        email: '',
        password: '',
        confirmPassword: ''
    }
    return res.render('client/auth/register.ejs', {
        errors,
        oldData
    });
}

const postRegister = async(req: Request, res: Response) => {
    const {fullName, email, password, confirmPassword} = req.body as TRegisterSchema;
    const validate = await RegisterSchema.safeParseAsync(req.body);
    if (!validate.success) {
            const errorsZod = validate.error.issues;
            const errors = errorsZod.map(item => `${item.path[0]}: ${item.message}`);
            const oldData = {
                fullName,
                email,
                password,
                confirmPassword
            }
            return res.render('client/auth/register.ejs', {
                errors, oldData
            });
    }
    // success
    await registerNewUser(fullName, email, password);
    return res.redirect('/login');
}

const getSuccessRedirectPage = async(req: Request, res: Response) => {
    const user = req.user as any;
    if (user?.role?.name === "ADMIN") {
        return res.redirect('/admin');
    } else {
        return res.redirect('/');
    }
}

const postLogout = async(req: Request, res: Response, next: NextFunction) => {
    req.logout(function(err) {
    if (err) { return next(err); }
    res.redirect('/');
  });
}

export {getLoginPage, getRegisterPage, postRegister, getSuccessRedirectPage, postLogout}