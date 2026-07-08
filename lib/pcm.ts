export const OPENROUTER_PCM_SAMPLE_RATE = 24000;
export const OPENROUTER_PCM_CHANNELS = 1;

export function int16PcmToFloat32(pcm: Uint8Array): Float32Array {
  const sampleCount = Math.floor(pcm.byteLength / 2);
  const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const floats = new Float32Array(sampleCount);

  for (let index = 0; index < sampleCount; index += 1) {
    floats[index] = view.getInt16(index * 2, true) / 32768;
  }

  return floats;
}

export function splitPcmBytes(
  remainder: Uint8Array,
  incoming: Uint8Array,
): { complete: Uint8Array; remainder: Uint8Array } {
  const combined =
    remainder.length === 0
      ? incoming
      : incoming.length === 0
        ? remainder
        : concatBytes(remainder, incoming);
  const completeByteLength = combined.length - (combined.length % 2);

  if (completeByteLength === 0) {
    return { complete: new Uint8Array(0), remainder: combined };
  }

  return {
    complete: combined.subarray(0, completeByteLength),
    remainder: combined.subarray(completeByteLength),
  };
}

export function concatBytes(first: Uint8Array, second: Uint8Array): Uint8Array {
  const merged = new Uint8Array(first.length + second.length);
  merged.set(first, 0);
  merged.set(second, first.length);
  return merged;
}
