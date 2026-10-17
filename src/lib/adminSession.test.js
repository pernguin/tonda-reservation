import { describe, it, expect, vi } from 'vitest'
import { signInBoth, shouldSignOutRound, installRoundSignOutSync } from './adminSession'

const credentials = { email: 'a@b.com', password: 'pw' }

describe('signInBoth', () => {
  it('stops when Tonda fails and never touches Round', async () => {
    const tondaAuth = { signInWithPassword: vi.fn().mockResolvedValue({ error: { message: 'bad' } }) }
    const roundAuth = { signInWithPassword: vi.fn(), signOut: vi.fn() }
    expect(await signInBoth({ tondaAuth, roundAuth }, credentials)).toEqual({ tondaOk: false, roundOk: false })
    expect(roundAuth.signInWithPassword).not.toHaveBeenCalled()
    expect(roundAuth.signOut).not.toHaveBeenCalled()
  })

  it('reports both ok and does not sign Round out', async () => {
    const tondaAuth = { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) }
    const roundAuth = { signInWithPassword: vi.fn().mockResolvedValue({ error: null }), signOut: vi.fn() }
    expect(await signInBoth({ tondaAuth, roundAuth }, credentials)).toEqual({ tondaOk: true, roundOk: true })
    expect(roundAuth.signInWithPassword).toHaveBeenCalledWith(credentials)
    expect(roundAuth.signOut).not.toHaveBeenCalled()
  })

  it('keeps Tonda ok and signs Round out locally when Round returns an error', async () => {
    const tondaAuth = { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) }
    const roundAuth = {
      signInWithPassword: vi.fn().mockResolvedValue({ error: { message: 'no user' } }),
      signOut: vi.fn().mockResolvedValue({}),
    }
    expect(await signInBoth({ tondaAuth, roundAuth }, credentials)).toEqual({ tondaOk: true, roundOk: false })
    expect(roundAuth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('treats a Round throw as failure', async () => {
    const tondaAuth = { signInWithPassword: vi.fn().mockResolvedValue({ error: null }) }
    const roundAuth = {
      signInWithPassword: vi.fn().mockRejectedValue(new Error('network')),
      signOut: vi.fn().mockResolvedValue({}),
    }
    expect(await signInBoth({ tondaAuth, roundAuth }, credentials)).toEqual({ tondaOk: true, roundOk: false })
    expect(roundAuth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })
})

describe('shouldSignOutRound', () => {
  it('is true only for SIGNED_OUT', () => {
    expect(shouldSignOutRound('SIGNED_OUT')).toBe(true)
    expect(shouldSignOutRound('SIGNED_IN')).toBe(false)
  })
})

describe('installRoundSignOutSync', () => {
  function setup() {
    let handler
    const returned = { data: { subscription: { unsubscribe: vi.fn() } } }
    const tondaAuth = { onAuthStateChange: vi.fn(cb => { handler = cb; return returned }) }
    const roundAuth = { signOut: vi.fn().mockResolvedValue({}) }
    const result = installRoundSignOutSync(tondaAuth, roundAuth)
    return { tondaAuth, roundAuth, result, returned, fire: event => handler(event, null) }
  }

  it('registers one handler and returns the subscription object', () => {
    const { tondaAuth, result, returned } = setup()
    expect(tondaAuth.onAuthStateChange).toHaveBeenCalledTimes(1)
    expect(result).toBe(returned)
  })

  it('signs Round out locally on SIGNED_OUT', () => {
    const { roundAuth, fire } = setup()
    fire('SIGNED_OUT')
    expect(roundAuth.signOut).toHaveBeenCalledWith({ scope: 'local' })
  })

  it('ignores other events', () => {
    const { roundAuth, fire } = setup()
    fire('SIGNED_IN')
    fire('TOKEN_REFRESHED')
    fire('INITIAL_SESSION')
    expect(roundAuth.signOut).not.toHaveBeenCalled()
  })
})
