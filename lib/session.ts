import { cookies } from "next/headers";

export const USERNAME_COOKIE = "riva_username";

export async function getActiveUsername(): Promise<string | null> {
  const store = await cookies();
  const value = store.get(USERNAME_COOKIE)?.value?.trim();
  return value || null;
}

export async function setActiveUsername(username: string): Promise<void> {
  const store = await cookies();
  store.set(USERNAME_COOKIE, username, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function clearActiveUsername(): Promise<void> {
  const store = await cookies();
  store.delete(USERNAME_COOKIE);
}
