/**
 * Who the browser acts as, read by the transport before every call. A real app keeps this in its
 * own session store or cookie; the point here is that it is read per call, not once at startup.
 */
let user = "demo-user";

export const currentUser = () => user;

export const setCurrentUser = (next: string) => {
  user = next.trim() || "demo-user";
};
