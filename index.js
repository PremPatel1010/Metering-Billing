import 'dotenv/config';
import express from 'express';
import morgan from 'morgan';

import webhooksRouter from './src/routes/webhooks.js';
import generateRouter from './src/routes/generate.js';
import usageRouter from './src/routes/usage.js';
import checkoutRouter from './src/routes/checkout.js';
import { startUsageRollupJob } from './src/jobs/usageRollupJob.js';

const app = express();
const PORT = process.env.PORT || 3000;

// Stripe signature verification requires the RAW request body. Register the
// webhook router BEFORE the global express.json() parser, otherwise the body
// is parsed into a JS object and the original signed bytes are lost.
app.use(webhooksRouter);

app.use(express.json());
app.use(morgan('dev'));

app.get('/', (req, res) => {
  res.json({
    service: 'Usage Metering & Billing Engine',
    endpoints: [
      'POST /generate',
      'GET /usage/:tenantId',
      'POST /checkout',
      'POST /webhooks/stripe',
    ],
  });
});

app.use('/', generateRouter);
app.use('/', usageRouter);
app.use('/', checkoutRouter);

app.use((req, res) => {
  res.status(404).json({
    error: 'Not Found',
    message: `No route for ${req.method} ${req.path}`,
  });
});

app.use((err, req, res, next) => {
  const status = err.status ?? err.statusCode ?? 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: 'Bad Request', message: err.message, status });
});

app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
  startUsageRollupJob();
});