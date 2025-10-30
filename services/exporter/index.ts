import { assembleExportArchive } from "../../utils/exporter";
import type { ExporterRequestPayload } from "../../src/types/exporter";

function jsonResponse(body: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
}

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type",
        },
      });
    }

    if (request.method !== "POST") {
      return new Response("Not found", { status: 404 });
    }

    try {
      const payload = (await request.json()) as ExporterRequestPayload & { filename?: string };
      const archive = await assembleExportArchive(payload);
      const headers = new Headers({
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${archive.filename}"`,
        "X-Export-Post-Count": String(archive.metadata.postCount),
        "X-Export-Comment-Count": String(archive.metadata.commentCount),
        "X-Export-Media-Count": String(archive.metadata.mediaCount),
        "X-Export-Uncompressed-Bytes": String(archive.metadata.uncompressedBytes),
        "X-Export-Archive-Bytes": String(archive.metadata.archiveBytes),
      });
      headers.set("Access-Control-Expose-Headers", "Content-Disposition,X-Export-Post-Count,X-Export-Comment-Count,X-Export-Media-Count,X-Export-Uncompressed-Bytes,X-Export-Archive-Bytes");
      headers.set("Access-Control-Allow-Origin", "*");
      return new Response(archive.stream, {
        status: 200,
        headers,
      });
    } catch (error) {
      console.error("[exporter] Failed to process export request", error);
      return jsonResponse({ error: "Failed to build export archive" }, { status: 500 });
    }
  },
};
