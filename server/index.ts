/** Office-A API サーバ（ローカル専用） */
import fs from "node:fs";
import path from "node:path";
import express, { type ErrorRequestHandler, type NextFunction, type Request, type Response } from "express";
import { Store, normalizeDB } from "./storage";
import { exportWorkbook } from "./excel";
import { ImportError, importWorkbook } from "./excelImport";
import { currentFiscalYear } from "./seed";

const HOST = "127.0.0.1";
const PORT = Number(process.env.PORT) || 5174;
const ROOT = path.resolve(import.meta.dirname, "..");
const DATA_DIR = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(ROOT, "data");
const DIST_DIR = path.join(ROOT, "dist");
const isProd = process.env.NODE_ENV === "production";

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly extra: Record<string, unknown> = {},
  ) {
    super(message);
  }
}

export function createApp(store: Store): express.Express {
  const app = express();
  app.disable("x-powered-by");

  app.use((req: Request, res: Response, next: NextFunction) => {
    const t0 = process.hrtime.bigint();
    res.on("finish", () => {
      const ms = Number(process.hrtime.bigint() - t0) / 1e6;
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms.toFixed(1)}ms`);
    });
    next();
  });

  app.use("/api", express.json({ limit: "20mb" }));

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, version: store.get().version, time: new Date().toISOString() });
  });

  app.get("/api/db", (_req, res) => {
    res.json(store.get());
  });

  app.put("/api/db", (req, res) => {
    const current = store.get().version;
    const body: unknown = req.body;
    const clientVersion = typeof body === "object" && body !== null ? (body as { version?: unknown }).version : undefined;
    if (clientVersion !== current) {
      res.status(409).json({ error: "conflict", version: current });
      return;
    }
    const next = normalizeDB(body);
    if (!next) throw new HttpError(400, "invalid db payload");
    const saved = store.replace({ ...next, version: current + 1 });
    res.json({ version: saved.version });
  });

  app.post("/api/import", (req, res) => {
    const next = normalizeDB(req.body);
    if (!next) throw new HttpError(400, "invalid db payload");
    const saved = store.replace({ ...next, version: store.get().version + 1 });
    res.json({ version: saved.version });
  });

  app.get("/api/export.xlsx", async (req, res) => {
    const db = store.get();
    const startMonth = db.settings.fiscalYearStartMonth || 4;
    const q = typeof req.query.year === "string" ? req.query.year : undefined;
    let year = currentFiscalYear(startMonth);
    if (q !== undefined) {
      if (!/^\d{4}$/.test(q)) throw new HttpError(400, "year must be YYYY");
      year = Number(q);
    }
    const buf = await exportWorkbook(db, year);
    const filename = `office-a_${year}年度.xlsx`;
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="office-a_${year}.xlsx"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader("Content-Length", String(buf.length));
    res.end(buf);
  });

  /** 編集した Excel の取り込み。?dryRun=1 はレポートのみ返して保存しない */
  app.post(
    "/api/import.xlsx",
    express.raw({
      type: ["application/octet-stream", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      limit: "20mb",
    }),
    async (req, res) => {
      const body: unknown = req.body;
      if (!Buffer.isBuffer(body) || body.length === 0) {
        throw new HttpError(400, "xlsx の本体が空です（Content-Type: application/octet-stream で送信してください）");
      }
      const dryRun = req.query.dryRun === "1" || req.query.dryRun === "true";
      const before = store.get();
      let result: Awaited<ReturnType<typeof importWorkbook>>;
      try {
        result = await importWorkbook(body, before);
      } catch (e) {
        if (e instanceof ImportError) throw new HttpError(400, e.message);
        throw e;
      }
      if (dryRun) {
        res.json({ dryRun: true, report: result.report });
        return;
      }
      if (store.get() !== before) throw new HttpError(409, "conflict", { version: store.get().version });
      const saved = store.replace({ ...result.db, version: before.version + 1 });
      res.json({ version: saved.version, report: result.report });
    },
  );

  app.use("/api", (_req, _res, next) => next(new HttpError(404, "not found")));

  if (isProd && fs.existsSync(DIST_DIR)) {
    app.use(express.static(DIST_DIR, { index: false }));
    app.use((req, res, next) => {
      if (req.method !== "GET" && req.method !== "HEAD") return next();
      res.sendFile(path.join(DIST_DIR, "index.html"));
    });
  }

  const onError: ErrorRequestHandler = (err, _req, res, _next) => {
    const e = err as { status?: number; statusCode?: number; type?: string; message?: string; extra?: object };
    const status = e.status ?? e.statusCode ?? 500;
    if (status >= 500) console.error(err);
    if (res.headersSent) return;
    const message =
      e.type === "entity.too.large" ? "payload too large" : e.type === "entity.parse.failed" ? "invalid json" : status >= 500 ? "internal error" : (e.message ?? "error");
    res.status(status).json({ error: message, ...(err instanceof HttpError ? err.extra : {}) });
  };
  app.use(onError);

  return app;
}

const store = new Store(DATA_DIR);
const app = createApp(store);
const server = app.listen(PORT, HOST, () => {
  console.log(`[office-a] API listening on http://${HOST}:${PORT} (data: ${store.file}${isProd ? ", serving dist" : ""})`);
});
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
