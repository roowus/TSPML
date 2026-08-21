/**
 * @tspml/portal — put a transform `detail` on a response as `x-tspml-detail`.
 *
 * The transliteration itself lives in `@tspml/shared` because the dev harness needs
 * exactly the same one (it sets the same header through Node's `res.setHeader`, which
 * throws on the same characters). What is portal-specific, and all that remains here,
 * is the `Headers` object and the choice not to emit an empty header.
 *
 * Why this boundary exists at all: an HTTP header value is a ByteString and
 * `Headers.set` throws a TypeError above U+00FF, so a detail containing an em-dash
 * turns a fully successful response into an empty-bodied 500. See the shared module
 * for how that reached production in #98.
 */
import { headerDetail } from '@tspml/shared';

/**
 * Set `x-tspml-detail` to a header-safe rendering of `detail`, or leave the header off
 * entirely when there is nothing to say.
 */
export function setDetailHeader(headers: Headers, detail: string): void {
  const value = headerDetail(detail);
  if (value) headers.set('x-tspml-detail', value);
}
