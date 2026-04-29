import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import productsRouter from "./products";
import ordersRouter from "./orders";
import paymentsRouter from "./payments";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(productsRouter);
router.use(ordersRouter);
router.use(paymentsRouter);

export default router;
