import { PRICING, MICRO_UNITS_PER_USD } from "../config/pricing.js";

// Money math is done exclusively in integer micro-units (1/1,000,000 USD).
// Floats are never used to store or add money.

const microUnits = (usd) => Math.round(usd * MICRO_UNITS_PER_USD);

export const costOfUsageEvent = (event) => {
  if (event.type === 'api_call') {
    return microUnits(event.quantity * PRICING.api_call_usd);
  }

  if (event.type === 'ai_tokens') {
    const m = event.metadata || {};
    const input = Number(m.input) || 0;
    const cachedInput = Number(m.cached_input) || 0;
    const output = Number(m.output) || 0;
    const reasoning = Number(m.reasoning) || 0;

    // Each category is priced at its own rate first, then summed.
    // Reasoning tokens are billed at the output/reasoning rate, never free.
    const costMicro =
      input * PRICING.tokens.input +
      cachedInput * PRICING.tokens.cached_input +
      output * PRICING.tokens.output +
      reasoning * PRICING.tokens.reasoning;

    return Math.round(costMicro);
  }

  return 0;
};

export const formatUsd = (micro) => {
  const full = (micro / MICRO_UNITS_PER_USD).toFixed(6);
  return full.replace(/0+$/, '').replace(/\.$/, '');
};