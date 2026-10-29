/**
 * Photo proof for any promise, not only money ones.
 *
 *   photo → Gemini picks the open promise it proves → the outcome is recorded
 *   the photo is encrypted (secrets.ts) and stored on Walrus through Tatum's
 *   Storage API; the outcome memory carries pic:<proof id>
 *
 * Walrus blobs are public, so the photo is sealed with a key only Anchor holds,
 * per person: only that person (in the mini app) can see it again.
 */
import { createHash, randomBytes } from "node:crypto";
import { config } from "./config.js";
import { uploadStatus, uploadToWalrus } from "./chain/report.js";
import { open, seal } from "./secrets.js";
import { getProof, putProof, type Proof } from "./state.js";

export const proofStorageEnabled = () => !!config.TATUM_API_KEY;

/** Encrypt and store a photo on Walrus. Returns the saved proof (jobId unset if storage is off or failed). */
export async function storeProof(userId: string, promiseId: string, photo: Uint8Array, mediaType: string, description: string): Promise<Proof> {
  const proof: Proof = {
    id: randomBytes(6).toString("base64url").replace(/[-_]/g, "x"),
    userId,
    promiseId,
    mediaType,
    description: description.slice(0, 200),
    sha256: createHash("sha256").update(photo).digest("hex"),
    at: new Date().toISOString(),
  };
  if (proofStorageEnabled()) {
    try {
      const job = await uploadToWalrus(`anchor-proof-${proof.id}.bin`, seal("proof", userId, photo), "application/octet-stream");
      proof.jobId = job.jobId;
    } catch (err) {
      console.error(`[proof] Walrus upload failed for ${userId}:`, err instanceof Error ? err.message : err);
    }
  }
  putProof(proof);
  return proof;
}

/** Download and decrypt a proof photo for its owner. */
export async function readProof(id: string, userId: string): Promise<{ bytes: Buffer; mediaType: string } | undefined> {
  const p = getProof(id);
  if (!p || p.userId !== userId || !p.jobId) return undefined;
  const job = await uploadStatus(p.jobId);
  const url = job.downloadUrlByQuiltPatchId ?? job.downloadUrlByQuiltId;
  if (!url) return undefined; // still certifying on Walrus
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return undefined;
  return { bytes: open("proof", userId, new Uint8Array(await res.arrayBuffer())), mediaType: p.mediaType };
}
