const displaySymbol = (raw) => {
  const value = String(raw || "").trim().toUpperCase();
  if (/^(?=.*\d)[0-9A-Z]{4,5}\.T$/i.test(value)) return `${value.replace(/\.T$/i, "")}.jp`;
  if (/^(?=.*\d)[0-9A-Z]{4,5}$/.test(value)) return `${value}.jp`;
  return value.replace(/\.T$/i, ".jp");
};

const searchQueries = (query) => {
  const normalized = query.trim();
  const upper = normalized.toUpperCase();
  const queries = [normalized];

  if (/^(?=.*\d)[0-9A-Z]{4,5}$/i.test(upper)) {
    queries.unshift(`${upper}.T`);
  }

  return [...new Set(queries)];
};

export default async function handler(req, res) {
  const query = String(req.query.q || req.query.query || "").trim();

  if (!query) {
    return res.status(400).json({ error: "q is required" });
  }

  try {
    const responses = await Promise.all(
      searchQueries(query).map(async (searchQuery) => {
        const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&quotesCount=10&newsCount=0`;
        const response = await fetch(url, {
          headers: { "user-agent": "Mozilla/5.0" },
        });
        if (!response.ok) throw new Error(`search fetch failed: ${response.status}`);
        return response.json();
      })
    );

    const seen = new Set();
    const results = responses
      .flatMap((data) => data.quotes || [])
      .filter((quote) => quote.symbol && (quote.quoteType === "EQUITY" || quote.quoteType === "ETF" || quote.typeDisp))
      .map((quote) => ({
        symbol: displaySymbol(quote.symbol),
        yahooSymbol: quote.symbol,
        name: quote.shortname || quote.longname || quote.symbol,
        exchange: quote.exchDisp || quote.exchange || "",
        type: quote.typeDisp || quote.quoteType || "",
      }))
      .filter((quote) => {
        const key = quote.symbol.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .slice(0, 8);

    res.status(200).json({ query, results });
  } catch (error) {
    res.status(200).json({ query, results: [], error: error.message });
  }
}
