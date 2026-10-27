/**
 * Anchor's own Sui identity. One Ed25519 key:
 *  - signs weekly follow-through reports (anyone can verify them with standard Sui tools),
 *  - is the payTo address for stakes and agent payments (x402),
 *  - pays stakes back, or on to the person's chosen recipient, after the deadline.
 */
import { decodeSuiPrivateKey } from "@mysten/sui/cryptography";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { config } from "../config.js";

function load(): Ed25519Keypair | undefined {
  const key = config.ANCHOR_SUI_PRIVATE_KEY.trim();
  if (!key) return undefined;
  try {
    const { scheme, secretKey } = decodeSuiPrivateKey(key);
    if (scheme !== "ED25519") throw new Error(`expected an ED25519 key, got ${scheme}`);
    return Ed25519Keypair.fromSecretKey(secretKey);
  } catch (err) {
    console.error(`[sui] ANCHOR_SUI_PRIVATE_KEY is invalid, reports and stakes are off: ${err instanceof Error ? err.message : err}`);
    return undefined;
  }
}

export const anchorKey = load();
export const anchorAddress = anchorKey?.toSuiAddress();

if (anchorAddress) console.log(`[sui] Anchor's address: ${anchorAddress}`);
