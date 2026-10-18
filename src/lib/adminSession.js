// Callers pass the `auth` objects of the Tonda and Round clients; no client imports here.

export async function signInBoth({ tondaAuth, roundAuth }, credentials) {
  const { error: tondaError } = await tondaAuth.signInWithPassword(credentials)
  if (tondaError) return { tondaOk: false, roundOk: false }

  let roundOk
  try {
    const { error: roundError } = await roundAuth.signInWithPassword(credentials)
    roundOk = !roundError
  } catch {
    roundOk = false
  }

  if (!roundOk) {
    // No stale Round session of another user should linger.
    try { await roundAuth.signOut({ scope: 'local' }) } catch { /* nothing to clean up */ }
  }
  return { tondaOk: true, roundOk }
}

export function shouldSignOutRound(event) {
  return event === 'SIGNED_OUT'
}

export function installRoundSignOutSync(tondaAuth, roundAuth) {
  return tondaAuth.onAuthStateChange(event => {
    if (shouldSignOutRound(event)) {
      Promise.resolve(roundAuth.signOut({ scope: 'local' })).catch(() => {})
    }
  })
}
