import { Router, type IRouter } from "express";
import healthRouter from "./health";
import melseRouter from "./melse";

const router: IRouter = Router();

router.use(healthRouter);
router.use(melseRouter);

export default router;
