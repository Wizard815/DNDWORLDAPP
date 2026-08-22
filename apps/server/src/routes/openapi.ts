import type { FastifyInstance } from "fastify";
import { buildOpenApiDocument } from "@dndworldapp/schema/openapi";

/**
 * The spec is generated once at boot from the Zod schemas, then served as-is.
 * `/api/v1/openapi.json` is deliberately public: it is a contract, not data.
 */
const document = buildOpenApiDocument();

export async function openApiRoutes(app: FastifyInstance): Promise<void> {
  app.get("/api/v1/openapi.json", async (_request, reply) => {
    reply.header("cache-control", "public, max-age=300");
    return document;
  });

  /** A zero-dependency viewer, so the spec is readable without extra tooling. */
  app.get("/api/v1/docs", async (_request, reply) => {
    reply.type("text/html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DNDWORLDAPP API</title>
  <style>
    body { margin: 0; background: #17181b; color: #d7d8dc;
           font: 14px/1.6 ui-sans-serif, system-ui, "Segoe UI", Roboto, sans-serif; }
    main { max-width: 60rem; margin: 0 auto; padding: 2rem 1.5rem 6rem; }
    h1 { color: #f0f1f4; margin-bottom: .25rem; }
    p.lede { color: #8d9099; margin-top: 0; white-space: pre-wrap; }
    section { border-top: 1px solid #26282d; padding-top: 1.25rem; margin-top: 1.75rem; }
    h2 { color: #9db8ff; font-size: 1rem; text-transform: uppercase;
         letter-spacing: .06em; }
    .op { border: 1px solid #2c2f36; border-radius: 8px; padding: .75rem 1rem;
          margin-bottom: .6rem; background: #1b1d21; }
    .row { display: flex; gap: .6rem; align-items: baseline; flex-wrap: wrap; }
    .m { font: 600 11px ui-monospace, monospace; padding: .15rem .45rem;
         border-radius: 4px; text-transform: uppercase; }
    .get { background: #24405c; color: #9db8ff; }
    .post { background: #2f6b4f; color: #b6e3c9; }
    .patch { background: #5c5023; color: #e8cf8a; }
    .delete { background: #5c2a2a; color: #e0888a; }
    code { font-family: ui-monospace, monospace; color: #e6e7ea; }
    .sum { color: #b6b8bf; }
    .desc { color: #7a7d86; font-size: 13px; margin: .4rem 0 0; }
    a { color: #9db8ff; }
  </style>
</head>
<body><main>
  <h1>DNDWORLDAPP API</h1>
  <p class="lede" id="lede"></p>
  <p><a href="/api/v1/openapi.json">openapi.json</a></p>
  <div id="out"></div>
</main>
<script type="module">
  const spec = await (await fetch("/api/v1/openapi.json")).json();
  document.getElementById("lede").textContent = spec.info.description;
  const byTag = new Map();
  for (const [path, ops] of Object.entries(spec.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      const tag = (op.tags ?? ["other"])[0];
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag).push({ path, method, op });
    }
  }
  const out = document.getElementById("out");
  for (const tag of spec.tags.map((t) => t.name)) {
    const ops = byTag.get(tag);
    if (!ops) continue;
    const s = document.createElement("section");
    const h = document.createElement("h2");
    h.textContent = tag;
    s.append(h);
    for (const { path, method, op } of ops) {
      const d = document.createElement("div");
      d.className = "op";
      const row = document.createElement("div");
      row.className = "row";
      const m = document.createElement("span");
      m.className = "m " + method;
      m.textContent = method;
      const c = document.createElement("code");
      c.textContent = path;
      const sum = document.createElement("span");
      sum.className = "sum";
      sum.textContent = op.summary ?? "";
      row.append(m, c, sum);
      d.append(row);
      if (op.description) {
        const p = document.createElement("p");
        p.className = "desc";
        p.textContent = op.description;
        d.append(p);
      }
      s.append(d);
    }
    out.append(s);
  }
</script>
</body></html>`);
  });
}
