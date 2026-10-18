import {Request, Response} from "express";
import { getOrderDetailAdmin } from "services/admin/order.service";

const getAdminOrderDetailPage = async (req:Request, res:Response) => {
    const { id } = req.params;
    const orderDetails = await getOrderDetailAdmin(+id);
    return res.render('admin/order/detail.ejs', {
        id, orderDetails
    });
}
export {getAdminOrderDetailPage}