import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { FileUp, HelpCircle, Newspaper, RefreshCw, Save, Search, Trash2, TrendingUp } from "lucide-react";
import "./styles.css";

const STORAGE_KEY = "rakuten_csv_holdings_v1";

const yen = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  return `${Math.round(Number(value)).toLocaleString("ja-JP")}円`;
};

const signedYen = (value) => {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "-";
  const n = Number(value);
  const sign = n > 0 ? "+" : n < 0 ? "-" : "";
  return `${sign}${Math.abs(Math.round(n)).toLocaleString("ja-JP")}円`;
};

const numeric = (value) => {
  if (value === null || value === undefined) return null;
  const normalized = String(value).replace(/[",円株\s]/g, "").replace(/−/g, "-");
  if (!normalized || normalized === "-") return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : null;
};

const normalizeCode = (value) => {
  const code = String(value || "").trim().toUpperCase();
  if (/^(?=.*\d)[0-9A-Z]{4,5}$/.test(code)) return `${code}.jp`;
  return code.replace(/\.T$/i, ".jp");
};

const holdingPnl = (item) => {
  const quantity = Number(item.quantity) || 0;
  const price = item.price !== null && item.price !== undefined ? Number(item.price) : null;
  const averageCost = item.averageCost !== null && item.averageCost !== undefined ? Number(item.averageCost) : null;
  const value = price !== null && Number.isFinite(price) ? price * quantity : null;
  const cost = averageCost !== null && Number.isFinite(averageCost) ? averageCost * quantity : null;

  if (value !== null && cost !== null) return value - cost;
  return item.importedPnl ?? null;
};

const sortHoldingsByPnl = (items) =>
  [...items].sort((a, b) => {
    const aPnl = holdingPnl(a);
    const bPnl = holdingPnl(b);
    const aValue = aPnl === null || aPnl === undefined || Number.isNaN(Number(aPnl)) ? -Infinity : Number(aPnl);
    const bValue = bPnl === null || bPnl === undefined || Number.isNaN(Number(bPnl)) ? -Infinity : Number(bPnl);
    return bValue - aValue;
  });

const findColumn = (headers, candidates) =>
  headers.find((header) => candidates.some((candidate) => header.replace(/\s/g, "").includes(candidate)));

const splitCsvLine = (line) => {
  const cells = [];
  let current = "";
  let quoted = false;

  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    const next = line[i + 1];

    if (ch === '"' && quoted && next === '"') {
      current += '"';
      i += 1;
    } else if (ch === '"') {
      quoted = !quoted;
    } else if (ch === "," && !quoted) {
      cells.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  cells.push(current.trim());
  return cells.map((cell) => cell.replace(/^"|"$/g, ""));
};

const parseCsv = (text) => {
  const lines = text
    .replace(/\r/g, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length < 2) throw new Error("CSVに明細行がありません。");

  const headers = splitCsvLine(lines[0]);
  const nameCol = findColumn(headers, ["銘柄名", "名称", "商品名"]);
  const codeCol = findColumn(headers, ["銘柄コード", "コード", "証券コード"]);
  const qtyCol = findColumn(headers, ["保有数量", "数量", "株数"]);
  const avgCol = findColumn(headers, ["平均取得単価", "取得単価", "取得価額"]);
  const pnlCol = findColumn(headers, ["損益", "評価損益", "含み損益"]);

  if (!nameCol || !codeCol) {
    throw new Error("銘柄名と銘柄コードの列が見つかりません。楽天証券の保有商品CSVを選んでください。");
  }

  return lines.slice(1).map((line, index) => {
    const cells = splitCsvLine(line);
    const row = Object.fromEntries(headers.map((header, i) => [header, cells[i] ?? ""]));
    const quantity = numeric(row[qtyCol]);
    const averageCost = numeric(row[avgCol]);
    const importedPnl = numeric(row[pnlCol]);

    return {
      id: `${Date.now()}-${index}`,
      name: row[nameCol] || "名称未設定",
      code: normalizeCode(row[codeCol]),
      quantity: quantity ?? 0,
      averageCost: averageCost ?? null,
      importedPnl: importedPnl ?? null,
      price: null,
      updatedAt: null,
      news: [],
      error: "",
    };
  });
};

const readCsvFile = async (file) => {
  const buffer = await file.arrayBuffer();
  const decoders = ["shift_jis", "utf-8"];

  for (const encoding of decoders) {
    try {
      const text = new TextDecoder(encoding).decode(buffer);
      if (text.includes("銘柄") || text.includes("コード")) return text;
    } catch {
      // Try the next encoding.
    }
  }
  return new TextDecoder("utf-8").decode(buffer);
};

function App() {
  const [tab, setTab] = useState("record");
  const [holdings, setHoldings] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
    } catch {
      return [];
    }
  });
  const [message, setMessage] = useState("銘柄コードだけでも登録できます。CSV読み込みも使えます。");
  const [manual, setManual] = useState({ code: "", quantity: "", averageCost: "" });
  const [companyQuery, setCompanyQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const inputRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(holdings));
  }, [holdings]);

  const totals = useMemo(() => {
    return holdings.reduce(
      (acc, item) => {
        const cost = (item.averageCost || 0) * (item.quantity || 0);
        const value = item.price ? item.price * item.quantity : null;
        const pnl = holdingPnl(item);
        acc.cost += cost;
        if (value !== null) acc.value += value;
        if (pnl !== null && pnl !== undefined) acc.pnl += pnl;
        return acc;
      },
      { cost: 0, value: 0, pnl: 0 }
    );
  }, [holdings]);

  const sortedHoldings = useMemo(() => sortHoldingsByPnl(holdings), [holdings]);

  const importFile = async (file) => {
    if (!file) return;
    setLoading(true);
    try {
      const text = await readCsvFile(file);
      const rows = parseCsv(text);
      setHoldings(rows);
      setMessage(`${rows.length}件の銘柄を読み込みました。次は「株価」から更新してください。`);
      setTab("prices");
    } catch (error) {
      setMessage(error.message);
    } finally {
      setLoading(false);
    }
  };

  const addByCode = async (event) => {
    event.preventDefault();
    const code = normalizeCode(manual.code);
    const quantity = numeric(manual.quantity) ?? 1;
    const averageCost = numeric(manual.averageCost);

    if (!code) {
      setMessage("銘柄コードを入力してください。例: 7203 / 130A");
      return;
    }

    setLoading(true);
    setMessage(`${code} を登録しています。`);
    try {
      const quoteResponse = await fetch(`/api/quote?symbols=${encodeURIComponent(code)}`);
      const quoteData = await quoteResponse.json();
      const quote = quoteData.quotes?.[0];

      if (quote?.error) throw new Error(quote.error);

      const item = {
        id: `${Date.now()}-${code}`,
        name: quote?.name || code,
        code,
        quantity,
        averageCost,
        importedPnl: null,
        price: quote?.price ?? null,
        updatedAt: quote?.price ? new Date().toISOString() : null,
        news: [],
        error: "",
      };

      setHoldings((current) => {
        const exists = current.some((holding) => holding.code.toLowerCase() === code.toLowerCase());
        return exists ? current.map((holding) => (holding.code.toLowerCase() === code.toLowerCase() ? item : holding)) : [item, ...current];
      });
      setManual({ code: "", quantity: "", averageCost: "" });
      setMessage(`${code} を登録しました。ニュースは「株価」から更新できます。`);
      setTab("prices");
    } catch (error) {
      setMessage(`登録できませんでした: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const searchCompany = async (event) => {
    event.preventDefault();
    const query = companyQuery.trim();

    if (!query) {
      setMessage("企業名か銘柄コードを入力してください。例: トヨタ / 7203 / 130A");
      return;
    }

    setLoading(true);
    setMessage(`${query} を検索しています。`);
    try {
      const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      const data = await response.json();
      const results = data.results || [];
      const firstResult = results[0];
      setSearchResults(results);
      if (firstResult) {
        setManual((current) => ({ ...current, code: firstResult.symbol }));
        setCompanyQuery(firstResult.name || firstResult.symbol);
        setMessage(`${firstResult.name || firstResult.symbol} の銘柄コード ${firstResult.symbol} を入力しました。`);
      } else {
        setMessage("候補が見つかりませんでした。");
      }
    } catch (error) {
      setMessage(`検索できませんでした: ${error.message}`);
      setSearchResults([]);
    } finally {
      setLoading(false);
    }
  };

  const chooseSearchResult = (result) => {
    setManual((current) => ({ ...current, code: result.symbol }));
    setCompanyQuery(result.name || result.symbol);
    setMessage(`${result.name || result.symbol} を選びました。数量を入れて登録してください。`);
  };

  const updatePricesAndNews = async () => {
    if (!holdings.length) {
      setMessage("先に「記録」から銘柄コードを登録するか、CSVを読み込んでください。");
      setTab("record");
      return;
    }

    setLoading(true);
    setMessage("株価とニュースを取得しています。");
    try {
      const symbols = holdings.map((item) => item.code).join(",");
      const quoteResponse = await fetch(`/api/quote?symbols=${encodeURIComponent(symbols)}`);
      const quoteData = await quoteResponse.json();
      const quoteMap = new Map((quoteData.quotes || []).map((quote) => [quote.symbol.toLowerCase(), quote]));

      const withQuotes = await Promise.all(
        holdings.map(async (item) => {
          const quote = quoteMap.get(item.code.toLowerCase());
          let news = item.news || [];
          let newsStatus = item.newsStatus || "";

          try {
            const newsResponse = await fetch(`/api/news?symbol=${encodeURIComponent(item.code)}&name=${encodeURIComponent(item.name)}`);
            const newsData = await newsResponse.json();
            const nextNews = newsData.news || [];
            if (nextNews.length) {
              news = nextNews;
              newsStatus = "";
            } else {
              newsStatus = newsData.error ? `ニュース取得エラー: ${newsData.error}` : "関連ニュースは見つかりませんでした。";
            }
          } catch (error) {
            newsStatus = `ニュース取得エラー: ${error.message}`;
          }

          return {
            ...item,
            price: quote?.price ?? item.price,
            updatedAt: quote?.price ? new Date().toISOString() : item.updatedAt,
            news,
            newsStatus,
            error: quote?.error || "",
          };
        })
      );

      setHoldings(sortHoldingsByPnl(withQuotes));
      const newsCount = withQuotes.reduce((count, item) => count + (item.news?.length || 0), 0);
      setMessage(newsCount ? `株価とニュースを更新しました。ニュース${newsCount}件。` : "株価を更新しました。ニュースは見つかりませんでした。");
    } catch (error) {
      setMessage(`更新できませんでした: ${error.message}`);
    } finally {
      setLoading(false);
    }
  };

  const removeHolding = (id) => {
    setHoldings((current) => current.filter((item) => item.id !== id));
  };

  return (
    <div className="app">
      <header className="hero">
        <div>
          <p className="eyebrow">Rakuten CSV Portfolio</p>
          <h1>楽天証券CSV 投資トラッカー</h1>
        </div>
        <div className="heroStats">
          <div>
            <span>評価額</span>
            <strong>{totals.value ? yen(totals.value) : "-"}</strong>
          </div>
          <div>
            <span>含み損益</span>
            <strong className={totals.pnl >= 0 ? "positive" : "negative"}>{signedYen(totals.pnl)}</strong>
          </div>
        </div>
      </header>

      <main>
        <div className="notice">{loading ? "処理中..." : message}</div>

        {tab === "record" && (
          <section className="panel">
            <div className="sectionTitle">
              <Search size={20} />
              <h2>記録</h2>
            </div>
            <form className="searchForm" onSubmit={searchCompany}>
              <label>
                企業名で検索
                <div className="searchRow">
                  <input
                    type="search"
                    placeholder="トヨタ / ソニー / 130A"
                    value={companyQuery}
                    onChange={(event) => setCompanyQuery(event.target.value)}
                  />
                  <button className="iconSubmit" type="submit" aria-label="検索" disabled={loading}>
                    <Search size={18} />
                  </button>
                </div>
              </label>
            </form>
            {searchResults.length > 0 && (
              <div className="resultList">
                {searchResults.map((result) => (
                  <button key={`${result.symbol}-${result.exchange}`} type="button" onClick={() => chooseSearchResult(result)}>
                    <span>
                      <strong>{result.name || result.symbol}</strong>
                      <small>{result.symbol} / {result.exchange || "Yahoo Finance"}</small>
                    </span>
                    <Search size={16} />
                  </button>
                ))}
              </div>
            )}
            <form className="manualForm" onSubmit={addByCode}>
              <label>
                銘柄コード
                <input
                  autoCapitalize="characters"
                  placeholder="7203 / 130A"
                  value={manual.code}
                  onChange={(event) => setManual((current) => ({ ...current, code: event.target.value }))}
                />
              </label>
              <div className="formGrid">
                <label>
                  数量
                  <input
                    inputMode="decimal"
                    placeholder="100"
                    value={manual.quantity}
                    onChange={(event) => setManual((current) => ({ ...current, quantity: event.target.value }))}
                  />
                </label>
                <label>
                  取得単価
                  <input
                    inputMode="decimal"
                    placeholder="任意"
                    value={manual.averageCost}
                    onChange={(event) => setManual((current) => ({ ...current, averageCost: event.target.value }))}
                  />
                </label>
              </div>
              <button className="primaryButton" type="submit" disabled={loading}>
                <Save size={18} />
                コードで登録
              </button>
            </form>
            <div className="divider">CSVでまとめて登録</div>
            <button className="primaryButton" onClick={() => inputRef.current?.click()} disabled={loading}>
              <FileUp size={18} />
              楽天証券CSVを読み込み
            </button>
            <input
              ref={inputRef}
              hidden
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => importFile(event.target.files?.[0])}
            />
            <div
              className="dropZone"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                importFile(event.dataTransfer.files?.[0]);
              }}
            >
              CSVをここにドロップしても読み込めます。
            </div>
            <a className="sampleLink" href="/sample-rakuten.csv" download>
              サンプルCSVを試す
            </a>
          </section>
        )}

        {tab === "prices" && (
          <section className="panel">
            <div className="sectionTitle">
              <TrendingUp size={20} />
              <h2>株価</h2>
            </div>
            <button className="primaryButton" onClick={updatePricesAndNews} disabled={loading}>
              <RefreshCw size={18} />
              株価・ニュース更新
            </button>
            <div className="holdingList">
              {holdings.length === 0 && <div className="empty">まだ銘柄がありません。</div>}
              {sortedHoldings.map((item) => {
                const value = item.price ? item.price * item.quantity : null;
                const cost = item.averageCost ? item.averageCost * item.quantity : null;
                const pnl = holdingPnl(item);

                return (
                  <article className="holding" key={item.id}>
                    <div className="holdingTop">
                      <div>
                        <h3>{item.name}</h3>
                        <p>{item.code} / {item.quantity.toLocaleString("ja-JP")}株</p>
                      </div>
                      <button className="iconButton" aria-label="削除" onClick={() => removeHolding(item.id)}>
                        <Trash2 size={16} />
                      </button>
                    </div>
                    <div className="metrics">
                      <div><span>取得単価</span><strong>{yen(item.averageCost)}</strong></div>
                      <div><span>現在株価</span><strong>{yen(item.price)}</strong></div>
                      <div><span>評価額</span><strong>{yen(value)}</strong></div>
                      <div><span>含み損益</span><strong className={pnl >= 0 ? "positive" : "negative"}>{signedYen(pnl)}</strong></div>
                    </div>
                    {item.error && <p className="errorText">{item.error}</p>}
                    {item.news?.length > 0 && (
                      <div className="news">
                        <div className="newsHead"><Newspaper size={15} /> 関連ニュース</div>
                        {item.news.map((news) => (
                          <a key={news.link} href={news.link} target="_blank" rel="noreferrer">
                            {news.title}
                            <span>{news.publisher}</span>
                          </a>
                        ))}
                      </div>
                    )}
                    {item.newsStatus && <p className="newsStatus">{item.newsStatus}</p>}
                  </article>
                );
              })}
            </div>
          </section>
        )}

        {tab === "help" && (
          <section className="panel">
            <div className="sectionTitle">
              <HelpCircle size={20} />
              <h2>使い方</h2>
            </div>
            <ol className="steps">
              <li>下メニューの「記録」で企業名を検索するか、銘柄コードを入れて登録します。</li>
              <li>数量と取得単価を入れると評価額と損益が見やすくなります。</li>
              <li>楽天証券CSVを持っている場合は「楽天証券CSVを読み込み」も使えます。</li>
              <li>登録後、「株価」から「株価・ニュース更新」を押します。</li>
              <li>iPhoneではSafariの共有ボタンから「ホーム画面に追加」するとアプリ風に使えます。</li>
            </ol>
            <div className="tip">
              日本株コードは `7203` や `130A` を自動で `7203.jp` / `130A.jp` として扱います。株価取得時はサーバー側でYahoo Finance形式に変換します。
            </div>
          </section>
        )}
      </main>

      <nav className="bottomNav">
        <button className={tab === "record" ? "active" : ""} onClick={() => setTab("record")}>
          <FileUp size={18} />
          記録
        </button>
        <button className={tab === "prices" ? "active" : ""} onClick={() => setTab("prices")}>
          <TrendingUp size={18} />
          株価
        </button>
        <button className={tab === "help" ? "active" : ""} onClick={() => setTab("help")}>
          <HelpCircle size={18} />
          使い方
        </button>
      </nav>
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
