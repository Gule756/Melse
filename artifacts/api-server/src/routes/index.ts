import { Router, type IRouter } from "express";
import healthRouter from "./health";
import melseRouter from "./melse";
import authRouter from "./auth";
import providerRouter from "./provider";
import trustRouter from "./trust";
import emergencyRouter from "./emergency";
import communicationsRouter from "./communications";
import payoutsRouter from "./payouts";

const router: IRouter = Router();

router.use(healthRouter);
router.use(melseRouter);
router.use(providerRouter);
router.use(trustRouter);
router.use(emergencyRouter);
router.use(communicationsRouter);
router.use(payoutsRouter);
router.use(authRouter);

export default router;
