// Pricing constants — pinned in config, expressed in micro-units (1/1,000,000 of a USD)
// so that no float arithmetic is ever used for money math.
// All prices are per token, in micro-units (µUSD).
//   $0.50 / 1M input tokens   = 0.500000 µUSD = 500000 nano? No:
//   $0.50 per 1M tokens = ($0.50 / 1,000,000) per token = 0.0000005 USD per token
//   = 0.5 micro-units per token.
//
// Pricing rules encoded here:
//   1. cached input tokens are cheaper than fresh input tokens
//   2. reasoning tokens are billed as OUTPUT tokens (never free, never input-priced)
//   3. token categories cannot be simply added together before pricing — each
//      category is multiplied by its own rate first, then summed.

export const PRICING = {
  api_call_usd: 0.001, // $0.001 per API call (1,000 calls = $1.00)

  // Per-token rates in micro-units (µUSD == 1/1,000,000 USD)
  tokens: {
    input: 0.5,            // $0.50 per 1M fresh input tokens
    cached_input: 0.1,     // $0.10 per 1M cached input tokens (5x cheaper)
    output: 1.5,           // $1.50 per 1M output tokens
    reasoning: 6.0,        // $6.00 per 1M reasoning tokens (priced as premium output)
  },
};

// Signing constants per unit
export const MICRO_UNITS_PER_USD = 1_000_000;

export const costsPerTokenUSD = {
  input: PRICING.tokens.input / MICRO_UNITS_PER_USD,
  cached_input: PRICING.tokens.cached_input / MICRO_UNITS_PER_USD,
  output: PRICING.tokens.output / MICRO_UNITS_PER_USD,
  reasoning: PRICING.tokens.reasoning / MICRO_UNITS_PER_USD,
};