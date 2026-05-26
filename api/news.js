const normalizeSymbol = (raw) => {
  const value = String(raw || "").trim().toUpperCase();
  if (/^(?=.*\d)[0-9A-Z]{4,5}$/.test(value)) return `${value}.T`;
  if (/^(?=.*\d)[0-9A-Z]{4,5}\.jp$/i.test(value)) return `${value.replace(/\.jp$/i, "")}.T`;
  return value.replace(/\.jp$/i, ".T");
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

const absoluteYahooJapanLink = (link) => {
  if (!link) return "";
  if (/^https?:\/\//i.test(link)) return link;
  return `https://finance.yahoo.co.jp${link.startsWith("/") ? link : `/${link}`}`;
};

const newsScore = (title, name) => {
  const normalizedTitle = String(title || "").toUpperCase();
  const normalizedName = String(name || "")
    .replace(/株式会社|\(株\)|（株）|グループ|ホールディングス/g, "")
    .trim()
    .toUpperCase();
  const tokens = normalizedName.split(/[\s・　]+/).filter((token) => token.length >= 2);
  let score = 0;

  if (normalizedName && normalizedTitle.includes(normalizedName)) score += 30;
  tokens.forEach((token) => {
    if (normalizedTitle.includes(token)) score += 10;
  });
  return score;
};

const fetchYahooJapanNews = async (symbol, name) => {
  if (!/^(?=.*\d)[0-9A-Z]{4,5}\.T$/i.test(symbol)) return [];

  const url = `https://finance.yahoo.co.jp/quote/${encodeURIComponent(symbol)}/news`;
  const response = await fetch(url, {
    headers: {
      "accept-language": "ja,en-US;q=0.8,en;q=0.6",
      "user-agent": "Mozilla/5.0",
    },
  });
  if (!response.ok) throw new Error(`Yahoo Japan news failed: ${response.status}`);

  const html = await response.text();
  const news = [];
  const seen = new Set();
  const articleRegex = /<article\b[\s\S]*?<\/article>/gi;
  let match;

  while ((match = articleRegex.exec(html)) && news.length < 12) {
    const article = match[0];
    const link = absoluteYahooJapanLink(htmlDecode(article.match(/<a href="([^"]+)"/i)?.[1] || ""));
    const title = textFromHtml(article.match(/<h3[^>]*>([\s\S]*?)<\/h3>/i)?.[1] || "");
    if (!link || !title || seen.has(link)) continue;
    seen.add(link);

    news.push({
      title,
      publisher:
        textFromHtml(article.match(/<li[^>]*media[^>]*>([\s\S]*?)<\/li>/i)?.[1] || "") || "Yahoo!ファイナンス",
      link,
      publishedAt: textFromHtml(article.match(/<time[^>]*>([\s\S]*?)<\/time>/i)?.[1] || "") || null,
      source: "Yahoo!ファイナンス",
      score: newsScore(title, name),
    });
  }

  return news
    .sort((a, b) => b.score - a.score)
    .slice(0, 5)
    .map(({ score, ...item }) => item);
};

const fetchYahooFinanceNews = async (query) => {
  const url = `https://query1.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(query)}&newsCount=8&quotesCount=0`;
  const response = await fetch(url, {
    headers: { "user-agent": "Mozilla/5.0" },
  });
  if (!response.ok) throw new Error(`news fetch failed: ${response.status}`);
  const data = await response.json();
  return (data.news || []).slice(0, 5).map((item) => ({
    title: item.title,
    publisher: item.publisher,
    link: item.link,
    publishedAt: item.providerPublishTime || null,
    source: "Yahoo Finance",
  }));
};

export default async function handler(req, res) {
  const symbol = normalizeSymbol(req.query.symbol || "");
  const name = String(req.query.name || "").trim();
  const query = symbol || name;

  if (!query) {
    return res.status(400).json({ error: "symbol or name is required" });
  }

  try {
    const japaneseNews = await fetchYahooJapanNews(symbol, name);
    const news = japaneseNews.length ? japaneseNews : await fetchYahooFinanceNews(query);

    res.status(200).json({ symbol, news });
  } catch (error) {
    res.status(200).json({ symbol, news: [], error: error.message });
  }
}
