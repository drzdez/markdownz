declare module "utif" {
  const UTIF: {
    decode(buffer: ArrayBuffer): Record<string, unknown>[];
    decodeImage(buffer: ArrayBuffer, ifd: Record<string, unknown>): void;
    toRGBA8(ifd: Record<string, unknown>): Uint8Array;
  };
  export default UTIF;
}
