import express from 'express';
import cors from 'cors';
import helmet from 'helmet';

import { requireAuth } from './middleware/auth.js';
import meRoutes from './routes/me.js';
import generateRoutes from './routes/generate.js';
import assistantRoutes from './routes/assistant.js';
import imageRoutes from './routes/images.js';
import documentRoutes from './routes/documents.js';
import knowledgeRoutes from './routes/knowledge.js';
import promptRoutes from './routes/prompts.js';
import templateRoutes from './routes/templates.js';
import contentRoutes from './routes/content.js';
import analyticsRoutes from './routes/analytics.js';
import settingsRoutes from './routes/settings.js';
import adminRoutes from './routes/admin.js';

const app = express();

const allowed = (process.env.FRONTEND_URL || 'http://localhost:3000')
  .split(',')
  .map((s) => s.trim().replace(/\/$/, ''))
  .filter(Boolean);

app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(
  cors({
    origin(origin, cb) {
      if (!origin || allowed.includes('*') || allowed.includes(origin)) return cb(null, true);
      // Allow Vercel preview deployments of the frontend project
      if (process.env.ALLOW_VERCEL_PREVIEWS === 'true' && /\.vercel\.app$/.test(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} not allowed by CORS`));
    },
    credentials: true,
  })
);
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => res.json({ name: 'ContentScale API', status: 'ok' }));
app.get('/api/health', (_req, res) =>
  res.json({
    status: 'ok',
    time: new Date().toISOString(),
    supabase: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
  })
);

app.use('/api', requireAuth);
app.use('/api/me', meRoutes);
app.use('/api/generate', generateRoutes);
app.use('/api/assistant', assistantRoutes);
app.use('/api/images', imageRoutes);
app.use('/api/documents', documentRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/prompts', promptRoutes);
app.use('/api/templates', templateRoutes);
app.use('/api/content', contentRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', adminRoutes);

app.use((req, res) => res.status(404).json({ error: `Not found: ${req.method} ${req.path}` }));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 500);
  if (status >= 500) console.error(err);
  if (res.headersSent) return res.end();
  res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? 'File is too large (max 4 MB).' : err.message || 'Server error' });
});

export default app;
