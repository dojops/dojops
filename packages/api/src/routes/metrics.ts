import { Router } from "express";
import type { MetricsAggregator } from "../metrics";

export function createMetricsRouter(aggregator: MetricsAggregator): Router {
  const router = Router();

  router.get("/", (_req, res) => {
    res.json(aggregator.getAll());
  });

  router.get("/overview", (_req, res) => {
    res.json(aggregator.getOverview());
  });

  router.get("/security", (_req, res) => {
    res.json(aggregator.getSecurity());
  });

  router.get("/audit", (_req, res) => {
    res.json(aggregator.getAudit());
  });

  return router;
}
