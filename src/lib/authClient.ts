import { createAuthClient } from "better-auth/react";

// Same-origin client; baseURL intentionally omitted.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
