/**
 * The last check before model-written text reaches a person. It doesn't depend on
 * how an attack was worded: whatever got into memory or the prompt, a reply can't
 * carry a link to an unknown site, a Sui address that isn't the person's own, or a
 * card number. Anchor's real links and payment details come from its commands,
 * never from the model.
 */
import { config } from "../config.js";

/** Sites a reply may link to. Anything else is removed. */
const ALLOWED_HOSTS = ["t.me", "telegram.me", "suiscan.xyz", "suivision.xyz", "walruscan.com", "wal.app", "walrus.xyz", "tatum.io"];

const allowed = (host: string) => {
  const h = host.toLowerCase().replace(/^www\./, "");
  const own = (() => {
    try {
      return config.PUBLIC_URL ? new URL(config.PUBLIC_URL).host.toLowerCase() : "";
    } catch {
      return "";
    }
  })();
  return (own && h === own) || ALLOWED_HOSTS.some((a) => h === a || h.endsWith(`.${a}`));
};

// A link: with a scheme, with www., with a path, or a bare domain on a common web TLD.
// Bare "Node.js" or "e.g." are not links.
const LINK = /\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/[^\s)]*)?/gi;
const WEB_TLD = /\.(com|net|org|io|xyz|ly|me|co|app|link|site|online|info|biz|top|click|gg|to|cc|ai|dev|live|shop|vip)$/i;
const ADDRESS = /\b0x[0-9a-f]{20,64}\b/gi;
const CARD = /\b\d{4}[ -]?\d{4}[ -]?\d{4}[ -]?\d{1,7}\b/g;

/** Pure, for tests. `own` are the person's own Sui addresses, which may appear. */
export function guardReply(text: string, own: string[] = []): { text: string; removed: string[] } {
  const removed: string[] = [];
  const mine = new Set(own.map((a) => a.toLowerCase()));
  let out = text.replace(LINK, (match, host: string, path: string | undefined, offset: number, whole: string) => {
    const hasScheme = /^https?:\/\//i.test(match);
    const isLink = hasScheme || /^www\./i.test(host) || !!path || WEB_TLD.test(host);
    // Part of an email address: leave it to the model's own rules.
    if (!isLink || whole[offset - 1] === "@") return match;
    if (allowed(host)) return match;
    removed.push(match);
    return "(link removed)";
  });
  out = out.replace(ADDRESS, (addr) => {
    if (mine.has(addr.toLowerCase())) return addr;
    removed.push(addr);
    return "(address removed)";
  });
  out = out.replace(CARD, (n) => {
    removed.push(n);
    return "(number removed)";
  });
  return { text: out, removed };
}

/** guardReply for the bot: logs what it removed and returns the safe text. */
export function safeReply(text: string, own: string[] = [], where = "reply"): string {
  const { text: out, removed } = guardReply(text, own);
  if (removed.length) console.warn(`[guard] removed ${removed.length} item(s) from a ${where}: ${removed.map((r) => r.slice(0, 24)).join(", ")}`);
  return out;
}
