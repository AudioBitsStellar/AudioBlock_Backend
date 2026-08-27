import { CorsOptions } from 'cors';

const isProduction = process.env.NODE_ENV === 'production';

function parseOrigins(): string[] {
  const raw = process.env.ALLOWED_ORIGINS || '';
  if (!raw) {
    if (isProduction) {
      return [];
    }
    return ['http://localhost:3000', 'http://localhost:3001', 'http://127.0.0.1:5500'];
  }

  const origins = raw
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean);

  if (isProduction && origins.some((o) => o === '*' || o.includes('*'))) {
    throw new Error(
      'Wildcard origins are not allowed in production. Set explicit ALLOWED_ORIGINS.',
    );
  }

  return origins;
}

export const allowedOrigins = parseOrigins();

export function originIsAllowed(origin: string | undefined): boolean {
  if (!origin) return false;
  if (!isProduction && allowedOrigins.length === 0) return true;
  return allowedOrigins.includes(origin);
}

export const corsOptions: CorsOptions = {
  origin: (origin, callback) => {
    if (!origin || originIsAllowed(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Origin not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-ID'],
  exposedHeaders: ['X-Request-ID'],
  maxAge: 86400,
};
