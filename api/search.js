const displaySymbol = (raw) => {
  const value = String(raw || "").trim().toUpperCase();
  if (/^(?=.*\d)[0-9A-Z]{4,5}\.T$/i.test(value)) return `${value.replace(/\.T$/i, "")}.jp`;
  if (/^(?=.*\d)[0-9A-Z]{4,5}\.JP$/i.test(value)) return `${value.replace(/\.JP$/i, "")}.jp`;
  if (/^(?=.*\d)[0-9A-Z]{4,5}$/.test(value)) return `${value}.jp`;
  return value.replace(/\.T$/i, ".jp");
};

const htmlDecode = (value) =>
  String(value || "")
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, num) => String.fromCodePoint(Number(num)))
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");

const textFromHtml = (value) =>
  htmlDecode(value)
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .trim();

const searchQueries = (query) => {
  const normalized = query.trim();
  const upper = normalized.toUpperCase();
  const queries = [normalized];

  if (/^(?=.*\d)[0-9A-Z]{4,5}$/i.test(upper)) {
    queries.unshift(`${upper}.T`);
  }

  return [...new Set(queries)];
};

const searchYahooFinance = async (query) => {
  const responses = await Promise.all(
    searchQueries(query).map(async (searchQuery) => {
      const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(searchQuery)}&quotesCount=10&newsCount=0`;
      const response = await fetch(url, {
        headers: { "user-agent": "Mozilla/5.0" },
      });
      if (!response.ok) throw new Error(`Yahoo Finance search failed: ${response.status}`);
      return response.json();
    })
  );

  return responses
    .flatMap((data) => data.quotes || [])
    .filter((quote) => quote.symbol && (quote.quoteType === "EQUITY" || quote.quoteType === "ETF" || quote.typeDisp))
    .map((quote) => ({
      symbol: displaySymbol(quote.symbol),
      yahooSymbol: quote.symbol,
      name: quote.shortname || quote.longname || quote.symbol,
      exchange: quote.exchDisp || quote.exchange || "",
      type: quote.typeDisp || quote.quoteType || "",
      source: "Yahoo Finance",
    }));
};

const searchYahooJapan = async (query) => {
  if (/^(?=.*\d)[0-9A-Z]{4,5}$/i.test(query.trim())) {
    return [];
  }

  const url = `https://finance.yahoo.co.jp/search/?query=${encodeURIComponent(query)}`;
  const response = await fetch(url, {
    headers: {
      "accept-language": "ja,en-US;q=0.8,en;q=0.6",
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`Yahoo Japan search failed: ${response.status}`);

  const html = await response.text();
  const results = [];
  const seen = new Set();
  const quoteRegex = /href="https:\/\/finance\.yahoo\.co\.jp\/quote\/((?=.*\d)[0-9A-Z]{4,5})\.T(?:[/?"][^"]*)?"/gi;
  let match;

  while ((match = quoteRegex.exec(html)) && results.length < 12) {
    const code = match[1].toUpperCase();
    if (seen.has(code)) continue;
    seen.add(code);

    const articleStart = html.lastIndexOf("<article", match.index);
    const articleEnd = html.indexOf("</article>", match.index);
    const article =
      articleStart >= 0 && articleEnd > articleStart
        ? html.slice(articleStart, articleEnd + "</article>".length)
        : html.slice(Math.max(0, match.index - 800), match.index + 1200);
    const name = textFromHtml(article.match(/<h2[^>]*>([\s\S]*?)<\/h2>/i)?.[1] || "");
    const supplements = [...article.matchAll(/<li[^>]*SearchItem__supplement[^>]*>([\s\S]*?)<\/li>/gi)].map((item) =>
      textFromHtml(item[1])
    );

    results.push({
      symbol: `${code}.jp`,
      yahooSymbol: `${code}.T`,
      name: name || code,
      exchange: supplements.find((item) => item && item !== code) || "Yahoo!ファイナンス",
      type: "日本株",
      source: "Yahoo!ファイナンス",
    });
  }

  return results;
};

const resultScore = (query, quote) => {
  const normalized = query.trim().toUpperCase();
  const symbol = quote.symbol.toUpperCase().replace(/\.JP$/, "");
  let score = 0;
  if (symbol === normalized || quote.yahooSymbol?.toUpperCase() === normalized || quote.yahooSymbol?.toUpperCase() === `${normalized}.T`) {
    score += 100;
  }
  if (/\.jp$/i.test(quote.symbol)) score += 20;
  if (quote.source === "Yahoo!ファイナンス") score += 10;
  if (String(quote.name || "").toUpperCase().includes(normalized)) score += 5;
  return score;
};

export default async function handler(req, res) {
  const query = String(req.query.q || req.query.query || "").trim();

  if (!query) {
    return res.status(400).json({ error: "q is required" });
  }

  try {
    const seen = new Set();
    const settled = await Promise.allSettled([searchYahooJapan(query), searchYahooFinance(query)]);
    const results = settled
      .flatMap((result) => (result.status === "fulfilled" ? result.value : []))
      .filter((quote) => {
        const key = quote.symbol.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => resultScore(query, b) - resultScore(query, a))
      .slice(0, 8);

    res.status(200).json({ query, results });
  } catch (error) {
    res.status(200).json({ query, results: [], error: error.message });
  }
}
