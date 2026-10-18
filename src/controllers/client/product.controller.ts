import { Request, Response } from "express";
import { addProductToCart, deleteProductInCart, getProductById, getProductInCart, updateCartDetailBeforeCheckout, handlePlaceOrder, countTotalProductClientPages, getProducts } from "services/client/item.service";
import { getProductWithFilter } from "services/client/product.filter";

const getProductPage = async (req: Request, res: Response) => {
    const { id } = req.params;
    const product = await getProductById(+id);
    return res.render("client/product/detail.ejs", {
        product
    });
}

const postAddProductToCart = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = req.user;

    if (user) {
        await addProductToCart(1, +id, user);
    } else {
        return res.redirect("/login");
    }

    return res.redirect("/");
}

const getCartPage = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.redirect("/login");

    const cartDetails = await getProductInCart(+user.id);

    const totalPrice = cartDetails?.map(item => +item.price * +item.quantity)
        ?.reduce((a, b,) => a + b, 0);
    const cartId = cartDetails.length ? cartDetails[0].cartId : 0;
    return res.render("client/product/cart", {
        cartDetails, totalPrice, cartId
    })
}

const postDeleteProductInCart = async (req: Request, res: Response) => {
    const { id } = req.params;
    const user = req.user;

    if (user) {
        await deleteProductInCart(+id, user.id, user.sumCart);
    } else {
        return res.redirect("/login");
    }

    return res.redirect("/cart");
}

const getCheckOutPage = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.redirect("/login");

    const cartDetails = await getProductInCart(+user.id);

    const totalPrice = cartDetails?.map(item => +item.price * +item.quantity)
        ?.reduce((a, b) => a + b, 0);

    return res.render("client/product/checkout", {
        cartDetails, totalPrice
    })
}

const postHandleCartToCheckOut = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.redirect("/login");
    const {cartId} = req.body;
    const currentCartDetail: { id: string; quantity: string }[]
        = req.body?.cartDetails ?? [];

    await updateCartDetailBeforeCheckout(currentCartDetail, +cartId);

    return res.redirect("/checkout")
}

const postPlaceOrder = async (req: Request, res: Response) => {
    const user = req.user;
    if (!user) return res.redirect("/login");
    const { receiverName, receiverAddress, receiverPhone, totalPrice} = req.body;
    const message = await handlePlaceOrder(+user.id, receiverName, receiverAddress, receiverPhone, +totalPrice);
    if (message) {
        return res.redirect("/checkout");
    }
    return res.redirect("/thanks");
}

const getThanksPage = async (req: Request, res: Response) => {
    return res.render("client/product/thanks.ejs");
}

const postAddToCartFromDetailPage = async (req: Request, res: Response) => {
    const { id } = req.params;
    const { quantity } = req.body;
    const user = req.user;
    if (!user) {
        return res.redirect("/login");
    }
    await addProductToCart(+quantity, +id, user);
    return res.redirect(`/product/${id}`);
}

const getProductFilterPage = async (req: Request, res: Response) => {
    const {page, factory = "", target = "", price = "", sort=""} = req.query as {
        page?: string;
        factory: string;
        target: string;
        price: string;
        sort: string
    };
    let currentPage = page ? +page : 1
    if (currentPage <= 0) currentPage = 1
    
    const data = await getProductWithFilter(currentPage, 6, factory, target, price, sort);

    return res.render("client/product/filter.ejs", {
        products: data.products,
        totalPages: +data.totalPages,
        page: +currentPage
    });
}
export {
    getProductPage, postAddProductToCart, getCartPage,
    postDeleteProductInCart, getCheckOutPage,
    postHandleCartToCheckOut, postPlaceOrder, getThanksPage,
    postAddToCartFromDetailPage, getProductFilterPage
}