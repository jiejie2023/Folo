export const getAuthTokenFromResult = (result: unknown) => {
  if (!result || typeof result !== "object") {
    return null
  }

  if ("sessionToken" in result && typeof result.sessionToken === "string") {
    return result.sessionToken
  }

  if ("token" in result && typeof result.token === "string") {
    return result.token
  }

  if ("session" in result && result.session && typeof result.session === "object") {
    const { token } = result.session as { token?: unknown }
    if (typeof token === "string") {
      return token
    }
  }

  if (
    "data" in result &&
    result.data &&
    typeof result.data === "object" &&
    ("sessionToken" in result.data || "token" in result.data || "session" in result.data)
  ) {
    const { sessionToken, token, session } = result.data as {
      sessionToken?: unknown
      token?: unknown
      session?: { token?: unknown } | unknown
    }
    if (typeof sessionToken === "string") {
      return sessionToken
    }
    if (typeof token === "string") {
      return token
    }
    if (
      session &&
      typeof session === "object" &&
      "token" in session &&
      typeof session.token === "string"
    ) {
      return session.token
    }
  }

  return null
}
