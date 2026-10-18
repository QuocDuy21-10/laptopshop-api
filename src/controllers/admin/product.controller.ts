import { factoryOptions, targetOptions } from "config/constant";
import { Request, Response } from "express";
import { handleCreateProduct, handleDeleteProduct, getProductById, handleUpdateProduct } from "services/admin/product.service";
import { ProductSchema, TProductSchema } from "src/validation/product.schema";


const getAdminCreateProductPage = (req: Request, res:Response ) => {
    const errors = [];
    const oldData = {
        name: '',
        price: '',
        detailDesc: '',
        shortDesc: '',
        quantity: '',
        factory: '',
        target: ''
    };
    return res.render('admin/product/create.ejs', {
        errors,oldData
    });
}

const postAdminCreateProduct = async(req: Request, res:Response ) => {
    const {name, price, detailDesc, shortDesc, quantity, factory, target} = req.body as TProductSchema;

    const validate = ProductSchema.safeParse(req.body);
    
    if (!validate.success) {
        // error
        const errorsZod = validate.error.issues;
        const errors= errorsZod.map(item => `${item.path[0]}: ${item.message}`);
        const oldData = {
            name,
            price,
            detailDesc,
            shortDesc,
            quantity,
            factory,
            target
        }
        return res.render('admin/product/create.ejs', {
            errors, oldData
        });
    }
    // success
    const image = req?.file?.filename ?? null;
    await handleCreateProduct(name, +price, detailDesc, shortDesc, +quantity, factory, target, image);
    return res.redirect('/admin/product');
}


const postDeleteProduct = async (req: Request, res: Response) => {
    const { id } = req.params;
    await handleDeleteProduct(id);
    return res.redirect('/admin/product');
}

const getViewProduct = async (req: Request, res: Response) => {
    const { id } = req.params;
    const product = await getProductById(+id);
    const factories = factoryOptions;
    const targets = targetOptions;
    return res.render('admin/product/detail.ejs', {
        id, product, factories, targets
    });
}

const postUpdateProduct = async (req: Request, res: Response) => {
    const { id, name, price, detailDesc, shortDesc, quantity, factory, target} = req.body as TProductSchema;
    const image = req?.file?.filename ?? null;
    await handleUpdateProduct(+id, name, +price, detailDesc, shortDesc, +quantity, factory, target, image);
    return res.redirect('/admin/product');
}
export {getAdminCreateProductPage, postAdminCreateProduct, postDeleteProduct, getViewProduct, postUpdateProduct}