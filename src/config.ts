function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required env var: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] || fallback;
}

export const config = {
  port: parseInt(optional('PORT', '3000'), 10),
  databaseUrl: required('DATABASE_URL'),
  sessionSecret: optional('SESSION_SECRET', 'dev-secret-change-me'),
  google: {
    clientId: required('GOOGLE_CLIENT_ID'),
    clientSecret: required('GOOGLE_CLIENT_SECRET'),
    redirectUri: required('GOOGLE_REDIRECT_URI'),
  },
  allowedEmail: required('ALLOWED_ADMIN_EMAIL'),
  apiKey: required('MCLIPPY_API_KEY'),
  publicUrl: optional('PUBLIC_URL', 'http://localhost:3000'),
  maxFileSize: 25 * 1024 * 1024, // 25MB
};
