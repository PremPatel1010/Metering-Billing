import express from "express";
import { checkoutController } from "../controllers/checkoutController.js";

const router = express.Router();

router.post('/checkout', checkoutController);

export default router;