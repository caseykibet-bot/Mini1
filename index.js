const express = require('express');
const app = express();
const __path = process.cwd();
const bodyParser = require("body-parser");
const fs = require('fs');
const path = require('path');
const rateLimit = require('express-rate-limit');
const helmet = require('helmet');
const compression = require('compression');

// Increase maximum event listeners
require('events').EventEmitter.defaultMaxListeners = 1000;

const PORT = process.env.PORT || 8000;
const HOST = process.env.HOST || '0.0.0.0';

// Import routes
let code = require('./pair');

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      scriptSrc: ["'self'", "https://cdnjs.cloudflare.com"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
  crossOriginEmbedderPolicy: false
}));

// Compression middleware
app.use(compression());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 1000, // limit each IP to 1000 requests per windowMs
  message: 'Too many requests from this IP, please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});
app.use(limiter);

// Body parser middleware with increased limits for handling larger payloads
app.use(bodyParser.json({ 
  limit: '50mb', // Increased from default 100kb
  verify: (req, res, buf) => {
    try {
      JSON.parse(buf);
    } catch (e) {
      res.status(400).json({ error: 'Invalid JSON' });
    }
  }
}));

app.use(bodyParser.urlencoded({ 
  limit: '50mb', // Increased from default 100kb
  extended: true,
  parameterLimit: 100000 // Increased parameter limit
}));

// Static file serving with cache control
app.use(express.static(__path, {
  maxAge: '1d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) {
      res.setHeader('Cache-Control', 'no-cache');
    }
  }
}));

// Enhanced error handling middleware
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Route handlers with improved error handling
app.use('/code', code);

app.use('/pair', async (req, res, next) => {
  try {
    const filePath = path.join(__path, 'pair.html');
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    next(error);
  }
});

app.use('/', async (req, res, next) => {
  try {
    const filePath = path.join(__path, 'main.html');
    if (fs.existsSync(filePath)) {
      res.sendFile(filePath);
    } else {
      res.status(404).json({ error: 'File not found' });
    }
  } catch (error) {
    next(error);
  }
});

// 404 handler for undefined routes
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Server setup with enhanced event listeners
const server = app.listen(PORT, HOST, () => {
  console.log(`
██████╗ ███████╗██╗   ██╗███████╗███████╗███████╗
██╔══██╗██╔════╝██║   ██║██╔════╝██╔════╝██╔════╝
██████╔╝█████╗  ██║   ██║███████╗███████╗███████╗
██╔══██╗██╔══╝  ██║   ██║╚════██║╚════██║╚════██║
██║  ██║███████╗╚██████╔╝███████║███████║███████║
╚═╝  ╚═╝╚══════╝ ╚═════╝ ╚══════╝╚══════╝╚══════╝

Server running on http://${HOST}:${PORT}
Don't Forget To Give Star ‼️
Made By Casey Rhodes 
  `);
});

// Enhanced server event listeners
server.on('connection', (socket) => {
  console.log(`New connection from: ${socket.remoteAddress}:${socket.remotePort}`);
  
  // Set timeout for idle connections
  socket.setTimeout(30 * 60 * 1000); // 30 minutes
  
  socket.on('timeout', () => {
    console.log(`Socket timeout from: ${socket.remoteAddress}`);
    socket.end();
  });
  
  socket.on('error', (err) => {
    console.error('Socket error:', err.message);
  });
});

server.on('error', (err) => {
  console.error('Server error:', err);
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use`);
    process.exit(1);
  }
});

server.on('close', () => {
  console.log('Server closed');
});

// Graceful shutdown handling
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
  
  // Force close after 10 seconds
  setTimeout(() => {
    console.error('Could not close connections in time, forcefully shutting down');
    process.exit(1);
  }, 10000);
});

process.on('SIGTERM', () => {
  console.log('\nReceived SIGTERM. Shutting down gracefully...');
  server.close(() => {
    console.log('HTTP server closed.');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

module.exports = app;
