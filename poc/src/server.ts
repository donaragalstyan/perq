/**
 * perq POC — minimal Express server.
 *
 * Exposes:
 *   GET /api/nearby?lat=&lng=&radiusKm=&category=   -> businesses within radius (w/ meters)
 *   GET /api/viewport?minLng=&minLat=&maxLng=&maxLat=&category=  -> businesses in bbox
 *   GET /api/config                                 -> { mapboxToken } for the client map
 *   GET /                                           -> bare Mapbox map page (public/index.html)
 *
 * Throwaway POC. Synthetic data only. No auth, no polish.
 */
import express, { type Request, type Response } from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { withinRadius, withinViewport } from "./spatial.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = Number(process.env.PORT ?? 3000);

/** Parse a required finite float query param; returns null if invalid. */
function num(value: unknown): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

app.get("/api/config", (_req: Request, res: Response) => {
  res.json({ mapboxToken: process.env.MAPBOX_PUBLIC_TOKEN ?? "" });
});

app.get("/api/nearby", async (req: Request, res: Response) => {
  const lat = num(req.query.lat);
  const lng = num(req.query.lng);
  const radiusKm = num(req.query.radiusKm) ?? 2;
  const category =
    typeof req.query.category === "string" && req.query.category.trim() !== ""
      ? req.query.category
      : undefined;

  if (lat === null || lng === null) {
    return res.status(400).json({ error: "lat and lng are required numbers" });
  }
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) {
    return res.status(400).json({ error: "lat/lng out of range" });
  }
  if (radiusKm <= 0 || radiusKm > 50) {
    return res.status(400).json({ error: "radiusKm must be in (0, 50]" });
  }

  try {
    const results = await withinRadius({ lat, lng }, radiusKm * 1000, category);
    res.json({ count: results.length, results });
  } catch (err) {
    console.error("/api/nearby failed:", err);
    res.status(500).json({ error: "query failed" });
  }
});

app.get("/api/viewport", async (req: Request, res: Response) => {
  const minLng = num(req.query.minLng);
  const minLat = num(req.query.minLat);
  const maxLng = num(req.query.maxLng);
  const maxLat = num(req.query.maxLat);
  const category =
    typeof req.query.category === "string" && req.query.category.trim() !== ""
      ? req.query.category
      : undefined;

  if (minLng === null || minLat === null || maxLng === null || maxLat === null) {
    return res
      .status(400)
      .json({ error: "minLng, minLat, maxLng, maxLat are required numbers" });
  }

  try {
    const results = await withinViewport(
      { minLng, minLat, maxLng, maxLat },
      category,
    );
    res.json({ count: results.length, results });
  } catch (err) {
    console.error("/api/viewport failed:", err);
    res.status(500).json({ error: "query failed" });
  }
});

app.use(express.static(path.join(__dirname, "..", "public")));

// Do not listen when imported by tests.
if (process.env.NODE_ENV !== "test") {
  app.listen(PORT, () => {
    console.log(`perq POC listening on http://localhost:${PORT}`);
  });
}

export { app };
