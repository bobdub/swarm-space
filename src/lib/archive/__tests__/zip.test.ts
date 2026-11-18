import { describe, it, expect } from "vitest";
import { buildZip, readZip, crc32 } from "../zip";

const enc = new TextEncoder();
const concat = (parts: Uint8Array[]) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
};

describe("zip", () => {
  it("round-trips stored entries with UTF-8 names", async () => {
    const { chunks } = buildZip([
      { name: "README.md", data: enc.encode("# hi") },
      { name: "posts/2026-01-01_é.md", data: enc.encode("body") },
    ]);
    const entries = readZip(concat(chunks.map((c) => c.data)));
    expect(entries.map((e) => e.name)).toEqual(["README.md", "posts/2026-01-01_é.md"]);
    expect(new TextDecoder().decode(await entries[1].read())).toBe("body");
  });

  it("reads deflated entries written by other zip tools", async () => {
    const payload = enc.encode("hello hello hello hello hello");
    const deflated = new Uint8Array(await new Response(new Response(payload).body!.pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
    const name = enc.encode("a.txt");
    const local = new Uint8Array(30 + name.length + deflated.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true); lv.setUint16(8, 8, true); lv.setUint32(14, crc32(payload), true);
    lv.setUint32(18, deflated.length, true); lv.setUint32(22, payload.length, true); lv.setUint16(26, name.length, true);
    local.set(name, 30); local.set(deflated, 30 + name.length);
    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true); cv.setUint16(10, 8, true); cv.setUint32(16, crc32(payload), true);
    cv.setUint32(20, deflated.length, true); cv.setUint32(24, payload.length, true); cv.setUint16(28, name.length, true);
    central.set(name, 46);
    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true); ev.setUint16(8, 1, true); ev.setUint16(10, 1, true);
    ev.setUint32(12, central.length, true); ev.setUint32(16, local.length, true);
    const [entry] = readZip(concat([local, central, eocd]));
    expect(new TextDecoder().decode(await entry.read())).toBe("hello hello hello hello hello");
  });

  it("rejects non-zip bytes and corrupt data", async () => {
    expect(() => readZip(enc.encode("not a zip at all, definitely not"))).toThrow();
    const { chunks } = buildZip([{ name: "x", data: enc.encode("abc") }]);
    const bytes = concat(chunks.map((c) => c.data));
    bytes[31] ^= 0xff; // flip a data byte
    await expect(readZip(bytes)[0].read()).rejects.toThrow(/Checksum/);
  });
});
