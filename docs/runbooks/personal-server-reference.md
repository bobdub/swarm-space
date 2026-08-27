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
Access-Control-Allow-Private-Network: true
Access-Control-Max-Age: 86400
```

`Access-Control-Allow-Private-Network: true` is required by Chrome/Edge
whenever an HTTPS page (the app) calls a local address (your desktop).
Without it the request dies as an opaque "browser could not reach ..."
error. Answer `OPTIONS` explicitly:

```ts
app.options("*", (c) => new Response(null, { status: 204, headers: {
  "Access-Control-Allow-Origin": Deno.env.get("APP_ORIGIN") ?? "*",
  "Access-Control-Allow-Methods": "GET, PUT, HEAD, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
  "Access-Control-Allow-Private-Network": "true",
  "Access-Control-Max-Age": "86400",
}}));
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
`http://` is accepted by the client only for addresses that cannot leave
your machine or LAN: `localhost`, `127.0.0.1`, `*.local`, `10.x.x.x`,
`172.16–31.x.x`, `192.168.x.x`. Everything public must be HTTPS.

## Running it on your desktop

1. Pick a port (e.g. 7777) and start the server.
2. Allow that port through the OS firewall.
3. On the same machine, link `http://localhost:7777`. From another device on
   the same network, use the machine's LAN IP, e.g. `http://192.168.1.20:7777`.
4. Send the private-network CORS headers above, or Chrome/Edge will block
   the call before it reaches your server.
5. For access away from home — and for other users to download your shared
   content — put the server behind a public HTTPS address (Cloudflare Tunnel,
   Tailscale Funnel, or a reverse proxy).

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

## Letting other users download your shared project content

Private replicas live under `imagination/<your userId>/chunks/<hash>` and
require your credentials. To let peers download project media directly from
your server, enable **Share project content from this server** in
Settings → Personal Servers. The app then also writes ciphertext under a
credential-free prefix:

```
imagination/public/chunks/<hash>
```

Peers fetch `GET <endpoint>/<bucket>/imagination/public/chunks/<hash>` with
no credentials. Bytes still pass the content-hash + Stage 4 signature gate
before being cached or rendered, so a hostile mirror can only fail the
check — it can never inject content. Only ciphertext is exposed; keys stay
on the owner's device.

### MinIO / S3 anonymous read policy (scoped to the public prefix)

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": { "AWS": ["*"] },
      "Action": ["s3:GetObject"],
      "Resource": ["arn:aws:s3:::swarmspace/imagination/public/*"]
    }
  ]
}
```

Apply with `mc anonymous set-json policy.json myminio/swarmspace`. Everything
outside `imagination/public/*` stays private. The bucket CORS rule above must
also list your app origin, otherwise browsers block the anonymous GET.

A LAN-only address cannot serve users off your network — the mirror must be
reachable over public HTTPS to be advertised to peers.
