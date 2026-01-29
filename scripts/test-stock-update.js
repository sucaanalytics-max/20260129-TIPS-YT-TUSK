// scripts/test-stock-update.js
// Manual testing script for stock price updates

require('dotenv').config();
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

async function fetchStockPrice() {
  const symbol = 'TIPSMUSIC';
  
  console.log('Fetching stock price from Yahoo Finance...');
  
  try {
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${symbol}.NS?interval=1d&range=1d`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
      }
    );
    
    if (response.ok) {
      const data = await response.json();
      const quote = data.chart.result[0];
      const meta = quote.meta;
      
      const stockData = {
        date: new Date().toISOString().split('T')[0],
        open: meta.regularMarketPrice || meta.previousClose,
        high: meta.regularMarketDayHigh || meta.regularMarketPrice,
        low: meta.regularMarketDayLow || meta.regularMarketPrice,
        close: meta.regularMarketPrice,
        volume: meta.regularMarketVolume || 0,
        source: 'yahoo_finance'
      };
      
      console.log('Stock data fetched:', stockData);
      return stockData;
    } else {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }
  } catch (error) {
    console.error('Error fetching stock price:', error);
    throw error;
  }
}

async function updateDatabase(stockData) {
  console.log('\nChecking if record exists for today...');
  
  const { data: existing, error: checkError } = await supabase
    .from('stock_prices')
    .select('*')
    .eq('date', stockData.date)
    .single();
  
  if (checkError && checkError.code !== 'PGRST116') {
    throw checkError;
  }
  
  if (existing) {
    console.log('Record exists, updating...');
    
    const { data, error } = await supabase
      .from('stock_prices')
      .update({
        open: stockData.open,
        high: stockData.high,
        low: stockData.low,
        close: stockData.close,
        volume: stockData.volume,
        source: stockData.source,
        updated_at: new Date().toISOString()
      })
      .eq('date', stockData.date)
      .select();
    
    if (error) throw error;
    
    console.log('Updated successfully:', data);
    return { action: 'updated', data };
  } else {
    console.log('No existing record, inserting new...');
    
    const { data, error } = await supabase
      .from('stock_prices')
      .insert([{
        date: stockData.date,
        open: stockData.open,
        high: stockData.high,
        low: stockData.low,
        close: stockData.close,
        volume: stockData.volume,
        source: stockData.source,
        created_at: new Date().toISOString()
      }])
      .select();
    
    if (error) throw error;
    
    console.log('Inserted successfully:', data);
    return { action: 'inserted', data };
  }
}

async function main() {
  console.log('=== TIPS Stock Price Update Test ===\n');
  console.log('Date:', new Date().toISOString());
  console.log('Symbol: TIPSMUSIC.NS\n');
  
  try {
    // Fetch stock price
    const stockData = await fetchStockPrice();
    
    // Update database
    const result = await updateDatabase(stockData);
    
    console.log('\n=== Test Completed Successfully ===');
    console.log('Action:', result.action);
    console.log('Final data:', result.data);
    
  } catch (error) {
    console.error('\n=== Test Failed ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

main();
