"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api-client";

export type CurrentUser = { id: string; name: string; role: string };

/**
 * The signed-in user's id/role for deciding which actions to *show*. It is
 * never the security boundary — RLS and the API routes enforce the same
 * rules again on every write.
 */
export function useCurrentUser(): CurrentUser | null {
  const [user, setUser] = useState<CurrentUser | null>(null);
  useEffect(() => {
    api
      .get<{ user: CurrentUser | null }>("/api/auth/me")
      .then((res) => setUser(res.user))
      .catch(() => setUser(null));
  }, []);
  return user;
}
