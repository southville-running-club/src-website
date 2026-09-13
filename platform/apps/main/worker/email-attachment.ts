/**
 * Reading an inline image out of the Worker's own assets, ready to attach.
 *
 * **Extracted from `email.ts` when the ticket confirmation gained a banner of its own**
 * (ADR-041). Two callers needing the same thing is the point at which one copy becomes the
 * right answer: the alternative was `store-outbox.ts` importing from the race's email module,
 * or a second `base64` loop with its own reason to be written the way it is.
 *
 * Nothing here knows which email it is serving. The caller names the file, the MIME type and
 * the content id; this module reads the bytes and never throws.
 */

/** One inline image, shaped for Resend's `attachments` field. */
export interface BannerAttachment {
  filename: string;
  /** Base64, no `data:` prefix — Resend's own field, not a browser `<img>` `src`. */
  content: string;
  contentType: string;
  contentId: string;
}

/** Which file to read, and what the skin's `cid:` reference calls it. */
export interface BannerSpec {
  filename: string;
  contentType: string;
  contentId: string;
}

/**
 * Read a banner from the static-assets binding and return it ready to attach.
 *
 * **Never throws, and `null` on every failure**, because a missing banner must degrade to a
 * card with no banner row rather than block a confirmation somebody is waiting for.
 *
 * **Fetched from `ASSETS`, not a remote URL.** ADR-026 closed the open-tracker question this
 * way: the banner ships as part of the message rather than as an `https://` reference, so no
 * mail client ever makes an HTTP request to render it, and there is nothing for that request to
 * disclose. The skin references it as `cid:<contentId>`, so the two have to agree — which is
 * why the id travels in the same object as the filename rather than being restated at the send.
 *
 * The host in the request URL is never resolved — `ASSETS.fetch()` serves the Worker's own
 * bundled files by path alone, the same binding `worker/index.ts`'s `nnPage()` reads through
 * for an internal request with nothing to build a real origin from.
 */
export async function fetchBannerAttachment(
  assets: Fetcher,
  spec: BannerSpec,
): Promise<BannerAttachment | null> {
  let response: Response;

  try {
    response = await assets.fetch(
      new Request(`https://assets.internal/${spec.filename}`),
    );
  } catch {
    return null;
  }

  if (!response.ok) {
    return null;
  }

  let bytes: ArrayBuffer;

  try {
    bytes = await response.arrayBuffer();
  } catch {
    return null;
  }

  return {
    filename: spec.filename,
    content: base64(bytes),
    contentType: spec.contentType,
    contentId: spec.contentId,
  };
}

/**
 * A byte-at-a-time loop rather than `String.fromCharCode(...bytes)` — the spread form
 * overflows the call stack on a buffer this size in some engines. `btoa` is a Web standard
 * available without `nodejs_compat`'s `Buffer`, which nothing in `worker/` has needed and
 * which `email.ts`'s own header argues against reaching for a dependency to avoid.
 */
function base64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';

  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary);
}
