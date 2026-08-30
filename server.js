const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Discord webhook from environment variable
const DISCORD_WEBHOOK_URL = process.env.DISCORD_WEBHOOK_URL;

// Middleware
app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Log file path
const LOG_DIR = path.join(__dirname, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'log.json');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Get client IP from various headers
function getClientIP(req) {
  // Check for forwarded headers
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded) {
    // Get the first IP in the list (the real client IP)
    return forwarded.split(',')[0].trim();
  }
  
  // Check for real IP header
  const realIP = req.headers['x-real-ip'];
  if (realIP) {
    return realIP;
  }
  
  // Fallback to request IP
  return req.ip || req.connection.remoteAddress || 'Unknown';
}

// Get all request headers (useful for logging)
function getRequestInfo(req) {
  return {
    ip: getClientIP(req),
    userAgent: req.headers['user-agent'] || 'Unknown',
    referer: req.headers['referer'] || 'Unknown',
    origin: req.headers['origin'] || 'Unknown',
    accept: req.headers['accept'] || 'Unknown',
    acceptLanguage: req.headers['accept-language'] || 'Unknown',
    connection: req.headers['connection'] || 'Unknown',
    timestamp: new Date().toISOString(),
    method: req.method,
    url: req.url,
    headers: req.headers
  };
}

// Send to Discord webhook
async function sendToDiscord(data) {
  if (!DISCORD_WEBHOOK_URL) {
    console.log('Discord webhook not configured, skipping Discord notification');
    return;
  }
  
  try {
    const embedFields = [];
    
    // Add IP info
    if (data.clientInfo) {
      embedFields.push({
        name: "IP Address",
        value: `\`${data.clientInfo.ip}\``,
        inline: true
      });
    }
    
    // Add user data from body
    if (data.action) {
      embedFields.push({
        name: "Action",
        value: `\`${data.action}\``,
        inline: false
      });
    }
    
    if (data.browser) {
      embedFields.push({
        name: "Browser",
        value: `\`${data.browser}\``,
        inline: true
      });
    }
    
    if (data.os) {
      embedFields.push({
        name: "OS",
        value: `\`${data.os}\``,
        inline: true
      });
    }
    
    if (data.url) {
      embedFields.push({
        name: "URL",
        value: `\`${data.url}\``,
        inline: false
      });
    }
    
    // Add location info
    if (data.ipInfo) {
      if (data.ipInfo.city) {
        embedFields.push({
          name: "Location",
          value: `${data.ipInfo.city}, ${data.ipInfo.country || 'Unknown'}`,
          inline: true
        });
      }
      
      if (data.ipInfo.org) {
        embedFields.push({
          name: "ISP/Org",
          value: `\`${data.ipInfo.org}\``,
          inline: true
        });
      }
      
      if (data.ipInfo.timezone) {
        embedFields.push({
          name: "Timezone",
          value: `\`${data.ipInfo.timezone}\``,
          inline: true
        });
      }
    }
    
    // Add user agent
    if (data.clientInfo && data.clientInfo.userAgent) {
      embedFields.push({
        name: "User Agent",
        value: `\`${data.clientInfo.userAgent}\``,
        inline: false
      });
    }
    
    // Add timestamp
    embedFields.push({
      name: "Timestamp",
      value: `\`${data.serverReceived}\``,
      inline: false
    });
    
    const embed = {
      title: "AutoBuyVolts Log",
      description: "**User activity detected**",
      color: 0x6369f2,
      fields: embedFields,
      timestamp: new Date().toISOString(),
      footer: {
        text: "AutoBuyVolts Logger"
      }
    };
    
    const payload = {
      username: "AutoBuyVolts",
      embeds: [embed]
    };
    
    await axios.post(DISCORD_WEBHOOK_URL, payload);
    console.log('Discord notification sent successfully');
  } catch (error) {
    console.error('Failed to send Discord notification:', error.message);
  }
}

// Main logging endpoint
app.post('/log', async (req, res) => {
  const clientIP = getClientIP(req);
  const requestInfo = getRequestInfo(req);
  
  // Combine body data with request info
  const logData = {
    ...req.body,
    serverReceived: new Date().toISOString(),
    clientInfo: {
      ip: clientIP,
      userAgent: requestInfo.userAgent,
      referer: requestInfo.referer,
      origin: requestInfo.origin,
      acceptLanguage: requestInfo.acceptLanguage,
      connection: requestInfo.connection
    },
    requestInfo: {
      method: requestInfo.method,
      url: requestInfo.url,
      timestamp: requestInfo.timestamp
    }
  };
  
  // Save to file
  const fileData = [];
  if (fs.existsSync(LOG_FILE)) {
    try {
      const existing = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
      fileData.push(...existing);
    } catch (e) {
      // If file is corrupted, start fresh
    }
  }
  
  fileData.push(logData);
  
  // Keep only last 1000 entries
  const trimmedData = fileData.slice(-1000);
  
  fs.writeFileSync(LOG_FILE, JSON.stringify(trimmedData, null, 2));
  
  // Log to console
  console.log('========================================');
  console.log('New log entry received:');
  console.log('IP:', clientIP);
  console.log('User Agent:', requestInfo.userAgent);
  console.log('Action:', req.body.action || 'Unknown');
  console.log('========================================');
  
  // Send to Discord if configured
  await sendToDiscord(logData);
  
  // Send response
  res.json({
    success: true,
    message: 'Log received',
    ip: clientIP,
    timestamp: logData.serverReceived
  });
});

// Simple IP logging endpoint
app.post('/ip', (req, res) => {
  const clientIP = getClientIP(req);
  
  console.log('IP logged:', clientIP);
  
  res.json({
    success: true,
    ip: clientIP,
    timestamp: new Date().toISOString()
  });
});

// Get all logs endpoint (protected)
app.get('/logs', (req, res) => {
  if (fs.existsSync(LOG_FILE)) {
    const data = JSON.parse(fs.readFileSync(LOG_FILE, 'utf8'));
    res.json({
      success: true,
      count: data.length,
      logs: data
    });
  } else {
    res.json({
      success: true,
      count: 0,
      logs: []
    });
  }
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptime: process.uptime(),
    timestamp: new Date().toISOString()
  });
});

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'AutoBuyVolts Logger Server',
    version: '2.0.0',
    status: 'running',
    endpoints: ['/log', '/ip', '/logs', '/health']
  });
});

// Catch all 404
app.use((req, res) => {
  res.status(404).json({
    error: 'Not found',
    path: req.url
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`AutoBuyVolts Logger Server running on port ${PORT}`);
  console.log('Endpoints:');
  console.log('  POST /log - Log user data');
  console.log('  POST /ip - Log IP only');
  console.log('  GET /logs - View all logs');
  console.log('  GET /health - Health check');
  console.log(`Discord webhook configured: ${DISCORD_WEBHOOK_URL ? 'YES' : 'NO'}`);
});
