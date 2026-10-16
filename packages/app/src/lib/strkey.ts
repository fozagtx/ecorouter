/**
 * Minimal Stellar StrKey encode/validate for G… (account) and C… (contract)
 * addresses without loading the full Stellar SDK.
 */
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const VERSION = { account: 6 << 3, contract: 2 << 3 } as const;

function crc16xmodem(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc ^= b << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc;
}

function base32(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

function unbase32(s: string): Uint8Array | null {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const c of s) {
    const i = ALPHABET.indexOf(c);
    if (i < 0) return null;
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Uint8Array.from(out);
}

export function encodeStrKey(kind: keyof typeof VERSION, payload: Uint8Array): string {
  const body = new Uint8Array(1 + payload.length);
  body[0] = VERSION[kind];
  body.set(payload, 1);
  const crc = crc16xmodem(body);
  const full = new Uint8Array(body.length + 2);
  full.set(body);
  full[body.length] = crc & 0xff;
  full[body.length + 1] = crc >> 8;
  return base32(full);
}

export function isValidStrKey(kind: keyof typeof VERSION, s: string): boolean {
  if (s.length !== 56) return false;
  const raw = unbase32(s);
  if (!raw || raw.length !== 35 || raw[0] !== VERSION[kind]) return false;
  const crc = crc16xmodem(raw.subarray(0, 33));
  return raw[33] === (crc & 0xff) && raw[34] === crc >> 8 && encodeStrKey(kind, raw.subarray(1, 33)) === s;
}
