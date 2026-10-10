import type { TokenUsage } from '../shared/types.ts'

// Public list prices in USD per million tokens (October 2026). Estimates only: Copilot and some opencode providers log no USD.
// First matching pattern wins, so more specific families go first.
export interface Price { input: number; output: number; cacheRead: number; cacheWrite: number }

const p = (input: number, output: number, cacheRead: number, cacheWrite: number): Price => ({ input, output, cacheRead, cacheWrite })

const TABLE: [RegExp, Price][] = [
  [/^claude-opus/, p(5, 25, 0.5, 6.25)],
  [/^claude-sonnet/, p(3, 15, 0.3, 3.75)],
  [/^claude-haiku/, p(1, 5, 0.1, 1.25)],
  // opencode providers that report no USD: MiniMax standard tier (cache write billed as input),
  // DeepSeek off-peak (deepseek-v4-flash is served by deepseek-flash), and Ling free tiers.
  // glm-5.3, qwen3.6-plus and big-pickle stay unpriced: z.ai publishes no per-token price for
  // coding-plan subscriptions and the others already report real USD in the db.
  [/^minimax-m3$/, p(0.3, 1.2, 0.06, 0.3)],
  [/^deepseek-v4-flash/, p(0.15, 0.6, 0.003, 0.15)],
  [/^ling-.*-free$/, p(0, 0, 0, 0)],
  [/^gpt-4o-mini/, p(0.15, 0.6, 0.075, 0.15)],
  [/^gpt-4o/, p(2.5, 10, 1.25, 2.5)],
  [/^gpt-4\.1/, p(2, 8, 0.5, 2)],
  [/^gpt-[\d.]+-nano/, p(0.05, 0.4, 0.005, 0.05)],
  [/^gpt-[\d.]+-mini/, p(0.25, 2, 0.025, 0.25)],
  [/^gpt-[5-9]/, p(1.25, 10, 0.125, 1.25)],
  [/^o4-mini/, p(1.1, 4.4, 0.275, 1.1)],
  [/^o3/, p(2, 8, 0.5, 2)],
  [/^gemini-.*flash/, p(0.3, 2.5, 0.075, 0.3)],
  [/^gemini-/, p(1.25, 10, 0.31, 1.25)],
]

export function priceOf(model: string): Price | null {
  return TABLE.find(([re]) => re.test(model))?.[1] ?? null
}

export function costOf(model: string, t: TokenUsage): number | null {
  const pr = priceOf(model)
  if (!pr) return null
  return (t.input * pr.input + t.output * pr.output + t.cacheRead * pr.cacheRead + t.cacheCreation * pr.cacheWrite) / 1e6
}
