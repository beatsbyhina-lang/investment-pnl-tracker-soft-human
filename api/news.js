const normalizeSymbol = (raw) => {
  const value = String(raw || "").trim();
  if (/^\d{4}$/.test(value)) return `${value}.T`;
  if (/^\d{4}\.jp$/i.test(value)) return `${value.slice(0, 4)}.T`;
  return value.replace(/\.jp$/i, ".T");
};

export default async function handler(req, res) {
  const symbol = normalizeSymbol(req.query.symbol || "");
  const name = String(req.query.name || "").trim();
  const query = symbol || name;

  if (!query) {
    return res.status(400).json({ error: "symbol or name is required" });
  }

  try {
    const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=8&quotesCount=0`;
    const response = await fetch(url, {
      headers: { "user-agent": "Mozilla/5.0" },
    });
    if (!response.ok) throw new Error(`news fetch failed: ${response.status}`);
    const data = await response.json();
    const news = (data.news || []).slice(0, 5).map((item) => ({
      title: item.title,
      publisher: item.publisher,
      link: item.link,
      publishedAt: item.providerPublishTime || null,
    }));

    res.status(200).json({ symbol, news });
  } catch (error) {
    res.status(200).json({ symbol, news: [], error: error.message });
  }
}
