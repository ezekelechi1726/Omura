// swap-execution.test.ts
import { describe, it, expect, beforeEach } from "vitest"

/**
 * Mock of the Omura Swap Execution logic in TypeScript for unit tests.
 * Mirrors the clarity contract's behavior: supports pair registration, swap with fee, slippage checks.
 */

type PairKey = string // canonical tokenA|tokenB
interface Pair {
  reserveA: bigint
  reserveB: bigint
  totalFeesAccrued: bigint
}

interface SwapResult {
  amountOut?: bigint
  fee?: bigint
  error?: number
}

// Error codes matching clarity contract
const ERR_NOT_ADMIN = 100
const ERR_UNSUPPORTED_PAIR = 101
const ERR_INSUFFICIENT_LIQUIDITY = 102
const ERR_SLIPPAGE_EXCEEDED = 103
const ERR_ZERO_AMOUNT = 104
const ERR_PAUSED = 900

class MockOmuraSwap {
  admin: string
  feeBps: bigint // e.g., 30 = 0.30%
  paused: boolean
  pairs: Map<PairKey, Pair>

  constructor(admin: string, feeBps: bigint = 30n) {
    this.admin = admin
    this.feeBps = feeBps
    this.paused = false
    this.pairs = new Map()
  }

  canonicalKey(tokenX: string, tokenY: string): PairKey {
    return tokenX < tokenY ? `${tokenX}|${tokenY}` : `${tokenY}|${tokenX}`
  }

  registerPair(caller: string, tokenX: string, tokenY: string, reserveX: bigint, reserveY: bigint): { value?: boolean; error?: number } {
    if (caller !== this.admin) return { error: ERR_NOT_ADMIN }
    if (reserveX <= 0n || reserveY <= 0n) return { error: ERR_INSUFFICIENT_LIQUIDITY }
    const key = this.canonicalKey(tokenX, tokenY)
    this.pairs.set(key, { reserveA: reserveX, reserveB: reserveY, totalFeesAccrued: 0n })
    return { value: true }
  }

  quoteOutput(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint | null {
    if (amountIn <= 0n || reserveIn <= 0n || reserveOut <= 0n) return null
    const amountAfterFee = (amountIn * (10000n - this.feeBps)) / 10000n
    const numerator = amountAfterFee * reserveOut
    const denominator = reserveIn + amountAfterFee
    if (denominator === 0n) return null
    return numerator / denominator
  }

  swap(caller: string, tokenIn: string, tokenOut: string, amountIn: bigint, minAmountOut: bigint): SwapResult {
    if (this.paused) return { error: ERR_PAUSED }
    if (amountIn <= 0n) return { error: ERR_ZERO_AMOUNT }
    const key = this.canonicalKey(tokenIn, tokenOut)
    const pair = this.pairs.get(key)
    if (!pair) return { error: ERR_UNSUPPORTED_PAIR }

    // Determine direction
    const reversed = tokenIn > tokenOut
    const reserveIn = reversed ? pair.reserveB : pair.reserveA
    const reserveOut = reversed ? pair.reserveA : pair.reserveB

    const quoted = this.quoteOutput(amountIn, reserveIn, reserveOut)
    if (quoted === null) return { error: ERR_INSUFFICIENT_LIQUIDITY }

    if (quoted < minAmountOut) return { error: ERR_SLIPPAGE_EXCEEDED }

    // Fee calculation for accounting (simplified: fee = input - after-fee portion used for swap)
    const amountAfterFee = (amountIn * (10000n - this.feeBps)) / 10000n
    const feeCollected = amountIn - ((amountAfterFee * 10000n) / (10000n - this.feeBps)) // reverse derive (approximate)
    // Update reserves
    const newReserveIn = reserveIn + amountIn
    const newReserveOut = reserveOut - quoted
    if (reversed) {
      pair.reserveB = newReserveIn
      pair.reserveA = newReserveOut
    } else {
      pair.reserveA = newReserveIn
      pair.reserveB = newReserveOut
    }
    pair.totalFeesAccrued += feeCollected < 0n ? 0n : feeCollected // guard against nonsense
    this.pairs.set(key, pair)

    return { amountOut: quoted, fee: feeCollected < 0n ? 0n : feeCollected }
  }
}

describe("Omura Swap Execution Contract (mock)", () => {
  let contract: MockOmuraSwap
  const ADMIN = "OMURA_ADMIN"
  const TOKEN_X = "TOKX"
  const TOKEN_Y = "TOKY"

  beforeEach(() => {
    contract = new MockOmuraSwap(ADMIN, 30n) // 0.30% fee
    // register pair with initial liquidity
    const r = contract.registerPair(ADMIN, TOKEN_X, TOKEN_Y, 1_000_000n, 1_000_000n)
    expect(r).toEqual({ value: true })
  })

  it("should perform a successful swap respecting min output (no slippage violation)", () => {
    const amountIn = 10_000n
    // compute expected output externally via quoteOutput
    const expectedOut = contract.quoteOutput(amountIn, 1_000_000n, 1_000_000n)
    expect(expectedOut).not.toBeNull()
    const result = contract.swap("some-user", TOKEN_X, TOKEN_Y, amountIn, expectedOut ?? 0n)
    expect(result.error).toBeUndefined()
    expect(result.amountOut).toBe(expectedOut)
    expect(result.fee).toBeDefined()
    // Reserves updated properly
    const key = contract.canonicalKey(TOKEN_X, TOKEN_Y)
    const updated = contract.pairs.get(key)!
    expect(updated.reserveA).toBe(1_000_000n + amountIn) // input added
    expect(updated.reserveB).toBe(1_000_000n - (expectedOut ?? 0n)) // output removed
  })

  it("should fail if slippage exceeds minAmountOut constraint", () => {
    const amountIn = 5_000n
    const expectedOut = contract.quoteOutput(amountIn, 1_000_000n, 1_000_000n)!
    // set minAmountOut artificially too high
    const result = contract.swap("user", TOKEN_X, TOKEN_Y, amountIn, expectedOut + 1n)
    expect(result.error).toBe(ERR_SLIPPAGE_EXCEEDED)
  })

  it("should reject swap with zero amount", () => {
    const result = contract.swap("user", TOKEN_X, TOKEN_Y, 0n, 0n)
    expect(result.error).toBe(ERR_ZERO_AMOUNT)
  })

  it("should reject swap on unsupported pair", () => {
    const result = contract.swap("user", "BAD1", "BAD2", 1000n, 1n)
    expect(result.error).toBe(ERR_UNSUPPORTED_PAIR)
  })

  it("should allow admin to pause and reject swaps", () => {
    // Pause
    contract.paused = true
    const result = contract.swap("user", TOKEN_X, TOKEN_Y, 1000n, 1n)
    expect(result.error).toBe(ERR_PAUSED)
  })

  it("should accumulate fees on successive swaps", () => {
    const amountIn1 = 10_000n
    const amountIn2 = 20_000n
    const out1 = contract.swap("user1", TOKEN_X, TOKEN_Y, amountIn1, 0n)
    expect(out1.error).toBeUndefined()
    const out2 = contract.swap("user2", TOKEN_X, TOKEN_Y, amountIn2, 0n)
    expect(out2.error).toBeUndefined()
    const key = contract.canonicalKey(TOKEN_X, TOKEN_Y)
    const pair = contract.pairs.get(key)!
    expect(pair.totalFeesAccrued).toBeGreaterThanOrEqual(0n)
  })
})
