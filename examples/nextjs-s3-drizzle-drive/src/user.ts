/**
 * Who the browser acts as, kept in a cookie so both ends read one value: the page while it
 * renders this user's files, and the transport as it sends `x-user` with every operation.
 *
 * A real app keeps a session in the same place instead, and validates it on the server.
 */
export const USER_COOKIE = "drive-user";

export const DEFAULT_USER = "ada";

/** Cookie values arrive still encoded from the header, and a hand-written one may not encode. */
export const userFromCookie = (value: string | undefined) => {
  if (!value) return DEFAULT_USER;

  try {
    return decodeURIComponent(value) || DEFAULT_USER;
  } catch {
    return DEFAULT_USER;
  }
};

export const currentUser = () => {
  const entry = document.cookie.split("; ").find((cookie) => cookie.startsWith(`${USER_COOKIE}=`));

  return userFromCookie(entry?.slice(USER_COOKIE.length + 1));
};

export const setCurrentUser = (name: string) => {
  const value = encodeURIComponent(name.trim() || DEFAULT_USER);

  document.cookie = `${USER_COOKIE}=${value}; path=/; max-age=31536000; samesite=lax`;
};
