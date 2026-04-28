import { Router, type IRouter } from "express";
import healthRouter from "./health";
import storageRouter from "./storage";
import productsRouter from "./products";

const router: IRouter = Router();

router.use(healthRouter);
router.use(storageRouter);
router.use(productsRouter);

export default router;
