const normalizeSymbol = (raw) => {
  const value = String(raw || "").trim().toUpperCase();
  if (!value) return "";
  if (/^(?=.*\d)[0-9A-Z]{4,5}$/.test(value)) return `${value}.T`;
  if (/^(?=.*\d)[0-9A-Z]{4,5}\.jp$/i.test(value)) return `${value.replace(/\.jp$/i, "")}.T`;
  return value.replace(/\.jp$/i, ".T");
};

const displaySymbol = (raw) => {
  const value = String(raw || "").trim().toUpperCase();
  if (/^(?=.*\d)[0-9A-Z]{4,5}$/.test(value)) return `${value}.jp`;
  if (/^(?=.*\d)[0-9A-Z]{4,5}\.T$/i.test(value)) return `${value.replace(/\.T$/i, "")}.jp`;
  return value;
};

export default async function handler(req, res) {
  const symbols = String(req.query.symbols || req.query.symbol || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!symbols.length) {
    return res.status(400).json({ error: "symbols is required" });
  }

  const results = await Promise.all(
    symbols.map(async (input) => {
      const yahooSymbol = normalizeSymbol(input);
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?range=1d&interval=1d`;

      try {
        const response = await fetch(url, {
          headers: { "user-agent": "Mozilla/5.0" },
        });
        if (!response.ok) throw new Error(`quote fetch failed: ${response.status}`);
        const data = await response.json();
        const result = data?.chart?.result?.[0];
        const meta = result?.meta || {};
        const price = meta.regularMarketPrice ?? meta.previousClose ?? null;

        return {
          input,
          symbol: displaySymbol(input),
          yahooSymbol,
          name: meta.shortName || meta.longName || meta.symbol || displaySymbol(input),
          price,
          currency: meta.currency || "JPY",
          marketTime: meta.regularMarketTime || null,
          source: "Yahoo Finance",
        };
      } catch (error) {
        return {
          input,
          symbol: displaySymbol(input),
          yahooSymbol,
          price: null,
          error: error.message,
        };
      }
    })
  );

  res.status(200).json({ quotes: results });
}
