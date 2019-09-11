const rp = require('request-promise')
const cheerio = require('cheerio');
const _ = require('lodash');
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

exports.handler = async function(event, context) {
  const symbol = process.argv[2];
  const { stocks } = await getStocks();
  const stock = _.find(stocks, {symbol});
  let $ = cheerio.load(await rp(`https://stock-ai.com/tw-Dly-8-${symbol}`));
  $ = cheerio.load(await rp(`https://stock-ai.com/lazyLoad?pType=tZ&symbolCode=${symbol}&md5ChkSum=${$.html().match(/md5ChkSum='([a-z0-9]+)'/)[1]}&_=${Date.now()}`));
  
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

  let stocksWithDividend = [];
  try {
      stocksWithDividend.push({
          ...stock,
          dividends: dividends,
          dividendAvg,
          dividendCount,
          dividendSuccessCount,
          dividendSuccessPercent,
      });

      let result = await upsertStocks(stocksWithDividend).catch(error => console.error(error));
  } catch (error) {
      console.error(error)
  }

  return 'ok';
}