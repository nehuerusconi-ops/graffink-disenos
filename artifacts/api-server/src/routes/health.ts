import { Router, type IRouter } from "express";
import { HealthCheckResponse } from "@workspace/api-zod";

const router: IRouter = Router();

function healthResponse() {
  return HealthCheckResponse.parse({ status: "ok" });
}

router.get("/health", (_req, res) => {
  res.json(healthResponse());
});

router.get("/healthz", (_req, res) => {
  res.json(healthResponse());
});

export default router;
