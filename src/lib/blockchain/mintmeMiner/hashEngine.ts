/** Exact MintMe Lyra2v2-Webchain, not generic Lyra2REv2. */
export const HASH_TEST_INPUT = "0305a0dbd6bf05cf16e503f3a66f78007cbf34144332ecbfc22ed95c8700383b309ace1923a0964b00000008ba939a62724c0d7581fce5761e9d8a0e6a1c3f924fdd8493d1115649c05eb601";
export const HASH_TEST_V2 = "7466248fbd1a450b84078e0e1fa2e0cd4e4f6976a88dcda7bc68d07e8bb0cb89";
export const HASH_TEST_V1 = "7698a3e11c4291516a7fd73c4b838b4dc542f8b1e55767907b9f0ea258349dfa";
export function fromHex(hex: string): Uint8Array {
  if (!/^(?:[0-9a-f]{2})+$/i.test(hex)) throw new Error("Invalid hexadecimal bytes");
  return Uint8Array.from(hex.match(/../g) ?? [], b => parseInt(b, 16));
}
export function toHex(bytes: Uint8Array): string { return Array.from(bytes, b => b.toString(16).padStart(2, "0")).join(""); }
const MAX_TARGET = 0xffffffffffffffffn;
export function targetValue(hex: string): bigint {
  if (!/^(?:[0-9a-f]{8}|[0-9a-f]{16})$/i.test(hex)) return 0n;
  const value = BigInt(`0x${(hex.match(/../g) ?? []).reverse().join("")}`);
  if (!value) return 0n;
  return hex.length === 8 ? MAX_TARGET / (0xffffffffn / value) : value;
}
/** Official miner compares the FIRST eight digest bytes as big endian. */
export function meetsTarget(hash: Uint8Array, target: string): boolean {
  return hash.length === 32 && BigInt(`0x${toHex(hash.subarray(0, 8))}`) < targetValue(target);
}
export function writeNonce(blob: Uint8Array, nonce: bigint): string {
  if (blob.length < 8 || nonce < 0n || nonce > MAX_TARGET) throw new Error("Invalid nonce");
  const hex = nonce.toString(16).padStart(16, "0");
  blob.set(fromHex(hex), blob.length - 8);
  return hex;
}
type EngineExports = WebAssembly.Exports & {
  memory: WebAssembly.Memory;
  _initialize(): void;
  engine_init(): number;
  engine_input(): number;
  engine_output(): number;
  engine_hash(length: number, cost: number): number;
};
export async function createHashEngine(bytes: BufferSource) {
  const { instance } = await WebAssembly.instantiate(bytes, {});
  const api = instance.exports as EngineExports;
  api._initialize();
  if (!api.engine_init()) throw new Error("MintMe engine allocation failed");
  const memory = new Uint8Array(api.memory.buffer);
  const hash = (input: Uint8Array, cost = 1): Uint8Array => {
    if (!input.length || input.length >= 65536) throw new Error("Invalid job size");
    memory.set(input, api.engine_input());
    if (api.engine_hash(input.length, cost) !== 0) throw new Error("MintMe hashing failed");
    return memory.slice(api.engine_output(), api.engine_output() + 32);
  };
  const input = fromHex(HASH_TEST_INPUT);
  if (toHex(hash(input, 4)) !== HASH_TEST_V1 || toHex(hash(input)) !== HASH_TEST_V2) throw new Error("MintMe engine self-test failed");
  return { hash };
}