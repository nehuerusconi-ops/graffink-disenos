import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import productsRouter from "./products";
import categoriesRouter from "./categories";
import ordersRouter from "./orders";
import paymentsRouter from "./payments";
import settingsRouter from "./settings";
import securityRouter from "./security";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(productsRouter);
router.use(categoriesRouter);
router.use(ordersRouter);
router.use(paymentsRouter);
router.use(settingsRouter);
router.use(securityRouter);

export default router;
