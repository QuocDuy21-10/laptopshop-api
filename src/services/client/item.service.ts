import { prisma } from "config/client";

const getProducts = async (page: number, pageSize: number) => {
  const skip = (page - 1) * pageSize;
  const products = await prisma.product.findMany({
    skip: skip,
    take: pageSize,
  });
  return products;
};
const getProductById = async (id: number) => {
  const product = await prisma.product.findUnique({
    where: {
      id,
    },
  });
  return product;
};
const addProductToCart = async (
  quantity: number,
  productId: number,
  user: Express.User
) => {
  const cart = await prisma.cart.findUnique({
    where: {
      userId: user.id,
    },
  });
  const product = await prisma.product.findUnique({
    where: {
      id: productId,
    },
  });
  if (cart) {
    // update
    // cập nhật sum giỏ hàng
    await prisma.cart.update({
      where: {
        id: cart.id,
      },
      data: {
        sum: {
          increment: quantity,
        },
      },
    });
    // cập nhật cart detail
    // nếu chưa có thì tạo mới, có rồi thì cập nhật
    const currentCartDetail = await prisma.cartDetail.findFirst({
      where: {
        productId: productId,
        cartId: cart.id,
      },
    });
    await prisma.cartDetail.upsert({
      where: {
        id: currentCartDetail?.id ?? 0,
      },
      update: {
        quantity: {
          increment: quantity,
        },
      },
      create: {
        price: product.price,
        quantity: quantity,
        productId: productId,
        cartId: cart.id,
      },
    });
  } else {
    // create
    await prisma.cart.create({
      data: {
        sum: quantity,
        userId: user.id,
        cartDetails: {
          create: [
            {
              quantity: quantity,
              price: product.price,
              productId: productId,
            },
          ],
        },
      },
    });
  }
};

const getProductInCart = async (userId: number) => {
  const cart = await prisma.cart.findUnique({
    where: {
      userId,
    },
  });
  if (cart) {
    const currentCartDetail = await prisma.cartDetail.findMany({
      where: {
        cartId: cart.id,
      },
      include: {
        product: true,
      },
    });
    return currentCartDetail;
  }
  return [];
};
const deleteProductInCart = async (
  cartDetailId: number,
  userId: number,
  sumCart: number
) => {
  // delete cart detail
  const currentCartDetail = await prisma.cartDetail.findUnique({
    where: {
      id: cartDetailId,
    },
  });
  const quantity = currentCartDetail.quantity;
  await prisma.cartDetail.delete({
    where: {
      id: cartDetailId,
    },
  });
  if (sumCart === 1) {
    // delete cart
    await prisma.cart.delete({
      where: {
        userId,
      },
    });
  } else {
    await prisma.cart.update({
      where: {
        userId,
      },
      data: {
        sum: {
          decrement: quantity,
        },
      },
    });
  }
};

const updateCartDetailBeforeCheckout = async (
  data: { id: string; quantity: string }[],
  cartId: number
) => {
  let quantity = 0;
  for (let i = 0; i < data.length; i++) {
    quantity += +data[i].quantity;
    await prisma.cartDetail.update({
      where: {
        id: +data[i].id,
      },
      data: {
        quantity: +data[i].quantity,
      },
    });
  }
  // update cart sum
  await prisma.cart.update({
    where: {
      id: cartId,
    },
    data: {
      sum: quantity,
    },
  });
};

const handlePlaceOrder = async (
  userId: number,
  receiverName: string,
  receiverAddress: string,
  receiverPhone: string,
  totalPrice: number
) => {
  try {
    // tạo transaction
    await prisma.$transaction(async (tx) => {
      const cart = await tx.cart.findUnique({
        where: {
          userId,
        },
        include: {
          cartDetails: true,
        },
      });
      if (cart) {
        // create order
        const dataOrderDetail =
          cart?.cartDetails?.map((item) => ({
            quantity: item.quantity,
            price: item.price,
            productId: item.productId,
          })) ?? [];
        await tx.order.create({
          data: {
            paymentMethod: "COD",
            paymentStatus: "PAYMENT_UNPAID",
            receiverName: receiverName,
            receiverAddress: receiverAddress,
            receiverPhone: receiverPhone,
            status: "PENDING",
            totalPrice: totalPrice,
            userId: userId,
            orderDetails: {
              create: dataOrderDetail,
            },
          },
        });
        // delete cart detail
        await tx.cartDetail.deleteMany({
          where: {
            cartId: cart.id,
          },
        });
        // delete cart
        await tx.cart.delete({
          where: {
            id: cart.id,
          },
        });
        // check product
        for (let i = 0; i < cart.cartDetails.length; i++) {
          const productId = cart.cartDetails[i].productId;
          const product = await tx.product.findUnique({
            where: {
              id: productId,
            },
          });

          if (!product || product.quantity < cart.cartDetails[i].quantity) {
            throw new Error(
              `Sản phẩm ${product?.name} không tồn tại hoặc không đủ số lượng`
            );
          }
          // update quantity, sold
          await tx.product.update({
            where: {
              id: productId,
            },
            data: {
              quantity: {
                decrement: cart.cartDetails[i].quantity,
              },
              sold: {
                increment: cart.cartDetails[i].quantity,
              },
            },
          });
        }
      }
    });
  } catch (error) {
    console.log(error);
    return error.message;
  }
};
const getOrderHistory = async (userId: number) => {
  return await prisma.order.findMany({
    where: {
      userId,
    },
    include: {
      orderDetails: {
        include: {
          product: true,
        },
      },
    },
  });
};

const countTotalProductClientPages = async (pageSize: number) => {
  const totalItems = await prisma.product.count();
  const totalPages = Math.ceil(totalItems / pageSize);
  return totalPages;
};
export {
  getProducts,
  getProductById,
  addProductToCart,
  getProductInCart,
  deleteProductInCart,
  updateCartDetailBeforeCheckout,
  handlePlaceOrder,
  getOrderHistory,
  countTotalProductClientPages,
};
