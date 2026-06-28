# Personal Server — Reference HTTPS Blob Server

The Imagination Network's Personal Server feature accepts any HTTPS endpoint
that implements the tiny contract below. Plaintext NEVER reaches the server —
the client encrypts and signs every chunk before upload, and verifies every
chunk on read.

## REST contract

```
PUT    /chunks/:hash    body: ciphertext (octet-stream)   -> 200 / 201
GET    /chunks/:hash                                       -> 200 ciphertext | 404
HEAD   /chunks/:hash                                       -> 200 | 404
DELETE /chunks/:hash                                       -> 204
GET    /health                                             -> { ok, used, cap, version }
```

`:hash` is the SHA-256 of the ciphertext chunk. The server SHOULD reject any
`PUT` whose body hash does not match the URL hash — this is what keeps a
misbehaving server from rewriting your data.

Auth: `Authorization: Bearer <token>`. The token is generated server-side
and pasted into the client wizard once. Lovable seals it in the in-memory
vault; it is lost on tab close (a relink prompt re-enters it).

## CORS

The browser sends a preflight `OPTIONS` for cross-origin PUT/DELETE. Allow:

```
Access-Control-Allow-Origin: https://your-app-origin
Access-Control-Allow-Methods: GET, PUT, HEAD, DELETE, OPTIONS
Access-Control-Allow-Headers: Authorization, Content-Type
Access-Control-Max-Age: 86400
```

## ~40 LOC Deno reference (Hono + filesystem)

```ts
import { Hono } from "https://deno.land/x/hono/mod.ts";
import { cors } from "https://deno.land/x/hono/middleware.ts";

const TOKEN = Deno.env.get("PSV_TOKEN")!;
const ROOT = "./data";
await Deno.mkdir(ROOT, { recursive: true });

const app = new Hono();
app.use("*", cors({ origin: Deno.env.get("APP_ORIGIN") ?? "*", allowMethods: ["GET","PUT","HEAD","DELETE","OPTIONS"], allowHeaders: ["Authorization","Content-Type"] }));
app.use("*", async (c, next) => {
  if (c.req.header("authorization") !== `Bearer ${TOKEN}`) return c.text("forbidden", 403);
  await next();
});

const path = (h: string) => `${ROOT}/${h.replace(/[^a-z0-9-]/gi, "")}`;

app.put("/chunks/:hash", async (c) => {
  const body = new Uint8Array(await c.req.arrayBuffer());
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", body));
  const hex = Array.from(digest).map((b) => b.toString(16).padStart(2, "0")).join("");
  if (hex !== c.req.param("hash")) return c.text("hash mismatch", 400);
  await Deno.writeFile(path(hex), body);
  return c.text("ok", 201);
});
app.get("/chunks/:hash", async (c) => {
  try { return new Response(await Deno.readFile(path(c.req.param("hash")))); }
  catch { return c.text("not found", 404); }
});
app.on(["HEAD"], "/chunks/:hash", async (c) => {
  try { await Deno.stat(path(c.req.param("hash"))); return c.text("", 200); }
  catch { return c.text("", 404); }
});
app.delete("/chunks/:hash", async (c) => {
  try { await Deno.remove(path(c.req.param("hash"))); } catch {}
  return c.text("", 204);
});
app.get("/health", () => Response.json({ ok: true, used: 0, cap: 1024*1024*1024, version: "1" }));

Deno.serve(app.fetch);
```

Run behind any TLS terminator (Caddy, nginx, Cloudflare Tunnel). Plain
`http://` is rejected by the client except for `localhost`/`127.0.0.1`.

## CORS for S3-compatible buckets

If you use the S3-compatible adapter (R2 / B2 / MinIO / AWS S3), the bucket
must allow CORS from the app origin. Example:

```json
[
  {
    "AllowedOrigins": ["https://your-app-origin"],
    "AllowedMethods": ["GET", "PUT", "HEAD", "DELETE"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 86400
  }
]
```

The bucket can stay private — the client never needs public read.