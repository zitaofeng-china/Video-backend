require('dotenv').config();

const { checkEnvironment } = require('./utils/envCheck');
checkEnvironment();

const express = require('express');
const { createServer } = require('http');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');

const connectDB = require('./config/database');
const { initWebSocket } = require('./websocket/websocketHandler');
const { notFound, errorHandler, handleValidationError } = require('./middleware/errorHandler');

const authRoutes = require('./routes/authRoutes');
const faceRoutes = require('./routes/faceRoutes');
const emailRoutes = require('./routes/emailRoutes');

const app = express();
const server = createServer(app);

connectDB();

app.use(helmet());
app.use(compression());
app.use(morgan('dev'));

app.use(cors({
  origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: 'Too many requests. Please try again later.'
});
app.use('/api/', limiter);

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV
  });
});

app.use('/api/auth', authRoutes);
app.use('/api/face', faceRoutes);
app.use('/api/email', emailRoutes);

app.use(handleValidationError);
app.use(notFound);
app.use(errorHandler);

initWebSocket(server);

const PORT = process.env.PORT || 6060;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running at http://0.0.0.0:${PORT}`);
  console.log('WebSocket server initialized');
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
});

process.on('SIGINT', () => {
  console.log('\nShutting down server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('unhandledRejection', (err) => {
  console.error('Unhandled promise rejection:', err);
  server.close(() => process.exit(1));
});
