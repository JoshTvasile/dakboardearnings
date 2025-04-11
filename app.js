// Import required modules
const express = require('express');
const fetch = require('node-fetch');
const cron = require('node-cron');
const fs = require('fs');
const path = require('path');

// Configuration
const config = {
    port: process.env.PORT || 3000,
    apiKey: wB2WppJXL6r6L4s8DjnXrrAA5ZySXgx1, // 
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
        const response = await fetch(url);
        const data = await response.json();
        
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
        return cachedData; // Return cached data on error
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
        cachedData = []; // Initialize with empty array on error
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

startServer();
