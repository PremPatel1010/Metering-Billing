import express from "express";
import { usageController } from "../controllers/usageController.js";

const router = express.Router();

router.get('/usage/:tenantId', usageController);

export default router;