/**
 * The filesystem path a URL points at.
 *
 * A stand-in for Node's `fileURLToPath` so the tests stay runtime-independent:
 * `pathname` is percent-encoded, and a Windows drive letter arrives preceded by
 * a slash (`/C:/…`), which has to be stripped for the path to be usable.
 */
export const pathFromUrl = (url: URL): string =>
  decodeURIComponent(url.pathname).replace(/^\/(\w:)/, "$1");
