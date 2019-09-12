const rp = require('request-promise')
const cheerio = require('cheerio');
const { request } = require('graphql-request');

const endpoint = process.env.GRAPHQL_ENDPOINT || 'http://localhost:7001/graphql'

async function upsertStocks(stocks) {
  return await Promise.all(stocks.map(async stock => {
    stock.dividends = `[${stock.dividends.map(dividend=>`{${Object
        .keys(dividend)
        .map(key => `${key}:${key !== 'date' ? dividend[key] : JSON.stringify(dividend[key])}`)
        .join(",")}}`).join(',')}]`;
    const query = /* GraphQL */ `
        mutation {
            upsertStock(${Object
            .keys(stock)
            .map(key => `${key}:${key !== 'symbol' && key !== 'company' ? stock[key] : JSON.stringify(stock[key])}`)
            .join(",")}) {
                symbol
                company
            }
        }
      `;

    return await request(endpoint, query)
  }));
}

async function getStocks() {
  const query = /* GraphQL */ `
    query {
        stocks {
            symbol
            company
        }
    }
    `;

    return await request(endpoint, query);
}

async function crawlDividend(symbol, stock, md5ChkSum) {
  $ = cheerio.load(await rp(`https://stock-ai.com/lazyLoad?pType=tZ&symbolCode=${symbol}&md5ChkSum=${md5ChkSum}&_=${Date.now()}`));
  
  const DividendTr = $('tbody tr');
  let dividends = [];
  let dividendCount = DividendTr.length;
  let dividendSuccessCount = 0;
  let dividendAvg = 0;
  let dividendSuccessPercent = 0;
  for(i = 0; i < dividendCount; i++) {
      const success = DividendTr.eq(i).find('td').eq(7).find('i').hasClass('fa-thumbs-o-up');

      if(success)
          dividendSuccessCount++;
      
      dividends.push({
          date: DividendTr.eq(i).find('td').eq(0).text().replace(/(\d{4}).{1}(\d{2}).{1}(\d{2}).{1}/g,'$1-$2-$3'),
          dividend: parseFloat(DividendTr.eq(i).find('td').eq(1).text()),
          priceOfLastDay: parseFloat(DividendTr.eq(i).find('td').eq(2).text()),
          openingPrice: parseFloat(DividendTr.eq(i).find('td').eq(3).text()),
          yield: parseFloat(DividendTr.eq(i).find('td').eq(4).text()) || null,
          per: parseFloat(DividendTr.eq(i).find('td').eq(5).text()) || null,
          pbr: parseFloat(DividendTr.eq(i).find('td').eq(6).text()) || null,
          success,
          successDay: parseInt(DividendTr.eq(i).find('td').eq(8).text()),
      });

      dividendAvg += dividends[i].yield;
  }
  if(dividendCount) {
      dividendSuccessPercent = Math.floor(dividendSuccessCount / dividendCount * 100);
      dividendAvg = dividendAvg / dividendCount;
  }

  try {
      return {
        ...stock,
        dividends: dividends,
        dividendAvg,
        dividendCount,
        dividendSuccessCount,
        dividendSuccessPercent,
    };

  } catch (error) {
      console.error(error)
  }
}

exports.handler = async function(event, context) {
  let $ = cheerio.load(await rp({
    uri: 'https://stock.wespai.com/p/51227',
    headers: {
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/76.0.3809.132 Safari/537.36',
    },
    json: true
  }));
  let md5ChkSum = cheerio.load(await rp(`https://stock-ai.com/tw-Dly-8-2618`)).html().match(/md5ChkSum='([a-z0-9]+)'/)[1];
  
  let stocksWithDividend = [];
  let stocksGroups = [];
  let stocks = $('#example tbody tr').map((index, stock) => {
      let idx = parseInt(index / 50);
      if(!stocksGroups[idx]) stocksGroups[idx] = [];
      stocksGroups[idx].push({
        symbol: $(stock).children("td").eq(0).text(),
        company: $(stock).children("td").eq(1).text(),
        price: parseFloat($(stock).children("td").eq(2).text()),
      })
    }).get();
  

  for(let group of stocksGroups) {
    stocksWithDividend = [];
    await Promise.all(group.map(async stock => {
      stocksWithDividend.push(await crawlDividend(stock.symbol, stock, md5ChkSum));
    }));
    let result = await upsertStocks(stocksWithDividend).catch(error => console.error(error));
  }
  
  return 'ok';
}