/**
 * Minimal, dependency-free RSS 2.0 / Atom item extractor.
 *
 * Deliberately NOT a general XML/DOM parser: it never resolves a DOCTYPE or
 * a custom ENTITY declaration (documents containing either are refused
 * outright), and the only entities it decodes are the five predefined XML
 * entities plus numeric character references. That is what makes this safe
 * against XXE and entity-expansion ("billion laughs") attacks -- there is no
 * general entity-resolution machinery here to abuse in the first place.
 */

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FeedParseError";
  }
}

export interface ParsedFeedItem {
  /** guid (RSS) or id (Atom); falls back to the link when absent. */
  id: string;
  title: string;
  link: string;
  /** ISO-8601, or undefined when the feed omitted/mangled the date. */
  publishedAt?: string;
  description?: string;
}

const MAX_XML_LENGTH = 5_000_000;
const MAX_ITEMS = 300;

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, entity: string) => {
    if (entity.startsWith("#")) {
      const isHex = entity[1] === "x" || entity[1] === "X";
      const codePoint = parseInt(entity.slice(isHex ? 2 : 1), isHex ? 16 : 10);
      if (!Number.isFinite(codePoint) || codePoint < 0 || codePoint > 0x10ffff) {
        return whole;
      }
      try {
        return String.fromCodePoint(codePoint);
      } catch {
        return whole;
      }
    }
    // Unknown named entities are left as-is rather than resolved -- there is
    // no DTD lookup here, by design.
    return NAMED_ENTITIES[entity] ?? whole;
  });
}

function stripCdata(text: string): string {
  const match = /^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/.exec(text);
  return match ? (match[1] ?? "") : text;
}

function extractTagText(block: string, tag: string): string | undefined {
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = re.exec(block);
  if (!match) return undefined;
  const raw = stripCdata((match[1] ?? "").trim());
  const decoded = decodeEntities(raw).trim();
  return decoded.length > 0 ? decoded : undefined;
}

function extractLinkHref(block: string): string | undefined {
  const re = /<link\b[^>]*\bhref=["']([^"']*)["'][^>]*\/?>/i;
  const match = re.exec(block);
  return match ? decodeEntities(match[1] ?? "").trim() || undefined : undefined;
}

function normalizeDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const ms = Date.parse(raw);
  if (!Number.isFinite(ms)) return undefined;
  return new Date(ms).toISOString();
}

/**
 * Parse an RSS 2.0 or Atom document into normalized item records. Never
 * throws for a malformed individual item -- only for a document-level
 * problem (oversized input, or unsafe DOCTYPE/ENTITY content). Items missing
 * a title, link, or id are dropped rather than returned half-populated.
 */
export function parseFeed(xml: string): ParsedFeedItem[] {
  if (xml.length > MAX_XML_LENGTH) {
    throw new FeedParseError(
      `feed exceeds the maximum accepted size of ${MAX_XML_LENGTH} characters`,
    );
  }
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new FeedParseError(
      "refusing to parse a feed containing a DOCTYPE or ENTITY declaration",
    );
  }
  if (xml.trim().length === 0) return [];

  const isAtom = /<entry\b/i.test(xml) && !/<item\b/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";
  const itemRe = new RegExp(`<${itemTag}\\b[^>]*>([\\s\\S]*?)<\\/${itemTag}>`, "gi");

  const items: ParsedFeedItem[] = [];
  let match: RegExpExecArray | null;
  while (items.length < MAX_ITEMS && (match = itemRe.exec(xml)) !== null) {
    const block = match[1] ?? "";

    const title = extractTagText(block, "title");
    const link = isAtom
      ? (extractLinkHref(block) ?? extractTagText(block, "link"))
      : extractTagText(block, "link");
    const id = extractTagText(block, isAtom ? "id" : "guid") ?? link;
    const rawDate = isAtom
      ? (extractTagText(block, "published") ?? extractTagText(block, "updated"))
      : extractTagText(block, "pubDate");
    const description =
      extractTagText(block, isAtom ? "summary" : "description") ??
      extractTagText(block, "content");

    if (!title || !link || !id) continue;

    const item: ParsedFeedItem = { id, title, link };
    const publishedAt = normalizeDate(rawDate);
    if (publishedAt !== undefined) item.publishedAt = publishedAt;
    if (description !== undefined) item.description = description;
    items.push(item);
  }
  return items;
}
