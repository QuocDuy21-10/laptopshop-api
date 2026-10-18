import { Request, Response } from 'express';
import { countTotalUsers, getAllUsers } from 'services/user.service';
import { countTotalProducts, getAllProducts } from 'services/admin/product.service';
import { countTotalOrders, getOrderAdmin } from 'services/admin/order.service';
import { getDashboardInfo } from 'services/admin/dashboard.service';

const getDashboardPage = async (req:Request, res:Response) => {
    const info = await getDashboardInfo();
    return res.render('admin/dashboard/show.ejs', {
        info
    });
}

const getAdminUserPage = async (req:Request, res:Response) => {
    const {page} = req.query;
    let currentPage = page ? +page : 1
    if (currentPage <= 0) currentPage = 1
    const users = await getAllUsers(currentPage);
    const totalPages = await countTotalUsers()
    return res.render('admin/user/show.ejs', {
        users, totalPages: +totalPages, page: +currentPage
    });
}

const getAdminProductPage = async (req:Request, res:Response) => {
    const {page} = req.query;
    let currentPage = page ? +page : 1
    if (currentPage <= 0) currentPage = 1
    const products = await getAllProducts(currentPage);
    const totalPages = await countTotalProducts()
    return res.render('admin/product/show.ejs', {
        products,totalPages: +totalPages, page: +currentPage
    });
}

const getAdminOrderPage = async (req:Request, res:Response) => {
    const {page} = req.query;
    let currentPage = page ? +page : 1
    if (currentPage <= 0) currentPage = 1
    const orders = await getOrderAdmin(currentPage);
    const totalPages = await countTotalOrders()
    return res.render('admin/order/show.ejs', {
        orders,totalPages: +totalPages, page: +currentPage
    });
}

export { getDashboardPage, getAdminUserPage,getAdminProductPage,getAdminOrderPage }