export const CURRENCIES = { USD: "US$", JMD: "J$" };
export const DEFAULT_RATE = 157;

// Rates are always "Jamaican dollars per 1 US dollar" on the day of the transaction.
export function convert(amount, from, to, rate) {
  const value = Number(amount) || 0;
  if (from === to) return value;
  const fx = Number(rate);
  if (!(fx > 0)) return value;
  return from === "USD" ? value * fx : value / fx;
}

export function formatMoney(value, currency, exact = false) {
  const number = Number(value) || 0;
  const digits = exact && !Number.isInteger(Math.round(number * 100) / 100) ? 2 : 0;
  const text = Math.abs(number).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: exact ? 2 : 0 });
  return `${number < 0 ? "−" : ""}${CURRENCIES[currency] || `${currency} `}${text}`;
}
