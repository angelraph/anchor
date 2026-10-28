/**
 * Signed follow-through reports, published to Walrus through Tatum's Storage API.
 *
 * A report is a small JSON document (counts, follow-through %, the on-chain
 * proofs behind verified promises) signed by Anchor's Sui key as a personal
 * message. Anyone can check it: fetch the file from any Walrus aggregator and
 * verify the signature with standard Sui tools (or at /report/<jobId>).
 *
 * Walrus blobs are public, so promise texts are left out unless the person
 * asks for a public report (/report public); otherwise each promise appears
 * only as a SHA-256 hash they can later reveal.
 */
import { createHash } from "node:crypto";
import { verifyPersonalMessageSignature } from "@mysten/sui/verify";
import { config } from "../config.js";
import { addDays, todayIn } from "../dates.js";
import { recall, recallCommitments } from "../memory/recall.js";
import { isOpen } from "../memory/types.js";
import { weekStats } from "../reminders.js";
import { bump, getUser, tzOf, updateUser } from "../state.js";
import { anchorAddress, anchorKey } from "./signer.js";
import { sui } from "./sui.js";

export interface FollowThroughReport {
  v: 1;
  type: "anchor.follow-through.weekly";
  issuer: string;
  subject: { id: string; wallet?: string };
  week: { from: string; to: string };
  kept: number;
  partial: number;
  missed: number;
  open: number;
  followThroughPct: number | null;
  /** Promises closed this week. `promise` is the text (public reports) or its SHA-256. */
  promises: Array<{ promise: string; status: string; verifiedOnSui: boolean; proof?: string }>;
  learned: { patterns: number; wins: number };
  issuedAt: string;
}

export interface SignedReport {
  report: FollowThroughReport;
  /** Sui personal-message signature over the canonical JSON of `report`. */
  signature: string;
}

export const reportsEnabled = () => !!anchorKey && !!config.TATUM_API_KEY;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
export const anonId = (userId: string | number) => `anchor-${sha(String(userId)).slice(0, 12)}`;

/** Stable key order, so the signed bytes are reproducible by anyone. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .filter((k) => (v as Record<string, unknown>)[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export async function buildReport(userId: string | number, opts: { publicTexts: boolean }): Promise<FollowThroughReport> {
  const today = todayIn(tzOf(userId));
  const states = await recallCommitments(userId);
  const w = weekStats(states, today);
  const learned = await recall(userId, "patterns and wins: what derails the user and what helps them follow through", { limit: 20 }).catch(() => []);
  const closed = [...w.kept, ...w.partial, ...w.broken];
  const done = closed.length;
  const user = getUser(userId);
  return {
    v: 1,
    type: "anchor.follow-through.weekly",
    issuer: anchorAddress ?? "",
    subject: { id: anonId(userId), wallet: user?.wallet?.verified ? user.wallet.address : undefined },
    week: { from: addDays(today, -6), to: today },
    kept: w.kept.length,
    partial: w.partial.length,
    missed: w.broken.length,
    open: states.filter(isOpen).length,
    followThroughPct: done ? Math.round(((w.kept.length + w.partial.length * 0.5) / done) * 100) : null,
    promises: closed.map((s) => ({
      promise: opts.publicTexts ? s.commitment.text : sha(s.commitment.text),
      status: s.outcome!.status ?? "kept",
      verifiedOnSui: !!s.outcome!.proof,
      proof: s.outcome!.proof,
    })),
    learned: { patterns: learned.filter((m) => m.kind === "pattern").length, wins: learned.filter((m) => m.kind === "win").length },
    issuedAt: new Date().toISOString(),
  };
}

export async function signReport(report: FollowThroughReport): Promise<SignedReport> {
  if (!anchorKey) throw new Error("ANCHOR_SUI_PRIVATE_KEY is not set");
  const { signature } = await anchorKey.signPersonalMessage(new TextEncoder().encode(canonical(report)));
  return { report, signature };
}

/** Check a signed report: the signature must be by the issuer it names. */
export async function verifyReport(signed: SignedReport): Promise<{ ok: boolean; signer?: string; reason?: string }> {
  try {
    const pk = await verifyPersonalMessageSignature(new TextEncoder().encode(canonical(signed.report)), signed.signature, {
      client: sui,
      address: signed.report.issuer,
    });
    return { ok: true, signer: pk.toSuiAddress() };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}

export interface UploadJob {
  jobId: string;
  status: string;
  blobId?: string;
  quiltPatchId?: string;
  downloadUrlByQuiltPatchId?: string;
  downloadUrlByQuiltId?: string;
  suiObjectId?: string;
  storageEvents?: Array<{ type: string; txDigest: string; at: number }>;
  errorMessage?: string;
}

async function tatum<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${config.TATUM_API_URL}${path}`, {
    ...init,
    headers: { "x-api-key": config.TATUM_API_KEY, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw new Error(`Tatum ${path} → HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

/** Upload a file to Walrus mainnet through Tatum (POST /v4/data/storage/upload). */
export async function uploadToWalrus(filename: string, body: string, mimeType = "application/json"): Promise<UploadJob> {
  const form = new FormData();
  form.append("file", new Blob([body], { type: mimeType }), filename);
  return tatum<UploadJob>("/v4/data/storage/upload", { method: "POST", body: form });
}

export async function uploadStatus(jobId: string): Promise<UploadJob> {
  if (!/^[\w-]+$/.test(jobId)) throw new Error("bad job id");
  return tatum<UploadJob>(`/v4/data/storage/upload/${jobId}`);
}

/** Fetch a certified report back from a Walrus aggregator. */
export async function fetchReport(job: UploadJob): Promise<SignedReport | undefined> {
  const url = job.downloadUrlByQuiltPatchId ?? job.downloadUrlByQuiltId;
  if (!url) return undefined;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  if (!res.ok) return undefined;
  return (await res.json()) as SignedReport;
}

export function reportPageUrl(jobId: string): string {
  return `${config.PUBLIC_URL.replace(/\/$/, "")}/report/${jobId}`;
}

/** Build, sign, publish to Walrus via Tatum, and remember it. */
export async function publishReport(userId: string | number, opts: { publicTexts: boolean }): Promise<{ signed: SignedReport; job: UploadJob }> {
  const signed = await signReport(await buildReport(userId, opts));
  const name = `anchor-report-${signed.report.subject.id}-${signed.report.week.to}.json`;
  const job = await uploadToWalrus(name, JSON.stringify(signed, null, 2));
  updateUser(userId, (u) => {
    u.lastReport = { blobId: job.jobId, at: new Date().toISOString(), week: signed.report.week.to };
  });
  bump((m) => m.reportsPublished++);
  const { storeMemories } = await import("../memory/write.js");
  const { enqueue } = await import("../bot/conversation.js");
  const r = signed.report;
  void enqueue(`write:${userId}`, () =>
    storeMemories(userId, [
      {
        kind: "report",
        date: todayIn(tzOf(userId)),
        proof: job.jobId,
        text: `Published a signed weekly report to Walrus for ${r.week.from} to ${r.week.to}: kept ${r.kept}, partly ${r.partial}, missed ${r.missed}${r.followThroughPct !== null ? `, follow-through ${r.followThroughPct}%` : ""}`,
      },
    ]),
  ).catch((err) => console.error("[report] memory write failed:", err));
  return { signed, job };
}
