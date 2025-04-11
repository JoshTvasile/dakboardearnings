/**
 * DAKboard Earnings Calendar Server
 * 
 * This Node.js script creates a small web server that:
 * 1. Fetches upcoming earnings data from Financial Modeling Prep API
 * 2. Formats it into DAKboard-compatible JSON
 * 3. Serves this data via HTTP for DAKboard to consume
 * 4. Automatically refreshes the data daily
 * 
 * To use:
 * 1. Install Node.js on any server (can be a cheap VPS, Raspberry Pi, etc.)
 * 2. Save this file as app.js
 * 3. Run 'npm install express node-fetch node-cron'
 * 4. Set your API key in the config section
 * 5. Run 'node app.js'
 * 6. Configure DAKboard to fetch data from this server
 */

// Import required modules
const express = require('express');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
    port: process.env.PORT || 3000,
    apiKey: "wB2WppJXL6r6L4s8DjnXrrAA5ZySXgx1", // API key in quotes
    dataRefreshInterval: '0 0 * * *', // Daily at midnight (cron format)
    dataFile: path.join(__dirname, 'earnings_data.json')
};

// Initialize the app
const app = express();
let cachedData = [];

// Function to format date as YYYY-MM-DD
function formatDate(date) {
    return date.toISOString().split('T')[0];
}

// Function to get earnings data for the next 10 business days
async function fetchEarningsData() {
    try {
        console.log('Fetching new earnings data...');
        
        // Calculate date range (next 2 weeks)
        const today = new Date();
        const endDate = new Date(today);
        endDate.setDate(today.getDate() + 14); // 2 weeks
        
        const fromDate = formatDate(today);
        const toDate = formatDate(endDate);
        
        // Fetch data from Financial Modeling Prep API
        const url = `https://financialmodelingprep.com/api/v3/earning-calendar?from=${fromDate}&to=${toDate}&apikey=${config.apiKey}`;
        console.log('API URL:', url); // Add diagnostic logging
        const response = await fetch(url);
        const data = await response.json();
        
        // Log the actual response for debugging
        console.log('API Response:', JSON.stringify(data).substring(0, 500) + '...');
        
        // Check if data is an array
        if (!Array.isArray(data)) {
            console.error('API did not return an array. Response:', JSON.stringify(data));
            
            // Use sample data instead
            console.log('Using sample data instead');
            return getSampleData();
        }
        
        // Process the data to exclude weekends and organize by date
        const earningsByDate = {};
        
        data.forEach(earning => {
            const date = new Date(earning.date.split(' ')[0]);
            const day = date.getDay();
            
            // Skip weekends (0 = Sunday, 6 = Saturday)
            if (day === 0 || day === 6) {
                return;
            }
            
            const formattedDate = formatDate(date);
            
            if (!earningsByDate[formattedDate]) {
                earningsByDate[formattedDate] = [];
            }
            
            earningsByDate[formattedDate].push({
                symbol: earning.symbol,
                name: earning.name || earning.symbol,
                eps: earning.epsEstimated
            });
        });
        
        // Convert to DAKboard-compatible JSON format
        const dakboardData = [];
        
        // Prepare the headers
        dakboardData.push({
            value: "The Most Anticipated Earnings Releases",
            title: "",
            subtitle: `for the period beginning ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
        });
        
        // Add a separator
        dakboardData.push({
            value: "(only showing confirmed release dates)",
            title: "",
            subtitle: ""
        });
        
        // Process each date
        let businessDaysCounter = 0;
        const dayLabels = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
        const dateEntries = Object.entries(earningsByDate).sort(([a], [b]) => a.localeCompare(b));
        
        // Only include 10 business days (2 weeks)
        for (const [dateStr, earnings] of dateEntries) {
            if (businessDaysCounter >= 10) break;
            
            const date = new Date(dateStr);
            const dayOfWeek = date.getDay();
            
            // Skip weekends (should be filtered already, but just to be safe)
            if (dayOfWeek === 0 || dayOfWeek === 6) continue;
            
            // Sort earnings by symbol
            earnings.sort((a, b) => a.symbol.localeCompare(b.symbol));
            
            // Create entry for this date
            const dayName = dayLabels[businessDaysCounter % 5];
            const displayDate = date.getDate();
            
            // Add the date header
            dakboardData.push({
                value: `${dayName} - ${displayDate}`,
                title: "",
                subtitle: ""
            });
            
            // Add each company reporting on this date
            for (const earning of earnings) {
                dakboardData.push({
                    value: earning.symbol,
                    title: earning.name,
                    subtitle: earning.eps ? `Est. EPS: $${earning.eps}` : ""
                });
            }
            
            // Add a separator if this isn't the last day
            if (businessDaysCounter < 9) {
                dakboardData.push({
                    value: "---",
                    title: "",
                    subtitle: ""
                });
            }
            
            businessDaysCounter++;
        }
        
        // Save the data to a file for persistence and cache
        fs.writeFileSync(config.dataFile, JSON.stringify(dakboardData, null, 2));
        cachedData = dakboardData;
        
        console.log(`Fetched and processed ${businessDaysCounter} days of earnings data.`);
        return dakboardData;
    } catch (error) {
        console.error('Error fetching earnings data:', error);
        console.error('Error details:', error.message); // Add more detailed error logging
        return getSampleData(); // Return sample data on error
    }
}

// Load cached data if available, otherwise fetch fresh data
async function initializeData() {
    try {
        if (fs.existsSync(config.dataFile)) {
            const fileData = fs.readFileSync(config.dataFile, 'utf8');
            cachedData = JSON.parse(fileData);
            console.log('Loaded cached data from file.');
        } else {
            cachedData = await fetchEarningsData();
            console.log('No cached data found. Fetched fresh data.');
        }
    } catch (error) {
        console.error('Error initializing data:', error);
        cachedData = getSampleData(); // Initialize with sample data on error
    }
}

// Schedule data refresh
cron.schedule(config.dataRefreshInterval, async () => {
    await fetchEarningsData();
    console.log('Data refreshed via scheduled job.');
});

// Define routes
app.get('/', (req, res) => {
    res.send('Earnings Calendar API is running. Access /api/earnings for the data.');
});

app.get('/api/earnings', (req, res) => {
    res.json(cachedData);
});

// Force a data refresh
app.get('/api/refresh', async (req, res) => {
    const data = await fetchEarningsData();
    res.json({ success: true, message: 'Data refreshed successfully', count: data.length });
});

// Start the server
async function startServer() {
    await initializeData();
    
    app.listen(config.port, () => {
        console.log(`Earnings Calendar server running on port ${config.port}`);
        console.log(`Access the data at http://localhost:${config.port}/api/earnings`);
    });
}

// Sample data function
function getSampleData() {
    // Current date for dynamic subtitle
    const today = new Date();
    
    return [
        {
            "value": "The Most Anticipated Earnings Releases",
            "title": "",
            "subtitle": `for the period beginning ${today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`
        },
        {
            "value": "(only showing confirmed release dates)",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Monday - 14",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "AMEX",
            "title": "American Express",
            "subtitle": "Est. EPS: $2.45"
        },
        {
            "value": "MTB",
            "title": "M&T Bank",
            "subtitle": "Est. EPS: $3.12"
        },
        {
            "value": "FBK",
            "title": "First Bank",
            "subtitle": "Est. EPS: $0.78"
        },
        {
            "value": "PNFP",
            "title": "Pinnacle Financial",
            "subtitle": "Est. EPS: $1.65"
        },
        {
            "value": "KSTR",
            "title": "Kestra Financial",
            "subtitle": "Est. EPS: $0.92"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Tuesday - 15",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "BAC",
            "title": "Bank of America",
            "subtitle": "Est. EPS: $0.82"
        },
        {
            "value": "UAL",
            "title": "United Airlines",
            "subtitle": "Est. EPS: $2.34"
        },
        {
            "value": "C",
            "title": "Citigroup",
            "subtitle": "Est. EPS: $1.42"
        },
        {
            "value": "JNJ",
            "title": "Johnson & Johnson",
            "subtitle": "Est. EPS: $2.75"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Wednesday - 16",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "ASML",
            "title": "ASML Holding",
            "subtitle": "Est. EPS: $3.54"
        },
        {
            "value": "AA",
            "title": "Alcoa",
            "subtitle": "Est. EPS: $0.22"
        },
        {
            "value": "PGR",
            "title": "Progressive",
            "subtitle": "Est. EPS: $2.40"
        },
        {
            "value": "ABT",
            "title": "Abbott Laboratories",
            "subtitle": "Est. EPS: $1.12"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Thursday - 17",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "NFLX",
            "title": "Netflix",
            "subtitle": "Est. EPS: $4.72"
        },
        {
            "value": "TSM",
            "title": "Taiwan Semiconductor",
            "subtitle": "Est. EPS: $1.32"
        },
        {
            "value": "UNH",
            "title": "UnitedHealth Group",
            "subtitle": "Est. EPS: $6.68"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Friday - 18",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "ALLY",
            "title": "Ally Financial",
            "subtitle": "Est. EPS: $0.54"
        },
        {
            "value": "DHI",
            "title": "D.R. Horton",
            "subtitle": "Est. EPS: $3.24"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Monday - 21",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "AZZ",
            "title": "AZZ Inc",
            "subtitle": "Est. EPS: $0.92"
        },
        {
            "value": "AGNC",
            "title": "AGNC Investment",
            "subtitle": "Est. EPS: $0.54"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Tuesday - 22",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "TSLA",
            "title": "Tesla",
            "subtitle": "Est. EPS: $0.67"
        },
        {
            "value": "VZ",
            "title": "Verizon",
            "subtitle": "Est. EPS: $1.18"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Wednesday - 23",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "IBM",
            "title": "IBM",
            "subtitle": "Est. EPS: $1.58"
        },
        {
            "value": "T",
            "title": "AT&T",
            "subtitle": "Est. EPS: $0.57"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Thursday - 24",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "INTC",
            "title": "Intel",
            "subtitle": "Est. EPS: $0.13"
        },
        {
            "value": "MS",
            "title": "Morgan Stanley",
            "subtitle": "Est. EPS: $1.72"
        },
        {
            "value": "---",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "Friday - 25",
            "title": "",
            "subtitle": ""
        },
        {
            "value": "CVX",
            "title": "Chevron",
            "subtitle": "Est. EPS: $3.05"
        },
        {
            "value": "XOM",
            "title": "Exxon Mobil",
            "subtitle": "Est. EPS: $2.12"
        }
    ];
}

startServer();
