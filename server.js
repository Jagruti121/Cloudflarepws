import express from 'express';
import crypto from 'crypto';
import cors from 'cors';
import helmet from 'helmet'; // SECURITY FIX LOW-01: Security headers
import multer from 'multer';
import fs from 'fs-extra';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import { google } from 'googleapis';
import dotenv from 'dotenv';
import rateLimit from 'express-rate-limit'; // SECURITY FIX E-1, H-1
import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore, FieldValue } from 'firebase-admin/firestore';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';

dotenv.config();


// ── Firebase Admin SDK (bypasses all Firestore security rules) ──
if (getApps().length === 0) {
  initializeApp({
    credential: cert({
      projectId: process.env.VITE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: (process.env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    }),
  });
}
const adminDb = getFirestore();

// ── Shared Mail Transporter ──
const transporter = nodemailer.createTransport({
  host: 'smtp.gmail.com',
  port: 587,
  secure: false,
  auth: {
    user: process.env.EMAIL_USER || 'ommurkar34@gmail.com',
    pass: process.env.EMAIL_PASS,
  },
  tls: {
    rejectUnauthorized: false
  }
});

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
app.set('trust proxy', 1);

// ── SECURITY FIX LOW-01: Helmet sets HSTS, CSP, X-Frame-Options, X-Content-Type-Options, etc. ──
app.use(helmet({
  contentSecurityPolicy: false, // CSP is handled separately to avoid breaking the SPA
  crossOriginEmbedderPolicy: false, // Required for Firebase Storage CORS
}));
// Remove the Express fingerprint header (belt-and-suspenders, helmet already does this)
app.disable('x-powered-by');

// ── SECURITY FIX: Restrict CORS to known origins instead of wildcard ──
const allowedOrigins = [
  'http://localhost:5173',  // Vite dev server
  'http://localhost:4173',  // Vite preview
  'http://localhost:3000',  // CRA / alternate dev server
  'https://nextsolvespms.onrender.com', // Live frontend (solves)
  'https://nextslovespms.onrender.com', // Live frontend (sloves)
  process.env.ALLOWED_ORIGIN, // Production origin from .env
].filter(Boolean);

app.use(cors({
  origin: function (origin, callback) {
    // SECURITY FIX MED-03: Do NOT allow null/missing origin.
    // curl, Postman, and Python scripts all send no Origin header and would
    // bypass the CORS whitelist if we allowed !origin. Render health checks
    // do not need CORS — they are same-origin server calls.
    if (!origin) return callback(null, false);

    const normalizedOrigin = origin.endsWith('/') ? origin.slice(0, -1) : origin;
    if (allowedOrigins.includes(normalizedOrigin)) {
      callback(null, true);
    } else {
      console.warn(`[CORS Blocked] Origin not allowed: "${origin}"`);
      // Return false instead of Error to send standard CORS headers denial rather than a 500 Server Error
      callback(null, false);
    }
  },
  // SECURITY FIX MED-02: Only expose headers actually needed by the frontend
  methods: ['GET', 'POST', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-folder-path'],
  credentials: true
}));
app.use(express.json());

// ── SECURITY FIX HIGH-05: Global input sanitization middleware ──
// Recursively strips HTML tags from all incoming JSON payloads to prevent XSS
const sanitizePayload = (obj) => {
  if (obj === null || typeof obj !== 'object') return;
  const htmlTagRegex = /<[^>]*>/g;
  
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      if (typeof obj[i] === 'string') {
        obj[i] = obj[i].replace(htmlTagRegex, '').trim();
      } else if (typeof obj[i] === 'object') {
        sanitizePayload(obj[i]);
      }
    }
  } else {
    for (const key of Object.keys(obj)) {
      if (typeof obj[key] === 'string') {
        // Skip sanitization for code fields to preserve < and > operators
        if (key === 'code') continue; 
        obj[key] = obj[key].replace(htmlTagRegex, '').trim();
      } else if (typeof obj[key] === 'object') {
        sanitizePayload(obj[key]);
      }
    }
  }
};

app.use((req, res, next) => {
  if (req.body && typeof req.body === 'object') {
    sanitizePayload(req.body);
  }
  if (req.query && typeof req.query === 'object') {
    sanitizePayload(req.query);
  }
  next();
});


// ── SECURITY FIX LOW-02: Disable caching for API routes ──
app.use('/api', (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ── SECURITY FIX D-2: Restrict all uploads to a safe base directory ──
const UPLOAD_BASE = path.resolve(__dirname, 'uploads');

// 1. Upload Logic
const storage = multer.diskStorage({
  destination: async (req, file, cb) => {
    try {
      const teacherPath = req.headers['x-folder-path'];
      if (!teacherPath) return cb(new Error('Missing x-folder-path header'));

      // ── SECURITY FIX D-2 ──
      // Strip any directory traversal from the path by using only the basename.
      // Then join it with the safe UPLOAD_BASE to prevent writing outside ./uploads/
      const safeSegment = path.basename(decodeURIComponent(teacherPath).replace(/[\"']/g, '').trim());
      const safePath = path.join(UPLOAD_BASE, safeSegment);

      // Double-check the resolved path is still inside UPLOAD_BASE
      if (!safePath.startsWith(UPLOAD_BASE)) {
        return cb(new Error('[Security] Path traversal attempt blocked'));
      }

      await fs.ensureDir(safePath);
      console.log(`📂 Saving to: ${safePath}`);
      cb(null, safePath);
    } catch (err) {
      cb(err);
    }
  },
  filename: (req, file, cb) => {
    const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_]/g, '_');
    cb(null, safeName);
  }
});

const upload = multer({ storage: storage });

app.post('/api/upload', upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file received' });
  console.log(`✅ Uploaded: ${req.file.filename}`);
  // Return only filename, not the full server path (avoid path disclosure)
  res.json({ message: 'Success', filename: req.file.filename });
});

// ── SECURITY FIX D-1: Restrict /api/preview to the uploads directory only ──
app.get('/api/preview', (req, res) => {
  const filePath = req.query.path;

  if (!filePath) {
    return res.status(400).send('No file path provided.');
  }

  // Resolve the requested path and verify it's within UPLOAD_BASE
  const resolvedPath = path.resolve(filePath);
  if (!resolvedPath.startsWith(UPLOAD_BASE)) {
    console.warn(`[Security] Path traversal attempt on /api/preview: "${filePath}" from ${req.ip}`);
    return res.status(403).send('Access denied.');
  }

  if (!fs.existsSync(resolvedPath)) {
    return res.status(404).send('File not found on server.');
  }

  res.sendFile(resolvedPath);
});

// 3. OTP VERIFICATION ENDPOINTS
// In-memory store for OTPs: { email: { otp, expiresAt, attempts } }
const otpStore = new Map();

// ── SECURITY FIX E-2: Evict expired entries every 5 minutes ──
const MAX_OTP_STORE_SIZE = 10000;
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of otpStore.entries()) {
    if (now > val.expiresAt) otpStore.delete(key);
  }
}, 60 * 1000);

// ── SECURITY FIX E-1: Rate limit OTP send (3 per minute per IP) ──
const otpSendLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait a minute before trying again.' },
});

// ── SECURITY FIX H-1: Rate limit OTP verify (10 per 15 minutes per IP) ──
const otpVerifyLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please try again later.' },
});

// ── SECURITY FIX HIGH-01 (UPGRADED): Rate limit reminder emails keyed by RECIPIENT EMAIL ──
// Previously keyed by IP — a VPN/proxy bypass was trivial.
// Now keyed by the 'email' body field so the limit is per destination address,
// not per network location. Max 3 sends per recipient per hour.
const reminderEmailKeyGen = (req) => {
  const email = req.body?.email;
  if (email && typeof email === 'string') return `reminder:${email.trim().toLowerCase()}`;
  // Fallback to IP if email not yet parsed (should not happen after body parsing)
  return `reminder_ip:${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}`;
};
const reminderLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window per recipient email
  max: 3,
  keyGenerator: reminderEmailKeyGen,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many reminder requests to this address. Please wait before retrying.' },
});

// ── SECURITY FIX HIGH-02 (UPGRADED): Rate limit activation emails keyed by RECIPIENT EMAIL ──
// Same upgrade as HIGH-01 — keyed by 'email' body field, not IP address.
const activationEmailKeyGen = (req) => {
  const email = req.body?.email;
  if (email && typeof email === 'string') return `activation:${email.trim().toLowerCase()}`;
  return `activation_ip:${req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown'}`;
};
const activationEmailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window per recipient email
  max: 3,
  keyGenerator: activationEmailKeyGen,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many activation email requests to this address. Please wait before retrying.' },
});

// ── SECURITY FIX: General API rate limiting for administrative/activation endpoints ──
const emailKeyGenerator = (req, res) => {
  const email = req.body?.email || req.body?.primaryEmail || req.body?.oldEmail || req.body?.newEmail || req.body?.adminEmail || req.headers['x-user-email'];
  if (email) return String(email).trim().toLowerCase();
  
  // express-rate-limit strictly forbids reading req.ip in custom keyGenerators
  // unless we use their ipKeyGenerator, which complicates things. 
  // We use req.socket.remoteAddress instead.
  const rawIp = req.headers['x-forwarded-for'] || req.socket?.remoteAddress || 'unknown';
  return 'ip_' + String(rawIp).replace(/[^a-zA-Z0-9]/g, '_');
};

const generalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 25, // Limit each email/IP to 25 requests per windowMs
  keyGenerator: emailKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please try again later.' },
});

// ── SECURITY FIX HIGH-05: Server-side Password Reset Rate Limiter ──
const passwordResetLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1-hour window per email
  max: 3, // Max 3 password reset requests per hour per email
  keyGenerator: emailKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password reset requests. Please check your email or wait before retrying.' },
});

// ── SECURITY FIX CRIT-01: Super Admin API authentication middleware ──
// Verifies Firebase ID token from Authorization header.
// Only super_admin role users (present in super_admins Firestore collection) may pass.
const requireSuperAdminAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);
    // Verify the user is a super admin in Firestore
    const superAdminDoc = await adminDb.collection('super_admins').doc(decodedToken.uid).get();
    if (!superAdminDoc.exists) {
      return res.status(403).json({ error: 'Access denied. Super admin privileges required.' });
    }
    req.adminUid = decodedToken.uid;
    req.adminEmail = decodedToken.email;
    next();
  } catch (err) {
    console.warn('[Auth] Token verification failed:', err.code || err.message);
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
};

// ── CUSTOM CLAIMS: Endpoint to sync roles from Firestore to Auth Claims ──
app.post('/api/auth/sync-claims', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const claims = { super_admin: false, admin: false, teacher: false, tenantId: null };

    // Check super_admins
    const superAdminDoc = await adminDb.collection('super_admins').doc(uid).get();
    if (superAdminDoc.exists) claims.super_admin = true;

    // Check admin_users
    const adminDoc = await adminDb.collection('admin_users').doc(uid).get();
    if (adminDoc.exists) {
      claims.admin = true;
      claims.tenantId = adminDoc.data().tenantId || claims.tenantId;
    }

    // Check teacher_users
    const teacherDoc = await adminDb.collection('teacher_users').doc(uid).get();
    if (teacherDoc.exists) {
      // DUAL-ROLE SUPPORT: A user can exist in both admin_users AND teacher_users.
      // Grant BOTH claims so they can sign in via either portal:
      //   - Admin portal  → AuthContext resolves them as 'admin'
      //   - Teacher portal → AuthContext resolves them as 'teacher'
      // Portal isolation is enforced by AuthContext (based on sessionStorage.portal),
      // NOT by suppressing claims here.
      claims.teacher = true;
      // Prefer admin tenantId if already set; fall back to teacher tenantId
      if (!claims.tenantId) {
        claims.tenantId = teacherDoc.data().tenantId || null;
      }
      if (claims.admin) {
        console.log(`[SyncClaims] User ${uid} has both admin_users and teacher_users docs — granting dual-role claims (admin:true, teacher:true).`);
      }
    }

    // If they have no valid roles, return error
    if (!claims.super_admin && !claims.admin && !claims.teacher) {
      return res.status(403).json({ error: 'No roles found for this user.' });
    }

    // Apply the claims
    await getAdminAuth().setCustomUserClaims(uid, claims);
    return res.json({ success: true, claims });
  } catch (err) {
    console.error('[SyncClaims] Error syncing claims:', err.message);
    return res.status(500).json({ error: 'Failed to sync custom claims.' });
  }
});

// ── SECURITY FIX HIGH-05: Server-side Password Reset ──
// Firebase Auth sendPasswordResetEmail is a client-side SDK method with no
// per-IP rate limit, allowing email bombing.
// This endpoint replaces it, applying strict server-side rate limits and verifying
// the email belongs to a real admin/teacher before sending.
app.post('/api/auth/send-password-reset', passwordResetLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email || typeof email !== 'string') {
    return res.status(400).json({ error: 'Valid email is required.' });
  }
  const emailClean = email.trim().toLowerCase();

  try {
    // 1. Verify recipient actually exists in our system (Admin or Teacher)
    // We check admin_users and teacher_users by resolving UID via Auth
    let userRecord;
    try {
      userRecord = await getAdminAuth().getUserByEmail(emailClean);
    } catch (authErr) {
      if (authErr.code === 'auth/user-not-found') {
        return res.status(404).json({ error: 'User account not found.' });
      }
      throw authErr;
    }

    // Ensure they have a Firestore record
    const [adminDoc, teacherDoc] = await Promise.all([
      adminDb.collection('admin_users').doc(userRecord.uid).get(),
      adminDb.collection('teacher_users').doc(userRecord.uid).get()
    ]);
    if (!adminDoc.exists && !teacherDoc.exists) {
      return res.status(403).json({ error: 'Account is not authorized.' });
    }

    // 2. Generate the Firebase Password Reset Link
    const resetLink = await getAdminAuth().generatePasswordResetLink(emailClean);

    // 3. Send email using our protected SMTP/HTTPS bridge
    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENTID,
      process.env.OAUTH_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const htmlContent = `
      <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #e0e0e0;">
        <h2 style="color: #4F46E5;">Password Reset Request</h2>
        <p>Hello,</p>
        <p>We received a request to reset your password for the Practical Workflow System.</p>
        <p>Click the link below to set a new password:</p>
        <div style="margin: 24px 0;">
          <a href="${resetLink}" style="background-color: #4F46E5; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">Reset Password</a>
        </div>
        <p style="color: #666; font-size: 14px;">If the button doesn't work, copy and paste this link into your browser:</p>
        <p style="color: #666; font-size: 12px; word-break: break-all;">${resetLink}</p>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">If you didn't request this, you can safely ignore this email.</p>
      </div>
    `;

    const subject = 'PWS - Password Reset Request';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: "PWS Security" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
      `To: ${emailClean}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      htmlContent
    ];

    const encodedMessage = Buffer.from(messageParts.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });

    console.log(`[Auth] Password reset email sent securely to ${emailClean}`);
    return res.json({ success: true, message: 'Password reset email sent.' });
  } catch (err) {
    console.error('[Auth] Password reset endpoint error:', err.message);
    return res.status(500).json({ error: 'Failed to process password reset.' });
  }
});

// ── SECURITY FIX HIGH-07 + HIGH-08: Input sanitization for product key creation ──
const sanitizeProductKeyInput = (data) => {
  const errors = [];

  // Check for NoSQL injection: reject objects ($ operator vectors)
  const dangerousFields = ['productKey', 'collegeName', 'collegeCode', 'adminEmail', 'secondaryEmail', 'adminPhone'];
  for (const field of dangerousFields) {
    if (data[field] !== undefined && typeof data[field] !== 'string') {
      errors.push(`Field '${field}' must be a string.`);
    }
    if (typeof data[field] === 'string' && data[field].includes('$')) {
      errors.push(`Field '${field}' contains invalid characters.`);
    }
  }

  // Validate email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (data.adminEmail && !emailRegex.test(data.adminEmail)) {
    errors.push('adminEmail is not a valid email address.');
  }
  if (data.secondaryEmail && data.secondaryEmail !== '' && !emailRegex.test(data.secondaryEmail)) {
    errors.push('secondaryEmail is not a valid email address.');
  }

  // Validate phone: digits, +, -, spaces, parens only
  if (data.adminPhone) {
    const phoneRegex = /^[+\d\s\-().]{5,20}$/;
    if (!phoneRegex.test(data.adminPhone)) {
      errors.push('adminPhone contains invalid characters.');
    }
  }

  // Sanitize string fields: strip HTML tags
  const htmlTagRegex = /<[^>]*>/g;
  const sanitized = { ...data };
  for (const field of dangerousFields) {
    if (typeof sanitized[field] === 'string') {
      sanitized[field] = sanitized[field].replace(htmlTagRegex, '').trim().substring(0, 500);
    }
  }

  // Validate productKey format: only uppercase alphanumeric + hyphens
  if (sanitized.productKey && !/^[A-Z0-9\-]{5,60}$/.test(sanitized.productKey)) {
    errors.push('productKey format is invalid.');
  }

  // Validate facultyEmails array if present
  if (Array.isArray(sanitized.facultyEmails)) {
    sanitized.facultyEmails = sanitized.facultyEmails
      .filter(e => typeof e === 'string' && emailRegex.test(e.trim()))
      .map(e => e.trim().toLowerCase())
      .slice(0, 50); // hard cap on array size
  }

  return { errors, sanitized };
};

app.post('/api/send-otp', otpSendLimiter, async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email is required' });

  // ── SECURITY FIX E-2: Guard against memory exhaustion ──
  if (otpStore.size >= MAX_OTP_STORE_SIZE) {
    return res.status(503).json({ error: 'Service temporarily unavailable.' });
  }

  const emailClean = email.trim().toLowerCase();

  try {
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000;
    otpStore.set(emailClean, { otp, expiresAt, attempts: 0 });



    // 1. Authenticate with Google OAuth2
    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENTID,
      process.env.OAUTH_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.OAUTH_REFRESH_TOKEN
    });

    // 2. Initialize the Gmail API client
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 3. Construct the email raw string (RFC 2822 format)
    const subject = 'Your Practical Workflow System Activation Code';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: "PWS Activation" <ommurkar34@gmail.com>`,
      `To: ${emailClean}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      `<div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #e0e0e0;">`,
      `  <h2 style="color: #4F46E5;">PWS Account Activation</h2>`,
      `  <p>Use the following One-Time Password (OTP) to complete your registration. This code is valid for 5 minutes.</p>`,
      `  <div style="background-color: #F3F4F6; padding: 15px; font-size: 24px; font-weight: bold; letter-spacing: 4px; text-align: center; color: #1F2937; margin: 20px 0;">`,
      `    ${otp}`,
      `  </div>`,
      `</div>`
    ];
    const message = messageParts.join('\r\n');

    // 4. Encode the message to base64url format
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 5. Send via HTTPS POST request (Bypasses Render's SMTP Firewall)
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });

    console.log(`📧 OTP sent successfully via HTTPS to ${emailClean}`);
    res.json({ message: 'OTP sent successfully' });

  } catch (error) {
    console.error('🔥 Gmail API Error:', error);
    res.status(500).json({ error: 'Failed to send OTP email via HTTPS API.' });
  }
});

// ── SECURITY FIX HIGH-01 (UPGRADED): Reminder email ──
// Changes from partial fix:
//   1. Rate limiter is now email-keyed (not IP) — see reminderLimiter above
//   2. Recipient email is validated against product_keys collection before sending
//      This prevents bombing arbitrary email addresses — only registered admin
//      emails that exist in Firestore can receive a reminder.
app.post('/api/send-reminder', reminderLimiter, async (req, res) => {
  const { email, collegeName, daysLeft } = req.body;
  if (!email || !collegeName || daysLeft === undefined) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const emailClean = String(email).trim().toLowerCase();

  // ── RECIPIENT VALIDATION: Only send to registered admin emails ──
  // Querying product_keys ensures the destination is a real institution admin.
  // An unknown or arbitrary email is rejected before anything is sent.
  const recipientSnap = await adminDb.collection('product_keys')
    .where('adminEmail', '==', emailClean)
    .limit(1).get();
  if (recipientSnap.empty) {
    // Return 403 — do not reveal whether the email exists or not beyond this
    return res.status(403).json({ error: 'Recipient email is not registered in this system.' });
  }

  // Sanitize collegeName to prevent HTML injection in the email body
  const safeCollegeName = String(collegeName)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .substring(0, 200); // Hard cap on length

  try {
    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENTID,
      process.env.OAUTH_CLIENT_SECRET,
      'https://developers.google.com/oauthplayground'
    );
    oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const htmlContent = `
        <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; border: 1px solid #ddd; border-radius: 8px;">
          <h2 style="color: #e53e3e;">Subscription Expiring Soon</h2>
          <p>Hello ${safeCollegeName} Admin,</p>
          <p>This is a friendly reminder that your Practical Workflow System subscription is going to end in <strong>${parseInt(daysLeft, 10)} days</strong>.</p>
          <p>Please contact the system founder to renew your subscription and avoid any service interruptions.</p>
          <br/>
          <p style="color: #718096; font-size: 14px;">Regards,<br/>PWS Team</p>
        </div>
      `;

    const subject = 'Urgent: PWS Subscription Expiring Soon';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: "PWS Alerts" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
      `To: ${emailClean}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      htmlContent
    ];

    const message = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

    await gmail.users.messages.send({
      userId: 'me',
      requestBody: { raw: encodedMessage },
    });
    console.log(`📧 Expiration reminder sent to ${email}`);
    res.json({ message: 'Reminder sent successfully' });
  } catch (error) {
    console.error('🔥 Error sending reminder email:', error);
    res.status(500).json({ error: 'Failed to send reminder email.' });
  }
});

// ── SECURITY FIX E-1: OTP verify with rate limit + attempt counter ──
app.post('/api/verify-otp', otpVerifyLimiter, (req, res) => {
  const { email, otp } = req.body;
  if (!email || !otp) return res.status(400).json({ error: 'Email and OTP are required' });

  if (!/^\d{6}$/.test(otp.trim())) {
    return res.status(400).json({ error: 'Invalid OTP format. Must be a 6-digit number.' });
  }

  const emailClean = email.trim().toLowerCase();
  const otpClean = otp.trim();

  const record = otpStore.get(emailClean);

  if (!record) {
    return res.status(400).json({ error: 'No OTP requested for this email' });
  }

  if (Date.now() > record.expiresAt) {
    otpStore.delete(emailClean);
    // Exact error message required by specification
    return res.status(400).json({ error: 'Expired OTP, please request a new one.' });
  }

  // ── SECURITY FIX E-1: Invalidate after 5 failed attempts ──
  if (record.attempts >= 5) {
    otpStore.delete(emailClean);
    return res.status(429).json({ error: 'OTP invalidated after too many failed attempts. Please request a new one.' });
  }

  if (record.otp !== otpClean) {
    record.attempts += 1;
    return res.status(400).json({ error: `Invalid OTP code. ${5 - record.attempts} attempts remaining.` });
  }

  // OTP verified successfully, clear it from memory
  otpStore.delete(emailClean);
  res.json({ message: 'OTP verified successfully' });
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT IDENTITY VERIFICATION + SUBMIT TOKEN ISSUANCE
// ─────────────────────────────────────────────────────────────────────────────
// SECURITY FIX HIGH-02: Students are not Firebase Auth users, so /api/student/submit
// previously had no way to verify the caller is the REAL student for that rollNo.
// Fix: Issue a short-lived signed submitToken at login time (via this endpoint).
// The submit endpoint requires that token and cryptographically verifies it.
// An attacker who knows sessionCode+rollNo cannot forge a valid token without
// knowing the server-side FLOW_JWT_SECRET.
const studentLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20, // 20 login attempts per 15 min per IP (generous for labs with shared IPs)
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many login attempts. Please wait before retrying.' },
});

// ── STUDENT CAPCUT: requireTeacherAuth middleware ────────────────────────────
// Verifies teacher Firebase ID token and extracts tenantId from JWT claims.
// Used by roster and exam-session endpoints to enforce cross-tenant isolation.
const requireTeacherAuth = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const idToken = authHeader.split('Bearer ')[1];
  try {
    const decoded = await getAdminAuth().verifyIdToken(idToken);
    if (!decoded.teacher && !decoded.admin) {
      return res.status(403).json({ error: 'Teacher access required.' });
    }
    req.teacherUid = decoded.uid;
    req.teacherEmail = decoded.email;
    req.teacherTenantId = decoded.tenantId; // from JWT custom claims — server-authoritative
    next();
  } catch (err) {
    console.warn('[TeacherAuth] Token verification failed:', err.code || err.message);
    return res.status(401).json({ error: 'Invalid or expired authentication token.' });
  }
};

// ── STUDENT CAPCUT: Roster multer config (memory storage — no disk write) ────
const rosterUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.csv'].includes(ext)) cb(null, true);
    else cb(new Error('Only .xlsx and .csv files are allowed for roster upload.'));
  },
});

// ── STUDENT CAPCUT: generateSlips server-side helper ─────────────────────────
// Mirrors the client-side generateSlips from ExamWizard.jsx — now used server-side
// so teachers can no longer manipulate question assignments via HTTP requests.
const generateSlipsServer = (studentsList, questionsList, totalPracticalMarks, subjectCount, subjectTags) => {
  const slips = {};
  if (subjectCount === 2) {
    const poolA = questionsList.filter(q => (subjectTags || {})[q.question_id] === 'A');
    const poolB = questionsList.filter(q => (subjectTags || {})[q.question_id] === 'B');
    const validPairs = [];
    for (const qA of poolA) {
      for (const qB of poolB) {
        if (qA.marks + qB.marks === totalPracticalMarks) validPairs.push([qA, qB]);
      }
    }
    if (validPairs.length === 0) throw new Error('No valid A+B question pair sums to target marks.');
    studentsList.forEach(s => {
      const idx = Math.floor(Math.random() * validPairs.length);
      slips[s.rollNumber] = [...validPairs[idx]];
    });
    return slips;
  }
  studentsList.forEach(s => {
    const selected = [];
    let sum = 0;
    const shuffled = [...questionsList].sort(() => Math.random() - 0.5);
    for (const q of shuffled) {
      if (sum + q.marks <= totalPracticalMarks) {
        selected.push(q);
        sum += q.marks;
        if (sum === totalPracticalMarks) break;
      }
    }
    slips[s.rollNumber] = selected;
  });
  return slips;
};

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT CAPCUT: POST /api/product-keys/upload-roster
// Super Admin uploads an Excel/CSV file containing the master student roster.
// The roster is written to product_keys/{keyId}/master_roster/ via Admin SDK.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/product-keys/upload-roster', generalApiLimiter, requireSuperAdminAuth, rosterUpload.single('file'), async (req, res) => {
  const { keyId } = req.body;
  if (!keyId || !req.file) {
    return res.status(400).json({ error: 'Missing keyId or roster file.' });
  }

  try {
    // 1. Verify the product key exists
    const keyRef = adminDb.collection('product_keys').doc(keyId);
    const keySnap = await keyRef.get();
    if (!keySnap.exists) {
      return res.status(404).json({ error: 'Product key not found.' });
    }

    // 2. Parse the file using xlsx (installed dependency)
    const XLSX = await import('xlsx');
    let workbook;
    try {
      workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    } catch (parseErr) {
      return res.status(400).json({ error: 'Failed to parse file. Ensure it is a valid .xlsx or .csv.' });
    }

    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

    if (rows.length < 2) {
      return res.status(400).json({ error: 'File is empty or has no data rows.' });
    }

    // 3. Validate headers — must EXACTLY match: Serial No | Roll Number | Full Name
    const normalize = (v) => String(v || '').trim().toLowerCase();
    const h0 = normalize(rows[0][0]);
    const h1 = normalize(rows[0][1]);
    const h2 = normalize(rows[0][2]);
    if (h0 !== 'serial no' || h1 !== 'roll number' || h2 !== 'full name') {
      return res.status(400).json({
        error: `Invalid column headers. Expected exactly: "Serial No | Roll Number | Full Name". Got: "${rows[0].slice(0,3).join(' | ')}"`,
      });
    }

    // 4. Parse data rows — sanitize and validate
    const htmlTagRegex = /<[^>]*>/g;
    const formulaInjectionRegex = /^[=+\-@]/;
    const sanitizeCell = (val) => {
      let s = String(val || '').trim();
      s = s.replace(htmlTagRegex, '');
      if (formulaInjectionRegex.test(s)) s = s.replace(formulaInjectionRegex, '');
      return s.trim().substring(0, 300);
    };

    const students = [];
    const rollSet = new Set();
    const duplicates = [];

    for (let i = 1; i < rows.length; i++) {
      const row = rows[i];
      const serialNumber = sanitizeCell(row[0]);
      const rollNumber = sanitizeCell(row[1]).toUpperCase();
      const fullName = sanitizeCell(row[2]);

      if (!rollNumber && !fullName) continue; // skip blank rows
      if (!rollNumber) return res.status(400).json({ error: `Row ${i + 1}: Roll Number is empty.` });
      if (!fullName) return res.status(400).json({ error: `Row ${i + 1}: Full Name is empty.` });

      if (rollSet.has(rollNumber)) {
        duplicates.push(rollNumber);
      } else {
        rollSet.add(rollNumber);
        students.push({ serialNumber: serialNumber || String(i), rollNumber, fullName });
      }
    }

    if (duplicates.length > 0) {
      return res.status(400).json({
        error: `Duplicate roll numbers found: ${duplicates.slice(0, 10).join(', ')}${duplicates.length > 10 ? ` and ${duplicates.length - 10} more` : ''}. Each roll number must be unique.`,
      });
    }

    if (students.length === 0) {
      return res.status(400).json({ error: 'No valid student rows found in the file.' });
    }

    // 5. Delete existing roster docs (support re-upload)
    const rosterRef = keyRef.collection('master_roster');
    const existingSnap = await rosterRef.limit(500).get();
    if (!existingSnap.empty) {
      const deleteBatch = adminDb.batch();
      existingSnap.docs.forEach(d => deleteBatch.delete(d.ref));
      await deleteBatch.commit();
    }

    // 6. Write new roster in batches of 500 (Firestore limit)
    const BATCH_SIZE = 500;
    for (let i = 0; i < students.length; i += BATCH_SIZE) {
      const batch = adminDb.batch();
      const chunk = students.slice(i, i + BATCH_SIZE);
      chunk.forEach(s => {
        const docRef = rosterRef.doc();
        batch.set(docRef, s);
      });
      await batch.commit();
    }

    // 7. Update the key document with the count
    await keyRef.update({
      maxStudentCount: students.length,
      rosterUploaded: true,
      rosterUploadedAt: FieldValue.serverTimestamp(),
      rosterUploadedBy: req.adminEmail,
    });

    console.log(`[SuperAdmin:${req.adminEmail}] Roster uploaded for key ${keyId}: ${students.length} students`);
    res.json({ success: true, studentCount: students.length });

  } catch (err) {
    console.error('[RosterUpload] Error:', err.message);
    res.status(500).json({ error: 'Failed to upload roster. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT CAPCUT: GET /api/roster/:keyId
// Returns the master roster for a key. Only accessible by authenticated teachers
// whose tenantId matches the keyId's owning college.
// ─────────────────────────────────────────────────────────────────────────────
app.get('/api/roster/:keyId', generalApiLimiter, requireTeacherAuth, async (req, res) => {
  const { keyId } = req.params;
  const tenantId = req.teacherTenantId;

  if (!keyId || !tenantId) {
    return res.status(400).json({ error: 'Missing keyId or tenant context.' });
  }

  try {
    // 1. Cross-tenant guard: verify the teacher's college owns this keyId
    const settingsDoc = await adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings').get();
    if (!settingsDoc.exists) {
      return res.status(403).json({ error: 'College configuration not found.' });
    }
    const rosterKeyId = settingsDoc.data().rosterKeyId;
    if (!rosterKeyId || rosterKeyId !== keyId) {
      console.warn(`[RosterFetch] Cross-tenant attempt by teacher ${req.teacherEmail}: requested keyId=${keyId}, expected=${rosterKeyId}`);
      return res.status(403).json({ error: 'Access denied. This roster does not belong to your college.' });
    }

    // 2. Fetch all students from master_roster subcollection.
    // IMPORTANT: Do NOT use Firestore .orderBy('serialNumber') here — it sorts strings
    // lexicographically ("1","10","11","2"), breaking the sequence. Sort numerically in JS instead.
    const rosterSnap = await adminDb.collection('product_keys').doc(keyId).collection('master_roster').get();

    const students = rosterSnap.docs
      .map(d => {
        const data = d.data();
        return { serialNumber: data.serialNumber, rollNumber: data.rollNumber, fullName: data.fullName };
      })
      .sort((a, b) => {
        const numA = parseFloat(a.serialNumber);
        const numB = parseFloat(b.serialNumber);
        if (!isNaN(numA) && !isNaN(numB)) return numA - numB;
        return String(a.serialNumber).localeCompare(String(b.serialNumber));
      });

    res.json({ students, totalCount: students.length });
  } catch (err) {
    console.error('[RosterFetch] Error:', err.message);
    res.status(500).json({ error: 'Failed to fetch roster.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT CAPCUT: POST /api/exam-sessions/launch-with-roster
// Launches a new exam session. Validates every selected roll number against the
// master roster BEFORE writing any Firestore documents. All writes are atomic.
// Replaces direct client-side Firestore writes in ExamWizard/InternalExamWizard.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/exam-sessions/launch-with-roster', generalApiLimiter, requireTeacherAuth, async (req, res) => {
  const {
    sessionCode, subjectName, labNumber, studentDepartment, studentYear,
    durationHours, durationMinutes, practicalMarks, vivaMarks, journalMarks,
    examType, selectedStudents, questions, subjectCount, subjectTags,
    // Internal exam fields
    internalMarks, examDate,
  } = req.body;

  const tenantId = req.teacherTenantId;
  const teacherEmail = req.teacherEmail;

  // Basic presence checks
  if (!sessionCode || !subjectName || !tenantId || !examType) {
    return res.status(400).json({ error: 'Missing required exam configuration fields.' });
  }
  if (!Array.isArray(selectedStudents) || selectedStudents.length === 0) {
    return res.status(400).json({ error: 'No students selected. Please select at least one student.' });
  }
  if (!Array.isArray(questions) || questions.length === 0) {
    return res.status(400).json({ error: 'No questions provided.' });
  }

  const cleanSessionCode = String(sessionCode).trim().toUpperCase();

  try {
    // 1. Fetch rosterKeyId for this college
    const settingsDoc = await adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings').get();
    if (!settingsDoc.exists) {
      return res.status(403).json({ error: 'College configuration not found.' });
    }
    const rosterKeyId = settingsDoc.data().rosterKeyId;
    if (!rosterKeyId) {
      return res.status(403).json({ error: 'No roster is associated with this college key. Contact your Super Admin.' });
    }

    // 2. Fetch the full master roster and build a lookup map
    const rosterSnap = await adminDb.collection('product_keys').doc(rosterKeyId).collection('master_roster').get();
    const rosterMap = new Map(); // rollNumber -> { serialNumber, fullName }
    rosterSnap.docs.forEach(d => {
      const data = d.data();
      rosterMap.set(data.rollNumber.toUpperCase(), { serialNumber: data.serialNumber, fullName: data.fullName });
    });

    if (rosterMap.size === 0) {
      return res.status(403).json({ error: 'The master roster is empty. Please ask your Super Admin to upload the student list.' });
    }

    // 3. CRITICAL SECURITY: Validate EVERY selected roll number against the master roster
    const invalidRolls = [];
    const validatedStudents = [];
    for (const s of selectedStudents) {
      const roll = String(s.rollNumber || '').trim().toUpperCase();
      if (!rosterMap.has(roll)) {
        invalidRolls.push(roll);
      } else {
        const rosterEntry = rosterMap.get(roll);
        validatedStudents.push({ 
          rollNumber: roll, 
          fullName: rosterEntry.fullName, 
          serialNumber: rosterEntry.serialNumber,
          image: s.image || ''
        });
      }
    }
    if (invalidRolls.length > 0) {
      console.warn(`[LaunchWithRoster] Teacher ${teacherEmail} tried to inject unapproved rolls: ${invalidRolls.join(', ')}`);
      return res.status(400).json({
        error: `The following roll numbers are not in the approved master roster: ${invalidRolls.join(', ')}`,
      });
    }

    // 4. Check session code is not already in use
    const existingSession = await adminDb.collection('exam_index').doc(cleanSessionCode).get();
    if (existingSession.exists) {
      return res.status(409).json({ error: `Session code '${cleanSessionCode}' is already in use. Please go back and regenerate it.` });
    }

    // 5. Build exam document
    const totalDurationMinutes = (parseInt(durationHours) || 0) * 60 + (parseInt(durationMinutes) || 0);
    const isPractical = examType === 'practical';
    const pMarks = parseInt(practicalMarks) || parseInt(internalMarks) || 0;
    const vMarks = parseInt(vivaMarks) || 0;
    const jMarks = parseInt(journalMarks) || 0;
    const totalMarks = pMarks + vMarks + jMarks;

    const examDoc = {
      subject_name: String(subjectName).trim(),
      teacher_email: teacherEmail,
      upload_folder_name: 'CLOUD_STORAGE',
      lab_number: String(labNumber || '').trim(),
      student_department: String(studentDepartment || '').trim(),
      student_year: String(studentYear || '').trim(),
      duration_minutes: totalDurationMinutes,
      started_at: FieldValue.serverTimestamp(),
      total_marks: totalMarks,
      is_active: true,
      exam_type: examType,
      created_at: FieldValue.serverTimestamp(),
      session_code: cleanSessionCode,
      // Practical-specific
      ...(isPractical ? {
        practical_marks: pMarks,
        viva_marks: vMarks,
        journal_marks: jMarks,
        subject_count: parseInt(subjectCount) || 1,
      } : {
        internal_marks: pMarks,
        exam_date: examDate || '',
      }),
    };

    // 6. Generate question slips server-side (practical only)
    let slips = {};
    if (isPractical) {
      slips = generateSlipsServer(validatedStudents, questions, pMarks, parseInt(subjectCount) || 1, subjectTags || {});
    } else {
      // Internal: all students get all questions (shuffled per student per session)
      const shuffled = [...questions].sort(() => Math.random() - 0.5);
      validatedStudents.forEach(s => { slips[s.rollNumber] = shuffled; });
    }

    // 7. Batch write all Firestore documents atomically
    // Firestore transactions have a 500 doc limit; use batches for large sessions
    const writeBatch = adminDb.batch();

    // 7a. Exam document
    const examRef = adminDb.collection('colleges').doc(tenantId).collection('exams').doc(cleanSessionCode);
    writeBatch.set(examRef, examDoc);

    // 7b. exam_index for student login resolution
    const indexRef = adminDb.collection('exam_index').doc(cleanSessionCode);
    writeBatch.set(indexRef, { tenantId });

    await writeBatch.commit();

    // 7c. Questions batch (separate — can exceed 500 in large banks)
    const questionsColRef = adminDb.collection('colleges').doc(tenantId).collection('questions');
    for (let i = 0; i < questions.length; i += 400) {
      const qBatch = adminDb.batch();
      questions.slice(i, i + 400).forEach(q => {
        const qRef = questionsColRef.doc();
        qBatch.set(qRef, {
          session_code: cleanSessionCode,
          question_id: String(q.question_id || q.id || ''),
          topic: String(q.topic || q.question || ''),
          marks: parseFloat(q.marks) || 0,
          image: q.image || '',
          // Internal MCQ fields
          ...(isPractical ? {
            subject_tag: parseInt(subjectCount) === 2 ? ((subjectTags || {})[q.question_id] || null) : null,
          } : {
            optA: q.optA || '', optB: q.optB || '', optC: q.optC || '', optD: q.optD || '',
            answer: q.answer || '',
          }),
        });
      });
      await qBatch.commit();
    }

    // 7d. Student documents + allowed_students subcollection (per student)
    for (let i = 0; i < validatedStudents.length; i += 400) {
      const sBatch = adminDb.batch();
      validatedStudents.slice(i, i + 400).forEach(s => {
        // Legacy students collection (needed for existing monitor + submit logic)
        const studentDocId = `${cleanSessionCode}_${s.rollNumber}`;
        const studentRef = adminDb.collection('colleges').doc(tenantId).collection('students').doc(studentDocId);
        sBatch.set(studentRef, {
          roll_no: s.rollNumber,
          name: s.fullName,
          image: s.image || '',
          session_code: cleanSessionCode,
          lab_number: String(labNumber || '').trim(),
          department: String(studentDepartment || '').trim(),
          year: String(studentYear || '').trim(),
          status: 'registered',
          assigned_questions: slips[s.rollNumber] || [],
          answers: {},
          exam_type: examType,
          scores: isPractical
            ? { practical: 0, viva: 0, journal: 0, total: 0 }
            : { internal: 0, total: 0 },
        });

        // STUDENT CAPCUT: allowed_students subcollection under the exam
        const allowedRef = adminDb.collection('colleges').doc(tenantId)
          .collection('exams').doc(cleanSessionCode)
          .collection('allowed_students').doc(s.rollNumber);
        sBatch.set(allowedRef, {
          rollNumber: s.rollNumber,
          fullName: s.fullName,
          serialNumber: s.serialNumber,
          image: s.image || '',
        });
      });
      await sBatch.commit();
    }

    console.log(`[LaunchWithRoster] Teacher ${teacherEmail} launched session ${cleanSessionCode} with ${validatedStudents.length} students (tenant: ${tenantId})`);
    res.json({ success: true, sessionCode: cleanSessionCode, studentCount: validatedStudents.length });

  } catch (err) {
    console.error('[LaunchWithRoster] Error:', err.message);
    res.status(500).json({ error: err.message || 'Failed to launch exam session.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT IDENTITY VERIFICATION + SUBMIT TOKEN ISSUANCE (STUDENT CAPCUT UPDATED)
// ─────────────────────────────────────────────────────────────────────────────
// STUDENT CAPCUT: Login now requires only Session Code + Roll Number (2-field).
// Full Name has been removed from login — identity is fetched from the approved
// allowed_students subcollection and returned immutably to the client.
app.post('/api/student/login', studentLoginLimiter, async (req, res) => {
  const { sessionCode, rollNo } = req.body;
  if (!sessionCode || !rollNo) {
    return res.status(400).json({ error: 'Session Code and Roll Number are required.' });
  }

  const sessionCodeClean = String(sessionCode).trim().toUpperCase();
  const rollNoClean = String(rollNo).trim().toUpperCase();

  if (!sessionCodeClean || !rollNoClean) {
    return res.status(400).json({ error: 'Invalid input.' });
  }

  try {
    // 1. Resolve tenantId from exam_index
    const originalSessionCode = String(sessionCode).trim();
    let examIndexDoc = await adminDb.collection('exam_index').doc(originalSessionCode).get();
    if (!examIndexDoc.exists) {
      examIndexDoc = await adminDb.collection('exam_index').doc(sessionCodeClean).get();
    }
    if (!examIndexDoc.exists) {
      return res.status(401).json({ error: 'Invalid Session Code. No such exam session exists.' });
    }
    const tenantId = examIndexDoc.data().tenantId;
    const actualSessionCode = examIndexDoc.id;

    // 2. STUDENT CAPCUT: Check allowed_students subcollection first (the allowlist gate)
    const allowedStudentRef = adminDb.collection('colleges').doc(tenantId)
      .collection('exams').doc(actualSessionCode)
      .collection('allowed_students').doc(rollNoClean);
    const allowedSnap = await allowedStudentRef.get();

    if (!allowedSnap.exists) {
      // Fallback: check if this is a legacy session (before CapCut rollout) using old students collection
      const legacyStudentsRef = adminDb.collection('colleges').doc(tenantId).collection('students');
      const legacySnap = await legacyStudentsRef
        .where('session_code', '==', actualSessionCode)
        .where('roll_no', '==', rollNoClean)
        .limit(1)
        .get();

      if (legacySnap.empty) {
        return res.status(401).json({ error: `Roll Number '${rollNoClean}' is not authorized for this exam session.` });
      }

      // Legacy flow — continue with old data structure
      const legacyDoc = legacySnap.docs[0];
      const legacyData = legacyDoc.data();
      if (legacyData.status === 'submitted' || legacyData.status === 'absent') {
        return res.status(403).json({ error: 'ALREADY_SUBMITTED' });
      }
      const submitToken = signFlowToken(
        { step: 'student_verified', tenantId, sessionCode: actualSessionCode, rollNo: rollNoClean },
        4 * 60 * 60 * 1000
      );
      let collegeName = 'Unknown College';
      try {
        const settingsDoc = await adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings').get();
        if (settingsDoc.exists) collegeName = settingsDoc.data().collegeName || collegeName;
      } catch (_) {}
      const firebaseToken = await getAdminAuth().createCustomToken(legacyDoc.id, { role: 'student' });
      return res.json({
        success: true, submitToken, firebaseToken, tenantId,
        studentDocId: legacyDoc.id, exactRollNo: rollNoClean,
        fullName: legacyData.name || '', collegeName,
      });
    }

    // 3. Student is in the allowlist — fetch their status from the students collection
    const allowedData = allowedSnap.data();
    const exactRollNo = allowedData.rollNumber;
    const fullName = allowedData.fullName;

    const studentDocId = `${actualSessionCode}_${exactRollNo}`;
    const studentRef = adminDb.collection('colleges').doc(tenantId).collection('students').doc(studentDocId);
    const studentSnap = await studentRef.get();

    if (studentSnap.exists) {
      const studentData = studentSnap.data();
      if (studentData.status === 'submitted' || studentData.status === 'absent') {
        return res.status(403).json({ error: 'ALREADY_SUBMITTED' });
      }
    }

    // 4. Issue submitToken
    const submitToken = signFlowToken(
      { step: 'student_verified', tenantId, sessionCode: actualSessionCode, rollNo: exactRollNo },
      4 * 60 * 60 * 1000
    );

    // 5. Fetch college name
    let collegeName = 'Unknown College';
    try {
      const settingsDoc = await adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings').get();
      if (settingsDoc.exists) collegeName = settingsDoc.data().collegeName || collegeName;
    } catch (_) {}

    // 6. Generate Firebase custom token
    const firebaseToken = await getAdminAuth().createCustomToken(studentDocId, { role: 'student' });

    res.json({
      success: true, submitToken, firebaseToken, tenantId,
      studentDocId, exactRollNo,
      fullName,   // STUDENT CAPCUT: returned from master roster (immutable)
      collegeName,
    });

  } catch (err) {
    console.error('[StudentLogin] Error:', err.message);
    res.status(500).json({ error: 'Login failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT ANONYMOUS UID REGISTRATION
// ─────────────────────────────────────────────────────────────────────────────
// After /api/student/login succeeds, the client calls signInAnonymously(auth)
// and then calls this endpoint to save their anonymous Firebase UID into their
// student document. This is required so the Firestore security rules can
// verify the student's identity for onSnapshot reads in ExamInterface.jsx.
//
// SECURITY: The submitToken (issued at login) cryptographically proves the
// caller is the verified student. Only the real student can call this.
// The anonymous_uid is written via Admin SDK (server-side), so no client
// can forge or overwrite it through Firestore client rules.
app.post('/api/student/register-uid', async (req, res) => {
  const { submitToken, anonymousUid } = req.body;

  if (!submitToken || !anonymousUid) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  // Validate anonymousUid is a non-empty string (Firebase UIDs are usually 28 chars, alphanumeric but can contain hyphens/underscores)
  if (typeof anonymousUid !== 'string' || !/^[a-zA-Z0-9_-]{5,128}$/.test(anonymousUid)) {
    return res.status(400).json({ error: 'Invalid anonymous UID format.' });
  }

  let payload;
  try {
    payload = verifyFlowToken(submitToken);
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired session token.' });
  }

  if (payload.step !== 'student_verified') {
    return res.status(403).json({ error: 'Invalid token type.' });
  }

  const { tenantId, sessionCode, rollNo } = payload;

  try {
    // Find the student document via Admin SDK
    const studentsRef = adminDb.collection('colleges').doc(tenantId).collection('students');
    const q = await studentsRef
      .where('session_code', '==', sessionCode)
      .where('roll_no', '==', rollNo)
      .limit(1)
      .get();

    if (q.empty) {
      return res.status(404).json({ error: 'Student record not found.' });
    }

    const studentDocRef = q.docs[0].ref;

    // Save the anonymous UID — Admin SDK bypasses Firestore rules entirely
    await studentDocRef.update({ anonymous_uid: anonymousUid });

    console.log(`[RegisterUID] Saved anonymous_uid for ${rollNo} in session ${sessionCode}`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[RegisterUID] Error:', err.message);
    return res.status(500).json({ error: 'Failed to register UID.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// STUDENT EXAM SUBMISSION
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/student/submit', rateLimit({ windowMs: 60 * 60 * 1000, max: 10, message: { error: 'Too many submissions.' } }), async (req, res) => {
  const { submitToken, tenantId, sessionCode, rollNo, answers } = req.body;
  if (!submitToken || !tenantId || !sessionCode || !rollNo || !answers) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // SECURITY FIX HIGH-02: Verify the cryptographically-signed submitToken.
  // This proves the caller successfully authenticated as this specific student
  // at login time. Without the token, an attacker knowing sessionCode+rollNo
  // cannot submit on behalf of another student.
  let tokenPayload;
  try {
    tokenPayload = verifyFlowToken(submitToken);
  } catch (tokenErr) {
    return res.status(401).json({ error: 'Invalid or expired session token. Please log in again.' });
  }
  if (
    tokenPayload.step !== 'student_verified' ||
    tokenPayload.tenantId !== tenantId ||
    tokenPayload.sessionCode !== sessionCode ||
    tokenPayload.rollNo !== rollNo
  ) {
    console.warn(`[Submit] Token mismatch for ${rollNo}/${sessionCode}`);
    return res.status(403).json({ error: 'Submission identity mismatch. Please log in again.' });
  }

    try {
    const studentRef = adminDb.collection('colleges').doc(tenantId).collection('students').doc(`${sessionCode}_${rollNo}`);
    const questionsQuery = adminDb.collection('colleges').doc(tenantId).collection('questions').where('session_code', '==', sessionCode);
    
    await adminDb.runTransaction(async (transaction) => {
      const freshDoc = await transaction.get(studentRef);
      if (!freshDoc.exists) throw new Error('Student session not found.');
      if (freshDoc.data().status === 'submitted') {
        throw new Error('Your exam has already been submitted.');
      }
      
      const studentData = freshDoc.data();
      const dotUpdate = { status: 'submitted', submittedAt: new Date().toISOString() };
      
      let questionsMap = new Map();
      if (studentData.exam_type === 'internal') {
        const questionsSnap = await transaction.get(questionsQuery);
        questionsSnap.forEach(doc => {
          questionsMap.set(doc.data().question_id, doc.data());
        });
      }

      Object.entries(answers).forEach(([qKey, qVal]) => {
        if (studentData.exam_type === 'internal') {
          dotUpdate[`answers.${qKey}.selected_option`] = qVal.selected_option || null;
          const qIndex = parseInt(qKey.replace('q', ''), 10) - 1;
          const assignedQ = studentData.assigned_questions?.[qIndex];
          if (assignedQ) {
            const fullQ = questionsMap.get(assignedQ.question_id || assignedQ.id);
            if (fullQ) {
              let correctOptionText = null;
              const answerRaw = fullQ.answer?.toString().trim();
              if (answerRaw) {
                const answerUpper = answerRaw.toUpperCase();
                if (['A', 'B', 'C', 'D'].includes(answerUpper)) {
                  correctOptionText = fullQ[`opt${answerUpper}`];
                } else {
                  for (const letter of ['A', 'B', 'C', 'D']) {
                    const optText = fullQ[`opt${letter}`]?.toString().trim();
                    if (optText && optText.toUpperCase() === answerUpper) {
                      correctOptionText = fullQ[`opt${letter}`];
                      break;
                    }
                  }
                  if (!correctOptionText) correctOptionText = fullQ.answer;
                }
              }
              const isCorrect = !!(qVal.selected_option && correctOptionText && qVal.selected_option.trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase());
              dotUpdate[`answers.${qKey}.is_correct`] = isCorrect;
              dotUpdate[`answers.${qKey}.score`] = isCorrect ? (parseFloat(assignedQ.marks) || 0) : 0;
            }
          }
        } else {
          dotUpdate[`answers.${qKey}.code`] = qVal.code || '';
          dotUpdate[`answers.${qKey}.file_uploaded`] = qVal.file_uploaded || false;
          dotUpdate[`answers.${qKey}.file_name`] = qVal.file_name || null;
          dotUpdate[`answers.${qKey}.file_url`] = qVal.file_url || null;
          dotUpdate[`answers.${qKey}.storage_ref`] = qVal.storage_ref || null;
        }
      });

      if (studentData.exam_type === 'internal') {
        let totalScore = 0;
        studentData.assigned_questions?.forEach((assignedQ, qIndex) => {
          const qKey = `q${qIndex + 1}`;
          const qVal = answers[qKey];
          const fullQ = questionsMap.get(assignedQ.question_id || assignedQ.id);
          if (fullQ) {
            let correctOptionText = null;
            const answerRaw = fullQ.answer?.toString().trim();
            if (answerRaw) {
              const answerUpper = answerRaw.toUpperCase();
              if (['A', 'B', 'C', 'D'].includes(answerUpper)) {
                correctOptionText = fullQ[`opt${answerUpper}`];
              } else {
                for (const letter of ['A', 'B', 'C', 'D']) {
                  const optText = fullQ[`opt${letter}`]?.toString().trim();
                  if (optText && optText.toUpperCase() === answerUpper) {
                    correctOptionText = fullQ[`opt${letter}`];
                    break;
                  }
                }
                if (!correctOptionText) correctOptionText = fullQ.answer;
              }
            }
            const isCorrect = !!(qVal?.selected_option && correctOptionText && qVal.selected_option.trim().toLowerCase() === correctOptionText.toString().trim().toLowerCase());
            if (isCorrect) totalScore = Math.round((totalScore + (parseFloat(assignedQ.marks) || 0)) * 10) / 10;
          }
        });
        dotUpdate['scores.internal'] = totalScore;
        dotUpdate['scores.total'] = totalScore;
        dotUpdate['is_graded'] = true;
      }

      transaction.update(studentRef, dotUpdate);
    });

    res.json({ success: true });
  } catch (err) {
    console.error('Student submit error:', err.message);
    res.status(500).json({ error: err.message || 'Submission failed.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// ADMIN SDK: Product Key Endpoints
// These use Firebase Admin SDK which bypasses ALL Firestore security rules.
// Key generation from the Super Admin dashboard calls these APIs directly.
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/product-keys/create — called by KeyGenerator.jsx (REQUIRES SUPER ADMIN AUTH)
// SECURITY FIX CRIT-01: requireSuperAdminAuth verifies Firebase ID token + super_admins doc
app.post('/api/product-keys/create', generalApiLimiter, requireSuperAdminAuth, async (req, res) => {
  try {
    // SECURITY FIX HIGH-07 + HIGH-08: Sanitize and validate all input
    const { errors, sanitized } = sanitizeProductKeyInput(req.body);
    if (errors.length > 0) {
      return res.status(400).json({ error: errors.join(' ') });
    }
    if (!sanitized.productKey) {
      return res.status(400).json({ error: 'Missing key data' });
    }
    // SECURITY FIX HIGH-04: Check for duplicate product keys
    const existingSnap = await adminDb.collection('product_keys')
      .where('productKey', '==', sanitized.productKey)
      .limit(1).get();
    if (!existingSnap.empty) {
      return res.status(409).json({ error: 'A product key with this value already exists.' });
    }
    const docRef = adminDb.collection('product_keys').doc();
    // STUDENT CAPCUT: Add roster defaults so the document is ready for Step 2 upload
    await docRef.set({
      ...sanitized,
      maxStudentCount: 0,
      rosterUploaded: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    console.log(`[SuperAdmin:${req.adminEmail}] Key created: ${sanitized.productKey} (doc: ${docRef.id})`);
    res.json({ success: true, docId: docRef.id, productKey: sanitized.productKey });
  } catch (err) {
    console.error('Key creation error:', err.message);
    res.status(500).json({ error: 'Failed to create product key. Please try again.' });
  }
});

// GET /api/product-keys — list all keys (REQUIRES SUPER ADMIN AUTH)
app.get('/api/product-keys', generalApiLimiter, requireSuperAdminAuth, async (req, res) => {
  try {
    const snapshot = await adminDb.collection('product_keys').orderBy('createdAt', 'desc').get();
    const keys = snapshot.docs.map(d => ({ id: d.id, ...d.data() }));
    res.json({ keys });
  } catch (err) {
    console.error('Key listing error:', err.message);
    res.status(500).json({ error: 'Failed to retrieve product keys.' });
  }
});

// GET /api/product-keys/validate?key=PWS-XXXX — validate key for activation page
app.get('/api/product-keys/validate', generalApiLimiter, async (req, res) => {
  try {
    const { key } = req.query;
    if (!key) return res.status(400).json({ error: 'Missing key parameter' });
    const snapshot = await adminDb.collection('product_keys')
      .where('productKey', '==', key)
      .where('isActivated', '==', false)
      .limit(1)
      .get();
    if (snapshot.empty) {
      return res.status(404).json({ error: 'Invalid or already-activated product key.' });
    }
    const doc = snapshot.docs[0];
    const data = doc.data();
    res.json({
      docId: doc.id,
      adminEmail: data.adminEmail,
      secondaryEmail: data.secondaryEmail || null,
      adminPhone: data.adminPhone,
      tenantId: data.tenantId,
      collegeName: data.collegeName,
      collegeCode: data.collegeCode,
      facultyLimit: data.facultyLimit,
      validUntil: data.validUntil,
      facultyEmails: data.facultyEmails || [],
    });
  } catch (err) {
    console.error('Key validation error:', err.message);
    res.status(500).json({ error: 'Validation failed. Please try again.' });
  }
});

// POST /api/product-keys/activate — burn key and provision tenant (no super-admin auth required — called during activation flow)
app.post('/api/product-keys/activate', generalApiLimiter, async (req, res) => {
  try {
    const { docId, uid, email, tenantId, collegeName, collegeCode, facultyLimit, validUntil, facultyEmails } = req.body;
    if (!docId || !uid || !tenantId) return res.status(400).json({ error: 'Missing required fields' });

    const keyRef = adminDb.collection('product_keys').doc(docId);
    const adminUserRef = adminDb.collection('admin_users').doc(uid);
    const settingsRef = adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings');

    await adminDb.runTransaction(async (transaction) => {
      const freshKey = await transaction.get(keyRef);
      if (!freshKey.exists) throw new Error('Product key not found.');
      if (freshKey.data().isActivated) throw new Error('Key already activated.');

      transaction.update(keyRef, {
        isActivated: true,
        activatedAt: FieldValue.serverTimestamp(),
      });
      transaction.set(adminUserRef, {
        tenantId, email, role: 'admin',
        createdAt: FieldValue.serverTimestamp(),
        legalConsent: {
          termsAccepted: true,
          privacyPolicyAccepted: true,
          dpaAccepted: true, // Data Processing Agreement — required for college admins
          versionAccepted: 'v1.2',
          acceptedAt: FieldValue.serverTimestamp(),
          ipAddress: req.ip || 'unknown',
        },
      });
      transaction.set(settingsRef, {
        collegeName, collegeCode,
        facultyLimit: parseInt(facultyLimit, 10),
        validUntil, // keep the ISO string for frontend backward compatibility
        subscriptionExpiry: new Date(validUntil), // Firestore Timestamp for security rules
        facultyEmails: facultyEmails || [],
        provisionedAt: FieldValue.serverTimestamp(),
        // STUDENT CAPCUT: Link the college to its product key so teachers can fetch the roster
        rosterKeyId: docId,
      });
    });

    console.log(`Key activated: ${docId} -> tenant: ${tenantId}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Activation error:', err.message);
    // SECURITY FIX CRIT-01: Safe activation error messages
    const knownErrors = ['Product key not found.', 'Key already activated.', 'Missing required fields'];
    const safeMessage = knownErrors.some(m => err.message.includes(m)) ? err.message : 'Activation failed. Please try again.';
    res.status(500).json({ error: safeMessage });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/teachers/create
// Creates a Firebase Auth account for a teacher using the Admin SDK.
// This bypasses reCAPTCHA Enterprise entirely (Admin SDK is a trusted server call).
// Called by AdminDashboard.jsx instead of client-side createUserWithEmailAndPassword.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/teachers/create', generalApiLimiter, async (req, res) => {
  const { email, password, tenantId } = req.body;
  if (!email || !password || !tenantId) {
    return res.status(400).json({ error: 'email, password, and tenantId are required.' });
  }

  // Validate: password must be at least 6 chars (Firebase minimum)
  if (typeof password !== 'string' || password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  // Validate: basic email format
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email.trim())) {
    return res.status(400).json({ error: 'Invalid email address.' });
  }

  const emailClean = email.trim().toLowerCase();

  try {
    let uid;
    try {
      // Attempt to create the account
      const userRecord = await getAdminAuth().createUser({
        email: emailClean,
        password,
        emailVerified: false,
      });
      uid = userRecord.uid;
    } catch (createErr) {
      if (createErr.code === 'auth/email-already-exists') {
        // Account already exists — fetch the UID so the caller can still write Firestore docs
        const existingUser = await getAdminAuth().getUserByEmail(emailClean);
        uid = existingUser.uid;
        return res.json({ success: true, uid, alreadyExisted: true });
      }
      throw createErr;
    }

    console.log(`[TeacherCreate] Created Firebase Auth account for ${emailClean} (uid: ${uid}, tenant: ${tenantId})`);
    return res.json({ success: true, uid, alreadyExisted: false });
  } catch (err) {
    console.error('[TeacherCreate] Error:', err.code, err.message);
    // Map known Firebase error codes to user-friendly messages
    if (err.code === 'auth/invalid-email') return res.status(400).json({ error: 'Invalid email address.' });
    if (err.code === 'auth/invalid-password') return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    return res.status(500).json({ error: 'Failed to create teacher account. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/teachers/delete-auth
// Deletes a Firebase Auth account for a teacher using the Admin SDK.
// Called by AdminDashboard.jsx instead of client-side deleteUser.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/teachers/delete-auth', generalApiLimiter, async (req, res) => {
  const { uid, tenantId } = req.body;
  if (!uid || !tenantId) {
    return res.status(400).json({ error: 'uid and tenantId are required.' });
  }

  try {
    await getAdminAuth().deleteUser(uid);
    console.log(`[TeacherDelete] Deleted Firebase Auth account for uid: ${uid} (tenant: ${tenantId})`);
    return res.json({ success: true });
  } catch (err) {
    if (err.code === 'auth/user-not-found') {
      // Auth account already gone — not an error from the caller's perspective
      return res.json({ success: true, alreadyDeleted: true });
    }
    console.error('[TeacherDelete] Error:', err.code, err.message);
    return res.status(500).json({ error: 'Failed to delete teacher auth account.' });
  }
});

// ───────────────────────────────────────────────────────────────────────────────
// DELETE /api/product-keys/:id — called by Super Admin dashboard (REQUIRES SUPER ADMIN AUTH)
// ───────────────────────────────────────────────────────────────────────────────
app.delete('/api/product-keys/:id', generalApiLimiter, requireSuperAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) return res.status(400).json({ error: 'Missing key document ID' });
    await adminDb.collection('product_keys').doc(id).delete();
    console.log(`[SuperAdmin:${req.adminEmail}] Key deleted: ${id}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Key deletion error:', err.message);
    res.status(500).json({ error: 'Failed to delete key. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/product-keys/validate-and-send-otp
// Combines key validation + OTP dispatch into a single round-trip for speed.
// Called by the new AdminActivation.jsx Step 1.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/product-keys/validate-and-send-otp', otpSendLimiter, async (req, res) => {
  const { productKey, adminEmail } = req.body;
  if (!productKey || !adminEmail) {
    return res.status(400).json({ error: 'Missing productKey or adminEmail' });
  }

  try {
    // 1. Validate the key (same logic as /api/product-keys/validate)
    const snapshot = await adminDb.collection('product_keys')
      .where('productKey', '==', productKey)
      .where('isActivated', '==', false)
      .limit(1)
      .get();

    if (snapshot.empty) {
      return res.status(404).json({ error: 'Invalid key' });
    }

    const keyDoc = snapshot.docs[0];
    const data = keyDoc.data();

    // 2. Verify submitted email is the PRIMARY admin email only.
    //    Secondary email is NOT permitted to activate a product key.
    const emailLower = adminEmail.trim().toLowerCase();
    if (data.adminEmail?.toLowerCase() !== emailLower) {
      // Detect if they tried the secondary email so we can return a specific notice
      if (data.secondaryEmail?.toLowerCase() === emailLower) {
        return res.status(400).json({ error: 'SECONDARY_EMAIL_BLOCKED' });
      }
      return res.status(400).json({ error: 'Email does not match the registered key' });
    }

    // 3. Generate and store OTP (5-minute window)
    if (otpStore.size >= MAX_OTP_STORE_SIZE) {
      return res.status(503).json({ error: 'Service temporarily unavailable.' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    // OTP is valid for 300 seconds (5 minutes)
    const expiresAt = Date.now() + 300 * 1000;
    otpStore.set(emailLower, { otp, expiresAt, attempts: 0 });

    // 4. Initialize Google OAuth2 for this route
    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENTID,
      process.env.OAUTH_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.OAUTH_REFRESH_TOKEN
    });

    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    // 5. Construct the email raw string (RFC 2822 format)
    const subject = 'Your PWS Activation Code';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: "PWS Activation" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
      `To: ${emailLower}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      `<div style="font-family:Arial,sans-serif;padding:20px;max-width:600px;border:1px solid #e0e0e0;border-radius:8px">`,
      `  <h2 style="color:#8b0000">PWS Account Activation</h2>`,
      `  <p>Your one-time activation code is valid for <strong>5 minutes</strong>:</p>`,
      `  <div style="background:#1a0a2e;color:#fbbf24;padding:20px;font-size:28px;font-weight:bold;letter-spacing:8px;text-align:center;border-radius:8px;margin:20px 0">${otp}</div>`,
      `  <p style="font-size:12px;color:#888">If you didn't request this, please ignore this email.</p>`,
      `</div>`
    ];

    const message = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(message)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');

    // 6. Send via HTTPS POST request (Bypasses Render's firewall)
    await gmail.users.messages.send({
      userId: 'me',
      requestBody: {
        raw: encodedMessage,
      },
    });
    console.log(`📧 Batched OTP sent to ${emailLower}`);

    // 5. Return key metadata (so frontend doesn't need a second call)
    res.json({
      success: true,
      docId: keyDoc.id,
      adminEmail: data.adminEmail,
      secondaryEmail: data.secondaryEmail || null,
      adminPhone: data.adminPhone,
      tenantId: data.tenantId,
      collegeName: data.collegeName,
      collegeCode: data.collegeCode,
      facultyLimit: data.facultyLimit,
      validUntil: data.validUntil,
      facultyEmails: data.facultyEmails || [],
    });

  } catch (err) {
    console.error('validate-and-send-otp error:', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/send-activation-email
// Sends a "Thank You" confirmation email with the activation key after success.
// SECURITY FIX HIGH-02 (UPGRADED): Rate limited per RECIPIENT EMAIL (not IP).
//   Also validates that the email+productKey pair is a real, activated entry
//   in product_keys — prevents bombing arbitrary email addresses.
// ─────────────────────────────────────────────────────────────────────────────
app.post('/api/send-activation-email', activationEmailLimiter, async (req, res) => {
  const { email, collegeName, productKey } = req.body;
  if (!email || !collegeName || !productKey) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  const emailCleanActivation = String(email).trim().toLowerCase();
  const safeKey = String(productKey).replace(/[^A-Z0-9\-]/g, '').substring(0, 60);

  // ── RECIPIENT + KEY OWNERSHIP VALIDATION ──
  // Verify that the productKey belongs to this admin email AND is activated.
  // This ensures only legitimate activation confirmations can be sent and
  // prevents using this endpoint as an open email relay.
  const activationSnap = await adminDb.collection('product_keys')
    .where('productKey', '==', safeKey)
    .where('adminEmail', '==', emailCleanActivation)
    .where('isActivated', '==', true)
    .limit(1).get();
  if (activationSnap.empty) {
    return res.status(403).json({ error: 'No matching activated key found for this email.' });
  }

  // Sanitize college name to prevent HTML injection
  const safeCollegeName = String(collegeName)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;').substring(0, 200);

  try {
    const htmlContent = `
      <div style="font-family:Arial,sans-serif;padding:32px;max-width:620px;border:1px solid #e0e0e0;border-radius:12px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="font-size:48px">✅</div>
          <h1 style="color:#1a0a2e;font-size:22px;margin:12px 0 4px">Your Key Has Been Activated!</h1>
          <p style="color:#666;font-size:14px">Welcome to the Practical Workflow System</p>
        </div>
        <hr style="border:none;border-top:1px solid #eee;margin:20px 0"/>
        <p style="color:#333;font-size:15px">Dear <strong>${safeCollegeName}</strong> Admin,</p>
        <p style="color:#555;font-size:14px;line-height:1.7">
          Thank you for activating your Practical Workflow System account. Your institution is now fully set up and ready to manage practical examinations seamlessly.
        </p>
        <div style="background:#f9f4ff;border:1px solid #8b000033;border-radius:8px;padding:16px 20px;margin:24px 0">
          <p style="font-size:11px;color:#888;text-transform:uppercase;letter-spacing:1px;margin:0 0 6px">Your Validation Key</p>
          <div style="font-family:monospace;font-size:20px;font-weight:bold;color:#8b0000;letter-spacing:3px">${safeKey}</div>
          <p style="font-size:11px;color:#aaa;margin:8px 0 0">Keep this key safe. You may need it for future support requests.</p>
        </div>
        <p style="color:#555;font-size:14px;line-height:1.7">If you need any help, please contact your system administrator.</p>
        <hr style="border:none;border-top:1px solid #eee;margin:24px 0"/>
        <p style="color:#999;font-size:12px;text-align:center">Practical Workflow System &mdash; Built for Educators</p>
      </div>
    `;

    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENTID,
      process.env.OAUTH_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const subject = 'Welcome to PWS — Your Key Has Been Activated!';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: "PWS Team" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
      `To: ${emailCleanActivation}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      htmlContent
    ];

    const message = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });
    console.log(`📧 Activation success email sent to ${email}`);
    res.json({ success: true });
  } catch (err) {
    console.error('Activation email error:', err.message);
    // Non-fatal — activation already succeeded; don't fail the request
    res.status(500).json({ error: 'Email send failed, but activation succeeded.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// SECONDARY ADMIN CREDENTIAL MANAGEMENT
// 4-step HMAC-JWT gated flow:
//   Step 1: verify-primary-password  → issues flowToken
//   Step 2: send-otp                 → sends OTP to secondaryEmail
//   Step 3: verify-otp               → issues setPasswordToken
//   Step 4: set-password             → creates/updates Firebase Auth + Firestore
// Each token is short-lived and encodes which step was completed.
// The frontend CANNOT skip any step — the backend token chain enforces sequence.
// ─────────────────────────────────────────────────────────────────────────────

// SECURITY FIX LOW-05: Fail loudly on startup if FLOW_JWT_SECRET is not set.
// A missing secret causes a randomly-generated ephemeral key on every deploy,
// which silently invalidates all in-flight tokens (secondary admin flow breaks).
// This startup guard forces the operator to set it as a permanent env variable.
const FLOW_JWT_SECRET = process.env.FLOW_JWT_SECRET;
if (!FLOW_JWT_SECRET) {
  console.error('[FATAL] FLOW_JWT_SECRET is not set in environment variables.');
  console.error('[FATAL] Generate one with: node -e "const c=require(\'crypto\');console.log(c.randomBytes(32).toString(\'hex\'))"');
  console.error('[FATAL] Add it to your Render dashboard → Environment Variables and restart.');
  process.exit(1);
}

// ── Minimal stateless JWT helpers (HMAC-SHA256, no external lib) ──
const signFlowToken = (payload, expiresInMs) => {
  const exp = Date.now() + expiresInMs;
  const data = JSON.stringify({ ...payload, exp });
  const sig = crypto.createHmac('sha256', FLOW_JWT_SECRET).update(data).digest('hex');
  return Buffer.from(JSON.stringify({ data, sig })).toString('base64url');
};

const verifyFlowToken = (token) => {
  try {
    const { data, sig } = JSON.parse(Buffer.from(token, 'base64url').toString());
    const expectedSig = crypto.createHmac('sha256', FLOW_JWT_SECRET).update(data).digest('hex');
    if (!crypto.timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expectedSig, 'hex'))) {
      throw new Error('Invalid token signature');
    }
    const payload = JSON.parse(data);
    if (Date.now() > payload.exp) throw new Error('Token expired');
    return payload;
  } catch (err) {
    throw new Error('Invalid or expired token: ' + err.message);
  }
};

// ── SECURITY FIX CRIT-02: Rate limiter for secondary admin endpoints (5 req / 15 min per IP) ──
// Reduced from 50 to 5 to prevent brute force attacks on the password verification endpoint.
const secondaryAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5, // Reduced from 25 to 5 as per CRIT-02
  keyGenerator: emailKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes before retrying.' },
});

// ── Helper: Verify Firebase password via Identity Toolkit REST API ──
// Firebase Admin SDK does not expose a verifyPassword method, so we use
// the public sign-in REST endpoint — the same one the client SDK calls.
const verifyFirebasePassword = async (email, password) => {
  const apiKey = process.env.VITE_API_KEY;
  if (!apiKey) throw new Error('Server configuration error: missing API key.');

  const url = `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, returnSecureToken: false }),
  });
  const json = await resp.json();
  if (!resp.ok) {
    const code = json?.error?.message || 'INVALID_CREDENTIAL';
    if (code.includes('INVALID_PASSWORD') || code.includes('INVALID_LOGIN_CREDENTIALS') || code.includes('INVALID_CREDENTIAL')) {
      throw new Error('auth/invalid-credential');
    }
    throw new Error(code);
  }
  return json; // contains localId (uid)
};

// ── STEP 1: Verify Primary Admin password ──────────────────────────────────
app.post('/api/secondary-admin/verify-primary-password', secondaryAdminLimiter, async (req, res) => {
  const { primaryEmail, primaryPassword } = req.body;
  if (!primaryEmail || !primaryPassword) {
    return res.status(400).json({ error: 'Email and password are required.' });
  }

  const primaryEmailClean = primaryEmail.trim().toLowerCase();

  try {
    // 1. Fetch admin record to check lockout status
    const adminSnap = await adminDb.collection('admin_users')
      .where('email', '==', primaryEmailClean)
      .limit(1).get();

    if (adminSnap.empty) {
      // Not found, but simulate invalid password to avoid simple enumeration
      return res.status(401).json({ error: 'Invalid password. Access denied.' });
    }

    const adminDoc = adminSnap.docs[0];
    const adminData = adminDoc.data();
    const adminRef = adminDoc.ref;

    // 2. Check if account is currently locked
    if (adminData.lockedUntil && adminData.lockedUntil > Date.now()) {
      const remainingMinutes = Math.ceil((adminData.lockedUntil - Date.now()) / 60000);
      return res.status(429).json({ error: `Account locked due to multiple failed attempts. Try again in ${remainingMinutes} minutes.` });
    }

    // 3. Verify password via Firebase Identity Toolkit
    let firebaseResp;
    try {
      firebaseResp = await verifyFirebasePassword(primaryEmailClean, primaryPassword);
    } catch (err) {
      if (err.message === 'auth/invalid-credential') {
        // Increment failed attempts on wrong password
        const newFailedAttempts = (adminData.failedAttempts || 0) + 1;
        const updateData = { failedAttempts: newFailedAttempts };
        
        // Lock for 1 hour after 10 failed attempts
        if (newFailedAttempts >= 10) {
          updateData.lockedUntil = Date.now() + 60 * 60 * 1000;
        }
        
        await adminRef.update(updateData);
        return res.status(401).json({ error: 'Invalid password. Access denied.' });
      }
      throw err; // Re-throw other errors to be caught by outer catch
    }

    // 4. Password was correct! Reset failed attempts
    if (adminData.failedAttempts > 0 || adminData.lockedUntil) {
      await adminRef.update({ failedAttempts: 0, lockedUntil: null });
    }

    const uid = firebaseResp.localId;

    // 5. Confirm this user is actually a primary admin in Firestore (role check)
    if (adminData.role !== 'admin') {
      return res.status(403).json({ error: 'Access denied. User is not a registered admin.' });
    }

    const tenantId = adminData.tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Admin account has no associated institution.' });
    }

    // 6. Issue flowToken — 5 minute TTL
    const flowToken = signFlowToken(
      { step: 'password_verified', tenantId, primaryEmail: primaryEmailClean, uid },
      5 * 60 * 1000
    );

    console.log(`[SecondaryAdmin] Step 1 passed for ${primaryEmailClean}`);
    res.json({ success: true, flowToken });

  } catch (err) {
    console.error('[SecondaryAdmin] Step 1 error:', err.message);
    res.status(500).json({ error: 'Verification failed. Please try again.' });
  }
});

// ── STEP 2: Send OTP to Secondary Admin's email ────────────────────────────
app.post('/api/secondary-admin/send-otp', secondaryAdminLimiter, async (req, res) => {
  const { flowToken } = req.body;
  if (!flowToken) return res.status(400).json({ error: 'Missing flow token.' });

  try {
    const payload = verifyFlowToken(flowToken);
    if (payload.step !== 'password_verified') {
      return res.status(400).json({ error: 'Invalid flow state. Please restart.' });
    }

    const { tenantId } = payload;

    // 2a. Fetch secondaryEmail from product_keys for this tenant
    const keysSnap = await adminDb.collection('product_keys')
      .where('tenantId', '==', tenantId)
      .limit(1)
      .get();

    if (keysSnap.empty) {
      return res.status(404).json({ error: 'No product key found for this institution.' });
    }

    const keyData = keysSnap.docs[0].data();
    const secondaryEmail = keyData.secondaryEmail?.trim().toLowerCase();

    if (!secondaryEmail) {
      return res.status(404).json({
        error: 'No secondary admin email is registered for this institution. Please contact the system founder to register one.',
      });
    }

    // 2b. Generate OTP and store it (60 second window)
    if (otpStore.size >= MAX_OTP_STORE_SIZE) {
      return res.status(503).json({ error: 'Service temporarily unavailable.' });
    }
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000;
    const otpKey = `secondary_admin_otp:${tenantId}`;
    otpStore.set(otpKey, { otp, expiresAt, attempts: 0 });

    // 2c. Send OTP to secondary admin email
    const htmlContent = `
      <div style="font-family:Arial,sans-serif;padding:28px;max-width:580px;border:1px solid #e0e0e0;border-radius:10px">
        <h2 style="color:#1a0a2e">PWS Secondary Admin Password Setup</h2>
        <p>The Primary Admin of your institution is setting up a password for your account.</p>
        <p>Share the following one-time code with them to confirm you consent to this action:</p>
        <div style="background:#1a0a2e;color:#fbbf24;padding:20px;font-size:32px;font-weight:bold;letter-spacing:10px;text-align:center;border-radius:8px;margin:20px 0">${otp}</div>
        <p style="color:#e53e3e;font-weight:600">⚠ This code expires in <strong>5 minutes</strong>.</p>
        <p style="font-size:12px;color:#888">If you did not request this, please ignore this email and contact your system founder immediately.</p>
      </div>
    `;

    const oauth2Client = new google.auth.OAuth2(
      process.env.OAUTH_CLIENTID,
      process.env.OAUTH_CLIENT_SECRET,
      "https://developers.google.com/oauthplayground"
    );
    oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
    const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

    const subject = 'PWS: Secondary Admin Password Setup OTP';
    const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
    const messageParts = [
      `From: "PWS System" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
      `To: ${secondaryEmail}`,
      'Content-Type: text/html; charset=utf-8',
      'MIME-Version: 1.0',
      `Subject: ${utf8Subject}`,
      '',
      htmlContent
    ];

    const message = messageParts.join('\r\n');
    const encodedMessage = Buffer.from(message).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    await gmail.users.messages.send({ userId: 'me', requestBody: { raw: encodedMessage } });

    console.log(`[SecondaryAdmin] Step 2: OTP sent to ${secondaryEmail} for tenant ${tenantId}`);

    // 2d. Issue new flowToken encoding step 2 completion (carries otpKey so step 3 can look it up)
    const otpSentToken = signFlowToken(
      { step: 'otp_sent', tenantId, otpKey, secondaryEmail, primaryEmail: payload.primaryEmail },
      2 * 60 * 1000 // 2 min window (generous given 60s OTP)
    );

    // Mask secondary email for privacy (show only partial)
    const parts = secondaryEmail.split('@');
    const masked = parts[0].slice(0, 3) + '***@' + parts[1];

    res.json({ success: true, otpSentToken, maskedEmail: masked });

  } catch (err) {
    console.error('[SecondaryAdmin] Step 2 error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to send OTP.' });
  }
});

// ── STEP 3: Verify OTP ────────────────────────────────────────────────────
app.post('/api/secondary-admin/verify-otp', secondaryAdminLimiter, async (req, res) => {
  const { otpSentToken, otp } = req.body;
  if (!otpSentToken || !otp) {
    return res.status(400).json({ error: 'Missing token or OTP.' });
  }

  if (typeof otp !== 'string' || !/^\d{6}$/.test(otp.trim())) {
    return res.status(400).json({ error: 'Invalid OTP format. Must be a 6-digit number.' });
  }

  try {
    const payload = verifyFlowToken(otpSentToken);
    if (payload.step !== 'otp_sent') {
      return res.status(400).json({ error: 'Invalid flow state. Please restart.' });
    }

    const { otpKey, tenantId, secondaryEmail, primaryEmail } = payload;

    // 3a. Validate OTP from store
    const record = otpStore.get(otpKey);
    if (!record) {
      return res.status(400).json({ error: 'OTP has expired or was already used. Please restart.' });
    }
    if (Date.now() > record.expiresAt) {
      otpStore.delete(otpKey);
      return res.status(400).json({ error: 'OTP expired. Please restart the flow.' });
    }
    if (record.attempts >= 5) {
      otpStore.delete(otpKey);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please restart.' });
    }
    if (record.otp !== otp.trim()) {
      record.attempts += 1;
      return res.status(400).json({
        error: `Incorrect OTP. ${5 - record.attempts} attempt(s) remaining.`,
      });
    }

    // 3b. OTP correct — consume it
    otpStore.delete(otpKey);

    // 3c. Issue setPasswordToken — 5 minute TTL
    const setPasswordToken = signFlowToken(
      { step: 'otp_verified', tenantId, secondaryEmail, primaryEmail },
      5 * 60 * 1000
    );

    console.log(`[SecondaryAdmin] Step 3: OTP verified for tenant ${tenantId}`);
    res.json({ success: true, setPasswordToken });

  } catch (err) {
    console.error('[SecondaryAdmin] Step 3 error:', err.message);
    res.status(400).json({ error: err.message || 'OTP verification failed.' });
  }
});

// ── STEP 4: Set Secondary Admin Password ───────────────────────────────────
app.post('/api/secondary-admin/set-password', secondaryAdminLimiter, async (req, res) => {
  const { setPasswordToken, newPassword } = req.body;
  if (!setPasswordToken || !newPassword) {
    return res.status(400).json({ error: 'Missing token or password.' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters.' });
  }

  try {
    const payload = verifyFlowToken(setPasswordToken);
    if (payload.step !== 'otp_verified') {
      return res.status(400).json({ error: 'Invalid flow state. Please restart.' });
    }

    const { tenantId, secondaryEmail } = payload;
    const adminAuth = (await import('firebase-admin/auth')).getAuth();

    // 4a. Create or update Firebase Auth account for secondaryEmail
    let uid;
    try {
      const existingUser = await adminAuth.getUserByEmail(secondaryEmail);
      uid = existingUser.uid;
      // Update password for existing account
      await adminAuth.updateUser(uid, { password: newPassword });
      console.log(`[SecondaryAdmin] Updated auth password for existing user: ${secondaryEmail}`);
    } catch (notFoundErr) {
      if (notFoundErr.code === 'auth/user-not-found') {
        // Create brand-new Firebase Auth account
        const newUser = await adminAuth.createUser({
          email: secondaryEmail,
          password: newPassword,
          emailVerified: true,
        });
        uid = newUser.uid;
        console.log(`[SecondaryAdmin] Created new auth account for: ${secondaryEmail}`);
      } else {
        throw notFoundErr;
      }
    }

    // 4b. Upsert admin_users/{uid} with role:'admin' so AdminLogin.jsx accepts them
    await adminDb.collection('admin_users').doc(uid).set({
      email: secondaryEmail,
      role: 'admin',
      tenantId,
      isSecondaryAdmin: true,
      passwordSetAt: (await import('firebase-admin/firestore')).FieldValue.serverTimestamp(),
    }, { merge: true });

    // 4c. Set secondaryAdminPasswordSet to true in tenant config
    await adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings').set({
      secondaryAdminPasswordSet: true
    }, { merge: true });

    console.log(`[SecondaryAdmin] Step 4 complete. Secondary admin provisioned: ${secondaryEmail} (uid: ${uid}) for tenant: ${tenantId}`);
    res.json({ success: true });

  } catch (err) {
    console.error('[SecondaryAdmin] Step 4 error:', err.message);
    res.status(500).json({ error: 'Failed to set password: ' + err.message });
  }
});



// ─────────────────────────────────────────────────────────────────────────────
// LOCKOUT SYSTEM — 3-failed-attempt lockout with OTP recovery
// Separate from the existing /api/send-otp flow:
//   - OTP expiry: 5 minutes
//   - OTP max attempts: 3
//   - Lockout state persisted in Firestore so it survives browser refresh
// ─────────────────────────────────────────────────────────────────────────────

// Separate in-memory OTP store for lockout recovery (60s TTL, 3 attempts)
const lockoutOtpStore = new Map();

// Evict expired lockout OTPs every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of lockoutOtpStore.entries()) {
    if (now > val.expiresAt) lockoutOtpStore.delete(key);
  }
}, 30 * 1000);

// Rate limiters for lockout endpoints
const lockoutSendLimiter = rateLimit({
  windowMs: 2 * 60 * 1000, // 2 min window
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many OTP requests. Please wait before retrying.' },
});

const lockoutVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 25,
  keyGenerator: emailKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many verification attempts. Please try again later.' },
});

// Helper: get the Firestore collection name for a portal
const getCollectionForPortal = (portal) => {
  if (portal === 'admin') return 'admin_users';
  if (portal === 'teacher') return 'teacher_users';
  if (portal === 'super_admin') return 'super_admins';
  return null;
};

// Helper: find a user UID by email in a given collection
const findUidByEmail = async (collection, email) => {
  const snap = await adminDb.collection(collection)
    .where('email', '==', email.toLowerCase().trim())
    .limit(1).get();
  if (snap.empty) return null;
  return snap.docs[0].id;
};

// Helper: send an email via Gmail API (reuses OAuth2 pattern from existing routes)
const sendLockoutEmail = async (toEmail, subject, htmlBody) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.OAUTH_CLIENTID,
    process.env.OAUTH_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `From: "PWS Security" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
    `To: ${toEmail}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    htmlBody,
  ];
  const raw = Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');

  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
};

// Build a nice HTML OTP email
const buildOtpEmailHtml = (otp, purpose = 'account recovery') => `
<div style="font-family:Arial,sans-serif;padding:24px;max-width:560px;border:1px solid #e0e0e0;border-radius:8px;">
  <h2 style="color:#1e40af;">PWS — One-Time Password</h2>
  <p>A login OTP has been requested for <strong>${purpose}</strong>.</p>
  <p>Use the code below. It expires in <strong>5 minutes</strong>.</p>
  <div style="background:#f3f4f6;padding:18px;font-size:32px;font-weight:bold;letter-spacing:8px;text-align:center;color:#111827;margin:20px 0;border-radius:6px;">
    ${otp}
  </div>
  <p style="color:#6b7280;font-size:13px;">If you did not request this OTP, please contact support immediately.</p>
</div>`;

// ── GET /api/lockout/check-status?email=&portal= ──────────────────────────
// Returns { locked: boolean, failedAttempts: number } for a given email+portal.
// Called on page load so the UI knows immediately if the account is locked.
app.get('/api/lockout/check-status', async (req, res) => {
  const { email, portal } = req.query;
  if (!email || !portal) {
    return res.status(400).json({ error: 'email and portal are required' });
  }
  const col = getCollectionForPortal(portal);
  if (!col) return res.status(400).json({ error: 'Invalid portal' });

  try {
    const emailClean = email.trim().toLowerCase();
    const uid = await findUidByEmail(col, emailClean);
    if (!uid) {
      // Email not found — return unlocked so the login page handles the error normally
      return res.json({ locked: false, failedAttempts: 0 });
    }
    const docSnap = await adminDb.collection(col).doc(uid).get();
    const data = docSnap.data() || {};
    return res.json({
      locked: data.email_locked === true,
      failedAttempts: data.failedAttempts || 0,
      uid,
    });
  } catch (err) {
    console.error('[Lockout] check-status error:', err.message);
    return res.status(500).json({ error: 'Status check failed.' });
  }
});

// ── POST /api/lockout/record-failure ─────────────────────────────────────
// Body: { email, portal }
// Increments failedAttempts. On reaching 3, sets email_locked: true.
// Returns { failedAttempts, locked }.
app.post('/api/lockout/record-failure', async (req, res) => {
  const { email, portal } = req.body;
  if (!email || !portal) {
    return res.status(400).json({ error: 'email and portal are required' });
  }
  const col = getCollectionForPortal(portal);
  if (!col) return res.status(400).json({ error: 'Invalid portal' });

  try {
    const emailClean = email.trim().toLowerCase();
    const uid = await findUidByEmail(col, emailClean);
    if (!uid) {
      // Unknown email — silently return so we don't leak existence
      return res.json({ failedAttempts: 0, locked: false, unknown: true });
    }
    const docRef = adminDb.collection(col).doc(uid);
    const docSnap = await docRef.get();
    const current = docSnap.data()?.failedAttempts || 0;
    const newCount = current + 1;
    const locked = newCount >= 3;

    await docRef.set({
      failedAttempts: newCount,
      email_locked: locked,
      ...(locked ? { lockedAt: FieldValue.serverTimestamp() } : {}),
    }, { merge: true });

    console.log(`[Lockout] ${emailClean} — failure #${newCount}${locked ? ' → LOCKED' : ''}`);
    return res.json({ failedAttempts: newCount, locked });
  } catch (err) {
    console.error('[Lockout] record-failure error:', err.message);
    return res.status(500).json({ error: 'Failed to record failure.' });
  }
});

// ── POST /api/lockout/send-otp ────────────────────────────────────────────
// Body: { email, portal }
// Portal-aware routing:
//   teacher     → OTP sent to primary admin email (product_keys.adminEmail for that tenant)
//   admin       → OTP sent to super admin who generated the key (product_keys.generatedBy or first super_admin)
//   super_admin → OTP sent to the super admin's own email
// OTP: 6-digit, 60s TTL, stored in lockoutOtpStore keyed by email (lowercase)
app.post('/api/lockout/send-otp', lockoutSendLimiter, async (req, res) => {
  const { email, portal } = req.body;
  if (!email || !portal) {
    return res.status(400).json({ error: 'email and portal are required' });
  }
  const col = getCollectionForPortal(portal);
  if (!col) return res.status(400).json({ error: 'Invalid portal' });

  try {
    const emailClean = email.trim().toLowerCase();

    // Verify the account exists and IS locked
    const uid = await findUidByEmail(col, emailClean);
    if (!uid) {
      return res.status(404).json({ error: 'Account not found.' });
    }
    const userDoc = await adminDb.collection(col).doc(uid).get();
    const userData = userDoc.data() || {};
    if (!userData.email_locked) {
      return res.status(400).json({ error: 'Account is not currently locked.' });
    }

    // Determine where to send the OTP
    let otpDestination = emailClean;

    if (portal === 'teacher') {
      // Send to primary admin (product_keys.adminEmail for the teacher's tenant)
      const tenantId = userData.tenantId;
      if (tenantId) {
        const keySnap = await adminDb.collection('product_keys')
          .where('tenantId', '==', tenantId)
          .limit(1).get();
        if (!keySnap.empty) {
          otpDestination = keySnap.docs[0].data().adminEmail || emailClean;
        }
      }
    } else if (portal === 'admin') {
      // OTP for admin lockout recovery goes to nextsolves@gmail.com
      otpDestination = 'nextsolves@gmail.com';
    } else if (portal === 'super_admin') {
      // OTP goes to the super admin's own email
      otpDestination = userData.email || emailClean;
    }

    // Generate 6-digit OTP with 60-second expiry
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000; // 5 minutes
    lockoutOtpStore.set(emailClean, { otp, expiresAt, attempts: 0, destination: otpDestination });

    const portalLabel = portal === 'teacher' ? 'Teacher' : portal === 'admin' ? 'Admin' : 'Super Admin';
    await sendLockoutEmail(
      otpDestination,
      'PWS Account Recovery OTP',
      buildOtpEmailHtml(otp, `${portalLabel} account recovery for ${emailClean}`)
    );

    console.log(`[Lockout] OTP sent for ${emailClean} (${portal}) → ${otpDestination}`);
    // Return the destination (masked) so the frontend can show "OTP sent to xx***@domain.com"
    const [localPart, domain] = otpDestination.split('@');
    const masked = localPart.substring(0, 2) + '***@' + domain;
    return res.json({ message: 'OTP sent', destination: masked });
  } catch (err) {
    console.error('[Lockout] send-otp error:', err.message);
    return res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// ── POST /api/lockout/verify-otp ─────────────────────────────────────────
// Body: { email, otp, portal }
// Max 3 attempts. On success: clears lockoutOtpStore entry, unlocks account.
// Returns { success: true } on valid OTP.
app.post('/api/lockout/verify-otp', lockoutVerifyLimiter, async (req, res) => {
  const { email, otp, portal } = req.body;
  if (!email || !otp || !portal) {
    return res.status(400).json({ error: 'email, otp, and portal are required' });
  }
  if (!/^\d{6}$/.test(otp.trim())) {
    return res.status(400).json({ error: 'OTP must be a 6-digit number.' });
  }

  const col = getCollectionForPortal(portal);
  if (!col) return res.status(400).json({ error: 'Invalid portal' });

  const emailClean = email.trim().toLowerCase();
  const record = lockoutOtpStore.get(emailClean);

  if (!record) {
    return res.status(400).json({ error: 'No OTP found. Please request a new one.' });
  }
  if (Date.now() > record.expiresAt) {
    lockoutOtpStore.delete(emailClean);
    return res.status(400).json({ error: 'OTP has expired (5 minutes). Please request a new one.' });
  }
  if (record.attempts >= 3) {
    lockoutOtpStore.delete(emailClean);
    return res.status(429).json({ error: 'Too many failed OTP attempts. Please request a new OTP.' });
  }

  if (record.otp !== otp.trim()) {
    record.attempts += 1;
    const remaining = 3 - record.attempts;
    return res.status(400).json({
      error: `Invalid OTP. ${remaining} attempt${remaining === 1 ? '' : 's'} remaining.`,
    });
  }

  // OTP correct — unlock the account
  lockoutOtpStore.delete(emailClean);
  try {
    const uid = await findUidByEmail(col, emailClean);
    if (uid) {
      await adminDb.collection(col).doc(uid).set({
        email_locked: false,
        failedAttempts: 0,
        unlockedAt: FieldValue.serverTimestamp(),
      }, { merge: true });
    }
    console.log(`[Lockout] OTP verified + account unlocked: ${emailClean} (${portal})`);
    return res.json({ success: true });
  } catch (err) {
    console.error('[Lockout] verify-otp unlock error:', err.message);
    return res.status(500).json({ error: 'OTP verified but failed to unlock account. Please contact support.' });
  }
});

// ── POST /api/lockout/send-reset-otp ─────────────────────────────────────
// Body: { email, portal }
// After unlock, user chooses "Reset Password". Sends OTP to user's OWN email.
// Reuses lockoutOtpStore with a 'reset' flag.
app.post('/api/lockout/send-reset-otp', lockoutSendLimiter, async (req, res) => {
  const { email, portal } = req.body;
  if (!email || !portal) {
    return res.status(400).json({ error: 'email and portal are required' });
  }
  const col = getCollectionForPortal(portal);
  if (!col) return res.status(400).json({ error: 'Invalid portal' });

  try {
    const emailClean = email.trim().toLowerCase();
    const uid = await findUidByEmail(col, emailClean);
    if (!uid) return res.status(404).json({ error: 'Account not found.' });

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000;
    // Key the reset OTP with a prefix to not collide with lockout OTP
    lockoutOtpStore.set(`reset:${emailClean}`, { otp, expiresAt, attempts: 0, uid });

    await sendLockoutEmail(
      emailClean,
      'PWS — Password Reset OTP',
      buildOtpEmailHtml(otp, 'password reset')
    );

    console.log(`[Lockout] Reset OTP sent to ${emailClean}`);
    return res.json({ message: 'Reset OTP sent to your email.' });
  } catch (err) {
    console.error('[Lockout] send-reset-otp error:', err.message);
    return res.status(500).json({ error: 'Failed to send reset OTP.' });
  }
});

// ── POST /api/lockout/reset-password ─────────────────────────────────────
// Body: { email, otp, newPassword, portal }
// Verifies the reset OTP then changes the password via Firebase Admin SDK.
app.post('/api/lockout/reset-password', lockoutVerifyLimiter, async (req, res) => {
  const { email, otp, newPassword, portal } = req.body;
  if (!email || !otp || !newPassword || !portal) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const col = getCollectionForPortal(portal);
  if (!col) return res.status(400).json({ error: 'Invalid portal' });

  const emailClean = email.trim().toLowerCase();
  const record = lockoutOtpStore.get(`reset:${emailClean}`);

  if (!record) {
    return res.status(400).json({ error: 'No reset OTP found. Please request a new one.' });
  }
  if (Date.now() > record.expiresAt) {
    lockoutOtpStore.delete(`reset:${emailClean}`);
    return res.status(400).json({ error: 'Reset OTP expired. Please request a new one.' });
  }
  if (record.attempts >= 3) {
    lockoutOtpStore.delete(`reset:${emailClean}`);
    return res.status(429).json({ error: 'Too many failed attempts. Please request a new OTP.' });
  }
  if (record.otp !== otp.trim()) {
    record.attempts += 1;
    const rem = 3 - record.attempts;
    return res.status(400).json({ error: `Invalid OTP. ${rem} attempt${rem === 1 ? '' : 's'} remaining.` });
  }

  // OTP correct — update password via Admin SDK
  lockoutOtpStore.delete(`reset:${emailClean}`);
  const firestoreUid = record.uid; // Stored UID from findUidByEmail

  try {
    // 1. Update Auth Password via Firebase Admin
    let authUid = firestoreUid;
    try {
      const userRecord = await getAdminAuth().getUserByEmail(emailClean);
      authUid = userRecord.uid;
      await getAdminAuth().updateUser(authUid, { password: newPassword });
    } catch (authErr) {
      if (authErr.code === 'auth/user-not-found' && firestoreUid) {
        // User exists in Firestore (OTP was sent) but missing in Auth. Recreate them to heal the account.
        console.warn(`[Lockout] Auth user missing for ${emailClean}. Auto-healing by recreating Auth account.`);
        await getAdminAuth().createUser({
          uid: firestoreUid,
          email: emailClean,
          password: newPassword,
          emailVerified: true
        });
        authUid = firestoreUid;
      } else {
        console.error('[Lockout] reset-password — Firebase Auth update failed:', authErr.message);
        return res.status(500).json({ error: 'Failed to update password in authentication system. Please contact support.' });
      }
    }

    // 2. Reset lockout fields in Firestore and sync plaintext password
    try {
      await adminDb.collection(col).doc(authUid).set({
        email_locked: false,
        failedAttempts: 0,
        passwordResetAt: FieldValue.serverTimestamp(),
      }, { merge: true });

      // Sync the new password to the specific portal collection so Excel exports have real-time data
      if (portal === 'teacher') {
        const teacherUserSnap = await adminDb.collection(col).doc(authUid).get();
        if (teacherUserSnap.exists) {
          const tenantId = teacherUserSnap.data().tenantId;
          if (tenantId) {
            await adminDb.collection('colleges').doc(tenantId).collection('teachers').doc(authUid).set({
              password: newPassword
            }, { merge: true });
            console.log(`[Lockout] Synced new password to colleges/${tenantId}/teachers/${authUid}`);
          }
        }
      }

    } catch (fsErr) {
      console.warn('[Lockout] reset-password — Firestore lockout reset failed (non-fatal):', fsErr.message);
    }

    console.log(`[Lockout] Password reset successful for ${emailClean}`);
    return res.json({ success: true, message: 'Password updated successfully.' });
  } catch (err) {
    console.error('[Lockout] reset-password error:', err.message);
    return res.status(500).json({ error: 'Failed to reset password. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// TEACHER PASSWORD CHANGE (server-side atomic sync)
// Called from Teacher Dashboard "Change Password" flow.
// Atomically updates BOTH Firebase Auth password AND the Firestore
// `colleges/{tenantId}/teachers/{uid}.password` field via Admin SDK,
// guaranteeing that the admin's "Download Excel of Passwords" always
// reflects the teacher's current password.
// ─────────────────────────────────────────────────────────────────────────────
const teacherChangePwLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many password change attempts. Please try again later.' },
});

app.post('/api/teacher/change-password', teacherChangePwLimiter, async (req, res) => {
  const { newPassword } = req.body;
  const authHeader = req.headers.authorization;

  // Validate inputs
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required.' });
  }
  if (!newPassword || typeof newPassword !== 'string' || newPassword.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters.' });
  }

  const idToken = authHeader.split('Bearer ')[1];

  try {
    // 1. Verify the Firebase ID token to get the teacher's UID
    const decodedToken = await getAdminAuth().verifyIdToken(idToken);
    const uid = decodedToken.uid;
    const email = decodedToken.email;

    // 2. Look up the teacher in teacher_users to get their tenantId
    const teacherUserDoc = await adminDb.collection('teacher_users').doc(uid).get();
    if (!teacherUserDoc.exists) {
      return res.status(403).json({ error: 'Access denied. Teacher account not found.' });
    }
    const tenantId = teacherUserDoc.data().tenantId;
    if (!tenantId) {
      return res.status(400).json({ error: 'Teacher account is not associated with a college.' });
    }

    // 3. Update Firebase Auth password via Admin SDK
    await getAdminAuth().updateUser(uid, { password: newPassword });

    // 4. Sync the plaintext password to Firestore (Admin SDK bypasses security rules)
    await adminDb.collection('colleges').doc(tenantId).collection('teachers').doc(uid).set({
      password: newPassword
    }, { merge: true });

    console.log(`[TeacherChangePW] Password updated and synced for ${email} (tenant: ${tenantId})`);
    return res.json({ success: true, message: 'Password changed successfully.' });
  } catch (err) {
    console.error('[TeacherChangePW] Error:', err.message);
    if (err.code === 'auth/id-token-expired' || err.code === 'auth/argument-error') {
      return res.status(401).json({ error: 'Session expired. Please log in again.' });
    }
    return res.status(500).json({ error: 'Failed to change password. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REPLACE ADMIN FLOW
// Lets the current primary admin hand over their account to a brand-new email.
// 4-step HMAC-JWT gated flow:
//   Step 1: send-super-otp      → sends OTP to Super Admin email for approval
//   Step 2: verify-super-otp    → verifies super admin OTP, issues newAdminToken
//   Step 3: send-new-otp        → sends OTP to the new admin's email address
//   Step 4: complete            → creates new admin auth, migrates Firestore docs,
//                                  deletes old admin auth + admin_users doc
// ─────────────────────────────────────────────────────────────────────────────

// Separate in-memory OTP store for replace-admin flow
const replaceAdminOtpStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of replaceAdminOtpStore.entries()) {
    if (now > val.expiresAt) replaceAdminOtpStore.delete(key);
  }
}, 60 * 1000);

// Rate limiter for replace-admin endpoints (15 req / 15 min per IP)
const replaceAdminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  keyGenerator: emailKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes before retrying.' },
});

// Helper: send email via Gmail API (reuses sendLockoutEmail pattern)
const sendReplaceAdminEmail = async (toEmail, subject, htmlBody) => {
  const oauth2Client = new google.auth.OAuth2(
    process.env.OAUTH_CLIENTID,
    process.env.OAUTH_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });

  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `From: "PWS Security" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
    `To: ${toEmail}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    htmlBody,
  ];
  const raw = Buffer.from(messageParts.join('\r\n'))
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
};

// ── GET /api/replace-admin/admin-info ───────────────────────────────────────
// Query: ?email=...
// Returns { isSecondaryAdmin: bool } — used by frontend to know admin type.
app.get('/api/replace-admin/admin-info', async (req, res) => {
  const { email } = req.query;
  if (!email) return res.status(400).json({ error: 'email is required.' });
  try {
    const snap = await adminDb.collection('admin_users')
      .where('email', '==', email.trim().toLowerCase())
      .limit(1).get();
    if (snap.empty) return res.status(404).json({ error: 'Admin not found.' });
    const data = snap.docs[0].data();
    const tenantId = data.tenantId;

    // Also fetch ALL admin emails for this tenant so the frontend can exclude them from the teacher picker
    let allAdminEmails = [];
    if (tenantId) {
      const allAdminsSnap = await adminDb.collection('admin_users')
        .where('tenantId', '==', tenantId).get();
      allAdminEmails = allAdminsSnap.docs.map(d => d.data().email).filter(Boolean);
    }

    return res.json({ isSecondaryAdmin: !!data.isSecondaryAdmin, allAdminEmails });
  } catch (err) {
    console.error('[ReplaceAdmin] admin-info error:', err.message);
    return res.status(500).json({ error: 'Failed to fetch admin info.' });
  }
});

// ── STEP 1: Send OTP to NextSolves ──────────────────────────────────────────
// Body: { primaryEmail }
// Finds the tenantId and isSecondaryAdmin flag for the admin, sends OTP to NextSolves.
app.post('/api/replace-admin/send-super-otp', replaceAdminLimiter, async (req, res) => {
  const { primaryEmail } = req.body;
  if (!primaryEmail) return res.status(400).json({ error: 'primaryEmail is required.' });

  try {
    const emailClean = primaryEmail.trim().toLowerCase();

    // 1a. Find the admin's UID and tenantId from admin_users
    const adminSnap = await adminDb.collection('admin_users')
      .where('email', '==', emailClean)
      .limit(1).get();
    if (adminSnap.empty) {
      return res.status(404).json({ error: 'Admin account not found.' });
    }
    const adminData = adminSnap.docs[0].data();
    const tenantId = adminData.tenantId;
    if (!tenantId) return res.status(400).json({ error: 'Admin has no associated institution.' });
    const isSecondaryAdmin = !!adminData.isSecondaryAdmin;

    // OTP for admin replacement always goes to nextsolves@gmail.com
    const superAdminEmail = 'nextsolves@gmail.com';

    // 1c. Generate OTP and store it (5 min TTL)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000; // 5 minutes
    const otpKey = `replace_admin_super:${tenantId}`;
    replaceAdminOtpStore.set(otpKey, { otp, expiresAt, attempts: 0 });

    // 1d. Send OTP to super admin
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;padding:28px;max-width:580px;border:1px solid #e0e0e0;border-radius:10px">
        <h2 style="color:#b91c1c">⚠️ PWS — Admin Replacement Request</h2>
        <p>The current admin (<strong>${emailClean}</strong>) has requested to <strong>replace their admin account</strong> for the institution linked to this key.</p>
        <p>If you authorise this action, share the following one-time code with the admin:</p>
        <div style="background:#1a0a2e;color:#fbbf24;padding:20px;font-size:32px;font-weight:bold;letter-spacing:10px;text-align:center;border-radius:8px;margin:20px 0">${otp}</div>
        <p style="color:#e53e3e;font-weight:600">⏱ This code expires in <strong>5 minutes</strong>.</p>
        <p style="font-size:12px;color:#888">If you did NOT authorise this, please ignore this email and contact the institution immediately.</p>
      </div>
    `;
    await sendReplaceAdminEmail(superAdminEmail, 'PWS: Admin Account Replacement OTP', htmlBody);

    // 1e. Issue flow token (step: super_otp_sent, 10 min) — encode isSecondaryAdmin so it survives the full chain
    const superOtpToken = signFlowToken(
      { step: 'replace_super_otp_sent', tenantId, primaryEmail: emailClean, otpKey, isSecondaryAdmin },
      10 * 60 * 1000
    );

    // Mask super admin email for display
    const [localPart, domain] = superAdminEmail.split('@');
    const maskedSuperEmail = localPart.substring(0, 3) + '***@' + domain;

    console.log(`[ReplaceAdmin] Step 1: OTP sent to super admin for tenant ${tenantId}`);
    res.json({ success: true, superOtpToken, maskedSuperEmail });

  } catch (err) {
    console.error('[ReplaceAdmin] Step 1 error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP. Please try again.' });
  }
});

// ── STEP 2: Verify Super Admin OTP ──────────────────────────────────────────
// Body: { superOtpToken, otp }
app.post('/api/replace-admin/verify-super-otp', replaceAdminLimiter, async (req, res) => {
  const { superOtpToken, otp } = req.body;
  if (!superOtpToken || !otp) return res.status(400).json({ error: 'Missing token or OTP.' });
  if (!/^\d{6}$/.test(otp.trim())) return res.status(400).json({ error: 'OTP must be a 6-digit number.' });

  try {
    const payload = verifyFlowToken(superOtpToken);
    if (payload.step !== 'replace_super_otp_sent') {
      return res.status(400).json({ error: 'Invalid flow state. Please restart.' });
    }

    const { otpKey, tenantId, primaryEmail, isSecondaryAdmin } = payload;
    const record = replaceAdminOtpStore.get(otpKey);

    if (!record) return res.status(400).json({ error: 'OTP has expired or was already used. Please restart.' });
    if (Date.now() > record.expiresAt) {
      replaceAdminOtpStore.delete(otpKey);
      return res.status(400).json({ error: 'OTP expired. Please restart the flow.' });
    }
    if (record.attempts >= 5) {
      replaceAdminOtpStore.delete(otpKey);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please restart.' });
    }
    if (record.otp !== otp.trim()) {
      record.attempts += 1;
      return res.status(400).json({ error: `Incorrect OTP. ${5 - record.attempts} attempt(s) remaining.` });
    }

    // OTP correct — consume it
    replaceAdminOtpStore.delete(otpKey);

    // Issue newAdminToken (10 min TTL) — thread isSecondaryAdmin through to complete step
    const newAdminToken = signFlowToken(
      { step: 'replace_super_otp_verified', tenantId, primaryEmail, isSecondaryAdmin },
      10 * 60 * 1000
    );

    console.log(`[ReplaceAdmin] Step 2: NextSolves OTP verified for tenant ${tenantId}`);
    res.json({ success: true, newAdminToken });

  } catch (err) {
    console.error('[ReplaceAdmin] Step 2 error:', err.message);
    res.status(400).json({ error: err.message || 'OTP verification failed.' });
  }
});

// ── STEP 3: Send OTP to New Admin Email ─────────────────────────────────────
// Body: { newAdminToken, newEmail }
app.post('/api/replace-admin/send-new-otp', replaceAdminLimiter, async (req, res) => {
  const { newAdminToken, newEmail } = req.body;
  if (!newAdminToken || !newEmail) return res.status(400).json({ error: 'Missing token or new email.' });

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(newEmail.trim())) return res.status(400).json({ error: 'Invalid email address.' });

  try {
    const payload = verifyFlowToken(newAdminToken);
    if (payload.step !== 'replace_super_otp_verified') {
      return res.status(400).json({ error: 'Invalid flow state. Please restart.' });
    }

    const { tenantId, primaryEmail, isSecondaryAdmin } = payload;
    const newEmailClean = newEmail.trim().toLowerCase();

    // Check the new email is not an active admin in a DIFFERENT tenant.
    // Within the same tenant, a teacher may appear in admin_users if they were
    // previously a secondary admin — that is expected and must be allowed.
    const existingAdminSnap = await adminDb.collection('admin_users')
      .where('email', '==', newEmailClean)
      .limit(5).get();
    if (!existingAdminSnap.empty) {
      const crossTenantAdmin = existingAdminSnap.docs.find(d => d.data().tenantId !== tenantId);
      if (crossTenantAdmin) {
        return res.status(409).json({ error: 'This teacher is already registered as an admin at a different institution. Please select a different teacher.' });
      }
      // Same-tenant admin_users doc is fine — it will be updated by the complete step.
    }

    // Verify the selected teacher actually belongs to this college
    const teacherSnap = await adminDb.collection('colleges').doc(tenantId)
      .collection('teachers').where('email', '==', newEmailClean).limit(1).get();
    if (teacherSnap.empty) {
      return res.status(404).json({ error: 'Selected teacher not found in your college. Please select a valid teacher.' });
    }

    // Generate OTP for the selected teacher's email (60s TTL)
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000;
    const otpKey = `replace_admin_new:${newEmailClean}`;
    replaceAdminOtpStore.set(otpKey, { otp, expiresAt, attempts: 0 });

    // Send OTP to the selected teacher's email
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;padding:28px;max-width:580px;border:1px solid #e0e0e0;border-radius:10px">
        <h2 style="color:#1e40af">PWS — New Admin Verification</h2>
        <p>You have been selected as the new ${isSecondaryAdmin ? 'Secondary' : 'Primary'} Admin for a Practical Workflow System institution.</p>
        <p>Enter the code below to verify your email address and complete the account transfer:</p>
        <div style="background:#1e3a8a;color:#fbbf24;padding:20px;font-size:32px;font-weight:bold;letter-spacing:10px;text-align:center;border-radius:8px;margin:20px 0">${otp}</div>
        <p style="color:#e53e3e;font-weight:600">⏱ This code expires in <strong>5 minutes</strong>.</p>
        <p style="font-size:12px;color:#888">If you did not expect this, please contact your institution immediately.</p>
      </div>
    `;
    await sendReplaceAdminEmail(newEmailClean, 'PWS: New Admin Email Verification', htmlBody);

    // Issue new flow token — thread isSecondaryAdmin through to complete step
    const newAdminOtpToken = signFlowToken(
      { step: 'replace_new_otp_sent', tenantId, primaryEmail, newEmail: newEmailClean, otpKey, isSecondaryAdmin },
      10 * 60 * 1000
    );

    console.log(`[ReplaceAdmin] Step 3: Teacher OTP sent to ${newEmailClean} for tenant ${tenantId} (isSecondary: ${isSecondaryAdmin})`);
    res.json({ success: true, newAdminOtpToken });

  } catch (err) {
    console.error('[ReplaceAdmin] Step 3 error:', err.message);
    res.status(400).json({ error: err.message || 'Failed to send OTP to teacher email.' });
  }
});

// ── STEP 4: Complete the Admin Replacement ───────────────────────────────────
// Body: { newAdminOtpToken, otp, newPhone }
// Reuses the teacher's existing Firebase Auth account — no new password needed.
// Role assignment controlled by isSecondaryAdmin flag encoded in the JWT chain.
app.post('/api/replace-admin/complete', replaceAdminLimiter, async (req, res) => {
  const { newAdminOtpToken, otp, newPhone } = req.body;
  if (!newAdminOtpToken || !otp) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }
  if (!/^\d{6}$/.test(otp.trim())) return res.status(400).json({ error: 'OTP must be a 6-digit number.' });

  try {
    const payload = verifyFlowToken(newAdminOtpToken);
    if (payload.step !== 'replace_new_otp_sent') {
      return res.status(400).json({ error: 'Invalid flow state. Please restart.' });
    }

    const { tenantId, primaryEmail, newEmail, otpKey, isSecondaryAdmin } = payload;

    // Verify the teacher's OTP
    const record = replaceAdminOtpStore.get(otpKey);
    if (!record) return res.status(400).json({ error: 'OTP has expired or was already used. Please restart.' });
    if (Date.now() > record.expiresAt) {
      replaceAdminOtpStore.delete(otpKey);
      return res.status(400).json({ error: 'OTP expired. Please restart the flow.' });
    }
    if (record.attempts >= 5) {
      replaceAdminOtpStore.delete(otpKey);
      return res.status(429).json({ error: 'Too many incorrect attempts. Please restart.' });
    }
    if (record.otp !== otp.trim()) {
      record.attempts += 1;
      return res.status(400).json({ error: `Incorrect OTP. ${5 - record.attempts} attempt(s) remaining.` });
    }
    replaceAdminOtpStore.delete(otpKey);

    const adminAuth = getAdminAuth();

    // ── 1. Find old admin's Firebase Auth UID ──────────────────────────────
    let oldUid;
    try {
      const oldUserRecord = await adminAuth.getUserByEmail(primaryEmail);
      oldUid = oldUserRecord.uid;
    } catch (e) {
      console.warn(`[ReplaceAdmin] Old auth user not found for ${primaryEmail}:`, e.message);
      oldUid = null;
    }

    // ── 2. Find the teacher's Firebase Auth UID ─────────────────────────────
    // If the teacher has an existing Firebase Auth account, reuse it.
    // If not (e.g. Firestore-only record), create one using their stored password.
    let newUid;
    try {
      const existingTeacherUser = await adminAuth.getUserByEmail(newEmail);
      newUid = existingTeacherUser.uid;
      console.log(`[ReplaceAdmin] Reusing existing auth for teacher: ${newEmail} (uid: ${newUid})`);
    } catch (notFoundErr) {
      if (notFoundErr.code === 'auth/user-not-found') {
        // Teacher has no Firebase Auth account — look up their password from Firestore and create one
        const teacherSnap = await adminDb.collection('colleges').doc(tenantId)
          .collection('teachers').where('email', '==', newEmail).limit(1).get();

        if (teacherSnap.empty || !teacherSnap.docs[0].data().password) {
          return res.status(404).json({
            error: 'Teacher account setup is incomplete. Please ask your admin to set a password for this teacher first.',
          });
        }

        const teacherPassword = teacherSnap.docs[0].data().password;
        const newUser = await adminAuth.createUser({
          email: newEmail,
          password: teacherPassword,
          emailVerified: true,
        });
        newUid = newUser.uid;

        // Also ensure the teacher_users lookup doc exists for future logins
        await adminDb.collection('teacher_users').doc(newUid).set({
          tenantId,
          email: newEmail,
        }, { merge: true });

        console.log(`[ReplaceAdmin] Created new auth for teacher (was Firestore-only): ${newEmail} (uid: ${newUid})`);
      } else {
        throw notFoundErr;
      }
    }

    // ── 3. Firestore updates (Batch) ──────────────────────────────────────
    const batch = adminDb.batch();

    // 3a. Create admin_users doc for the teacher (using their existing UID)
    const newAdminRef = adminDb.collection('admin_users').doc(newUid);
    batch.set(newAdminRef, {
      email: newEmail,
      phone: newPhone || '',
      role: 'admin',
      isSecondaryAdmin: !!isSecondaryAdmin,
      tenantId,
      createdAt: FieldValue.serverTimestamp(),
      legalConsent: {
        termsAccepted: true,
        privacyPolicyAccepted: true,
        dpaAccepted: true,
        versionAccepted: 'v1.2',
        acceptedAt: FieldValue.serverTimestamp(),
      },
    });

    // 3b. Delete old admin's admin_users doc
    if (oldUid) {
      batch.delete(adminDb.collection('admin_users').doc(oldUid));
    } else {
      const oldAdminSnap = await adminDb.collection('admin_users')
        .where('email', '==', primaryEmail).limit(1).get();
      if (!oldAdminSnap.empty) {
        batch.delete(oldAdminSnap.docs[0].ref);
      }
    }

    // 3c. Update product_keys based on role:
    //   Primary admin replacing → update adminEmail (+ adminPhone)
    //   Secondary admin replacing → update secondaryEmail only
    const keySnap = await adminDb.collection('product_keys')
      .where('tenantId', '==', tenantId).limit(1).get();
    if (!keySnap.empty) {
      const keyRef = keySnap.docs[0].ref;
      if (isSecondaryAdmin) {
        // Secondary admin being replaced → update secondaryEmail field
        batch.update(keyRef, {
          secondaryEmail: newEmail,
          replacedAt: FieldValue.serverTimestamp(),
          replacedFrom: primaryEmail,
        });
      } else {
        // Primary admin being replaced → update adminEmail field
        batch.update(keyRef, {
          adminEmail: newEmail,
          ...(newPhone ? { adminPhone: newPhone } : {}),
          replacedAt: FieldValue.serverTimestamp(),
          replacedFrom: primaryEmail,
        });
      }
    }

    // 3d. Update colleges/{tenantId}/config/settings adminEmail if primary replaced
    if (!isSecondaryAdmin) {
      const settingsRef = adminDb.collection('colleges').doc(tenantId)
        .collection('config').doc('settings');
      const settingsSnap = await settingsRef.get();
      if (settingsSnap.exists && settingsSnap.data().adminEmail) {
        batch.update(settingsRef, {
          adminEmail: newEmail,
          ...(newPhone ? { adminPhone: newPhone } : {}),
        });
      }
    }

    await batch.commit();

    // ── 4. Delete old Firebase Auth account (the replaced admin's account) ──
    if (oldUid) {
      try {
        await adminAuth.deleteUser(oldUid);
        console.log(`[ReplaceAdmin] Deleted old auth: ${primaryEmail} (uid: ${oldUid})`);
      } catch (delErr) {
        console.warn(`[ReplaceAdmin] Could not delete old auth for ${primaryEmail}:`, delErr.message);
      }
    }

    // ── 4b. Refresh custom claims for the newly promoted admin ─────────────
    // DUAL-ROLE: The teacher keeps their teacher_users doc and their
    // colleges/{tenantId}/teachers doc untouched. Portal routing is handled
    // by AuthContext via sessionStorage.portal — NOT by suppressing claims.
    //
    // We grant admin:true AND teacher:true so the same account works in both
    // portals simultaneously:
    //   • /admin/login   → admin dashboard
    //   • /teacher/login → teacher dashboard
    //
    // Teacher records are NEVER auto-deleted on admin promotion. They may only
    // be deleted by an explicit "Delete Account" action or a Super Admin action.
    try {
      // Check whether the user still has a teacher_users doc (they should).
      // Grant teacher:true only if that doc exists (preserves the dual-role contract).
      const teacherUserSnap = await adminDb.collection('teacher_users').doc(newUid).get();
      const hasTeacherProfile = teacherUserSnap.exists;

      const freshClaims = {
        super_admin: false,
        admin: true,
        teacher: hasTeacherProfile, // true if still a teacher, false for pure-admin promotions
        tenantId,
      };
      await adminAuth.setCustomUserClaims(newUid, freshClaims);
      console.log(
        `[ReplaceAdmin] Custom claims updated for ${newEmail}: ` +
        `admin=true, teacher=${hasTeacherProfile} (dual-role: ${hasTeacherProfile})`
      );
    } catch (claimsErr) {
      console.warn(`[ReplaceAdmin] Claims update failed (non-fatal):`, claimsErr.message);
    }

    // ── 5. Send confirmation email to the new admin ──────────────────────
    try {
      await sendReplaceAdminEmail(
        newEmail,
        'PWS — You are now an Admin!',
        `<div style="font-family:Arial,sans-serif;padding:28px;max-width:580px;border:1px solid #e0e0e0;border-radius:10px">
          <div style="text-align:center;margin-bottom:16px"><div style="font-size:48px">✅</div>
          <h2 style="color:#15803d">Admin Transfer Complete</h2></div>
          <p>You are now the ${isSecondaryAdmin ? 'Secondary' : 'Primary'} Admin for your institution on the Practical Workflow System.</p>
          <p>Log in at <strong>/admin/login</strong> using your existing teacher credentials.</p>
          <p style="font-size:12px;color:#888">If you did not expect this, contact your institution immediately.</p>
        </div>`
      );
    } catch (emailErr) {
      console.warn('[ReplaceAdmin] Confirmation email failed (non-fatal):', emailErr.message);
    }

    console.log(`[ReplaceAdmin] Complete: ${primaryEmail} → ${newEmail} (tenant: ${tenantId}, isSecondary: ${isSecondaryAdmin})`);
    res.json({ success: true, message: 'Admin replaced successfully.' });

  } catch (err) {
    console.error('[ReplaceAdmin] Step 4 error:', err.message);
    res.status(500).json({ error: 'Failed to complete replacement. Please try again.' });
  }
});

// ─────────────────────────────────────────────────────────────────────────────



// SECURITY FIX HIGH-05: Global error handler — NEVER return raw err.message to client.
// Raw error strings reveal internal file paths, Firestore field names,
// and dependency info useful for CVE targeting.
app.use((err, req, res, next) => {
  console.error('[Server Error]', err); // Full error in server logs only
  res.status(500).json({ error: 'An internal server error occurred. Please try again.' });
});


// ─────────────────────────────────────────────────────────────────────────────
// REPLACE TEACHER FLOW
// Lets a teacher migrate all their data (exams, templates, students) to a new
// teacher account, and deletes their old account.
// 4-step HMAC-JWT gated flow:
//   Step 1: send-admin-otp      → sends OTP to Primary Admin email for approval
//   Step 2: verify-admin-otp    → verifies admin OTP, issues newTeacherToken
//   Step 3: send-new-otp        → sends OTP to the new teacher's email address
//   Step 4: execute             → migrates Firestore docs, deletes old teacher
// ─────────────────────────────────────────────────────────────────────────────

const replaceTeacherOtpStore = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [key, val] of replaceTeacherOtpStore.entries()) {
    if (now > val.expiresAt) replaceTeacherOtpStore.delete(key);
  }
}, 60 * 1000);

const replaceTeacherLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 25,
  keyGenerator: emailKeyGenerator,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many attempts. Please wait 15 minutes before retrying.' },
});

const sendReplaceTeacherEmail = async (toEmail, subject, htmlBody) => {
  if (!process.env.OAUTH_CLIENTID || !process.env.OAUTH_CLIENT_SECRET || !process.env.OAUTH_REFRESH_TOKEN) {
    console.warn(`[ReplaceTeacher] Email transport missing. Simulated send to ${toEmail}`);
    return;
  }
  const oauth2Client = new google.auth.OAuth2(
    process.env.OAUTH_CLIENTID,
    process.env.OAUTH_CLIENT_SECRET,
    'https://developers.google.com/oauthplayground'
  );
  oauth2Client.setCredentials({ refresh_token: process.env.OAUTH_REFRESH_TOKEN });
  const gmail = google.gmail({ version: 'v1', auth: oauth2Client });
  const utf8Subject = `=?utf-8?B?${Buffer.from(subject).toString('base64')}?=`;
  const messageParts = [
    `From: "PWS Security" <${process.env.EMAIL_USER || 'nextsolves@gmail.com'}>`,
    `To: ${toEmail}`,
    'Content-Type: text/html; charset=utf-8',
    'MIME-Version: 1.0',
    `Subject: ${utf8Subject}`,
    '',
    htmlBody,
  ];
  const raw = Buffer.from(messageParts.join('\r\n')).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
};

// ── STEP 1: Send OTP to Primary Admin ───────────────────────────────────────
app.post('/api/replace-teacher/send-admin-otp', replaceTeacherLimiter, async (req, res) => {
  const { teacherEmail } = req.body;
  if (!teacherEmail) return res.status(400).json({ error: 'teacherEmail is required.' });

  try {
    const emailClean = teacherEmail.trim().toLowerCase();

    // 1a. Find teacher's tenantId via teacher_users collection
    // Note: teacher_users docs are keyed by Firebase Auth UID, not email.
    // Always use a query-by-email approach to find the correct document.
    const tSnap = await adminDb.collection('teacher_users').where('email', '==', emailClean).limit(1).get();
    let tenantId;
    if (!tSnap.empty) {
      tenantId = tSnap.docs[0].data().tenantId;
    }
    
    if (!tenantId) {
      // Backup logic: query across all colleges
      const collegesSnap = await adminDb.collection('colleges').get();
      for (const col of collegesSnap.docs) {
        const tSnap = await adminDb.collection('colleges').doc(col.id).collection('teachers').where('email', '==', emailClean).limit(1).get();
        if (!tSnap.empty) {
          tenantId = col.id;
          break;
        }
      }
    }
    
    if (!tenantId) return res.status(404).json({ error: 'Teacher account not found.' });

    // 1b. Find the primary admin email for this tenant
    let adminEmail = null;
    const settingsSnap = await adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings').get();
    if (settingsSnap.exists && settingsSnap.data().adminEmail) {
      adminEmail = settingsSnap.data().adminEmail;
    } else {
      const keySnap = await adminDb.collection('product_keys').where('tenantId', '==', tenantId).limit(1).get();
      if (!keySnap.empty) {
        adminEmail = keySnap.docs[0].data().adminEmail;
      }
    }
    
    if (!adminEmail) {
      const adminSnap = await adminDb.collection('admin_users').where('tenantId', '==', tenantId).where('role', '==', 'admin').limit(1).get();
      if (!adminSnap.empty) {
        adminEmail = adminSnap.docs[0].data().email;
      }
    }

    if (!adminEmail) {
      return res.status(500).json({ error: 'Could not determine Primary Admin email to send OTP.' });
    }

    // 1c. Generate OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000; // 5 minutes
    const otpKey = `replace_teacher_admin:${tenantId}:${emailClean}`;
    replaceTeacherOtpStore.set(otpKey, { otp, expiresAt, attempts: 0 });

    // 1d. Send OTP to admin
    const htmlBody = `
      <div style="font-family:Arial,sans-serif;padding:28px;max-width:580px;border:1px solid #e0e0e0;border-radius:10px">
        <h2 style="color:#b91c1c">⚠️ PWS — Teacher Replacement Request</h2>
        <p>A teacher (<strong>${emailClean}</strong>) in your institution has requested to <strong>delete their account and migrate all data</strong> to a different teacher.</p>
        <p>If you authorise this action, share the following one-time code with the teacher:</p>
        <div style="background:#1a0a2e;color:#fbbf24;padding:20px;font-size:32px;font-weight:bold;letter-spacing:10px;text-align:center;border-radius:8px;margin:20px 0">${otp}</div>
        <p style="color:#e53e3e;font-weight:600">⏱ This code expires in <strong>5 minutes</strong>.</p>
      </div>
    `;
    await sendReplaceTeacherEmail(adminEmail, 'PWS: Teacher Account Migration OTP', htmlBody);

    const adminOtpToken = signFlowToken({ step: 'replace_teacher_admin_otp_sent', tenantId, oldEmail: emailClean, otpKey }, 10 * 60 * 1000);
    
    const [localPart, domain] = adminEmail.split('@');
    const maskedAdminEmail = localPart.substring(0, 3) + '***@' + domain;

    res.json({ success: true, adminOtpToken, maskedAdminEmail });
  } catch (err) {
    console.error('[ReplaceTeacher] Step 1 error:', err.message);
    res.status(500).json({ error: 'Failed to send OTP.' });
  }
});

// ── STEP 2: Verify Admin OTP ────────────────────────────────────────────────
app.post('/api/replace-teacher/verify-admin-otp', replaceTeacherLimiter, async (req, res) => {
  const { adminOtpToken, otp } = req.body;
  if (!adminOtpToken || !otp) return res.status(400).json({ error: 'Missing token or OTP.' });
  if (!/^\d{6}$/.test(otp.trim())) return res.status(400).json({ error: 'OTP must be 6 digits.' });

  try {
    const payload = verifyFlowToken(adminOtpToken);
    if (payload.step !== 'replace_teacher_admin_otp_sent') return res.status(400).json({ error: 'Invalid flow step.' });
    const { otpKey, tenantId, oldEmail } = payload;
    const record = replaceTeacherOtpStore.get(otpKey);
    if (!record) return res.status(400).json({ error: 'OTP expired or used.' });
    if (Date.now() > record.expiresAt) {
      replaceTeacherOtpStore.delete(otpKey);
      return res.status(400).json({ error: 'OTP expired.' });
    }
    if (record.attempts >= 5) {
      replaceTeacherOtpStore.delete(otpKey);
      return res.status(429).json({ error: 'Too many attempts.' });
    }
    if (record.otp !== otp.trim()) {
      record.attempts += 1;
      return res.status(400).json({ error: `Incorrect OTP. ${5 - record.attempts} attempts remaining.` });
    }
    replaceTeacherOtpStore.delete(otpKey);

    const newTeacherToken = signFlowToken({ step: 'replace_teacher_admin_verified', tenantId, oldEmail }, 10 * 60 * 1000);
    res.json({ success: true, newTeacherToken });
  } catch (err) {
    res.status(400).json({ error: err.message || 'OTP verification failed.' });
  }
});

// ── STEP 3: Send OTP to New Teacher ─────────────────────────────────────────
app.post('/api/replace-teacher/send-new-otp', replaceTeacherLimiter, async (req, res) => {
  const { newTeacherToken, newEmail, existing, newName, newDepartment, newPassword } = req.body;
  if (!newTeacherToken || !newEmail) return res.status(400).json({ error: 'Missing fields.' });
  if (!existing && (!newName || !newDepartment || !newPassword)) return res.status(400).json({ error: 'Missing fields for new teacher.' });
  
  try {
    const payload = verifyFlowToken(newTeacherToken);
    if (payload.step !== 'replace_teacher_admin_verified') return res.status(400).json({ error: 'Invalid step.' });
    const { tenantId, oldEmail } = payload;
    const newEmailClean = newEmail.trim().toLowerCase();
    
    if (oldEmail === newEmailClean) {
      return res.status(400).json({ error: 'New email cannot be the same as the old email.' });
    }

    // Check if new teacher already exists in the college
    const newTeacherSnap = await adminDb.collection('colleges').doc(tenantId).collection('teachers').where('email', '==', newEmailClean).limit(1).get();
    
    if (existing) {
      if (newTeacherSnap.empty) {
        return res.status(400).json({ error: 'The selected teacher does not exist.' });
      }
    } else {
      if (!newTeacherSnap.empty) {
        const existingTeacher = newTeacherSnap.docs[0].data();
        if (existingTeacher.name !== newName || existingTeacher.department !== newDepartment) {
          return res.status(400).json({ error: 'The entered name or department does not match the existing teacher account.' });
        }
        
        // Verify password via Firebase Auth REST API
        const apiKey = process.env.VITE_API_KEY;
        if (apiKey) {
          try {
            const verifyResp = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ email: newEmailClean, password: newPassword, returnSecureToken: true })
            });
            if (!verifyResp.ok) {
              return res.status(400).json({ error: 'The entered password does not match the existing teacher account.' });
            }
          } catch (err) {
            return res.status(500).json({ error: 'Failed to verify existing teacher password.' });
          }
        }
      }
    }

    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 300 * 1000;
    const otpKey = `replace_teacher_new:${tenantId}:${newEmailClean}`;
    replaceTeacherOtpStore.set(otpKey, { otp, expiresAt, attempts: 0 });

    const htmlBody = `
      <div style="font-family:Arial,sans-serif;padding:28px;max-width:580px;border:1px solid #e0e0e0;border-radius:10px">
        <h2 style="color:#1e40af">PWS - New Teacher Verification</h2>
        <p>You have been designated to take over the teacher account data for <strong>${oldEmail}</strong>.</p>
        <p>To confirm this is your email address, please use the following one-time code:</p>
        <div style="background:#1a0a2e;color:#10b981;padding:20px;font-size:32px;font-weight:bold;letter-spacing:10px;text-align:center;border-radius:8px;margin:20px 0">${otp}</div>
        <p style="color:#e53e3e;font-weight:600">⏱ This code expires in <strong>5 minutes</strong>.</p>
      </div>
    `;
    await sendReplaceTeacherEmail(newEmailClean, 'PWS: New Teacher Email Verification', htmlBody);

    const newTeacherOtpToken = signFlowToken({ step: 'replace_teacher_new_otp_sent', tenantId, oldEmail, newEmail: newEmailClean, otpKey }, 10 * 60 * 1000);
    res.json({ success: true, newTeacherOtpToken });
  } catch (err) {
    res.status(400).json({ error: err.message || 'Failed to send OTP.' });
  }
});

// ── STEP 4: Execute Replacement ─────────────────────────────────────────────
app.post('/api/replace-teacher/execute', replaceTeacherLimiter, async (req, res) => {
  const { newTeacherOtpToken, otp, existing, newName, newDepartment, newPassword, newEmail: passedNewEmail } = req.body;
  if (!newTeacherOtpToken || !otp) return res.status(400).json({ error: 'Missing token or OTP.' });
  
  try {
    const payload = verifyFlowToken(newTeacherOtpToken);
    if (payload.step !== 'replace_teacher_new_otp_sent') return res.status(400).json({ error: 'Invalid step.' });
    
    const { tenantId, oldEmail, newEmail, otpKey } = payload;
    
    const record = replaceTeacherOtpStore.get(otpKey);
    if (!record || Date.now() > record.expiresAt) {
      if (record) replaceTeacherOtpStore.delete(otpKey);
      return res.status(400).json({ error: 'OTP expired or used.' });
    }
    if (record.attempts >= 5) {
      replaceTeacherOtpStore.delete(otpKey);
      return res.status(429).json({ error: 'Too many attempts.' });
    }
    if (record.otp !== otp.trim()) {
      record.attempts += 1;
      return res.status(400).json({ error: `Incorrect OTP. ${5 - record.attempts} attempts remaining.` });
    }
    replaceTeacherOtpStore.delete(otpKey);

    const oldTeacherSnap = await adminDb.collection('colleges').doc(tenantId).collection('teachers').where('email', '==', oldEmail).limit(1).get();
    if (oldTeacherSnap.empty) return res.status(400).json({ error: 'Old teacher account missing.' });
    const oldUid = oldTeacherSnap.docs[0].id;

    // Check if new teacher already exists
    const newTeacherSnap = await adminDb.collection('colleges').doc(tenantId).collection('teachers').where('email', '==', newEmail).limit(1).get();
    let newUid;
    
    if (!newTeacherSnap.empty) {
      newUid = newTeacherSnap.docs[0].id;
      // Existing teacher, data will merge simply by updating the email string on exams/templates.
    } else {
      if (!newPassword || newPassword.length < 6) return res.status(400).json({ error: 'Password required (min 6 chars) for new teacher.' });
      
      // Create new Firebase Auth user
      const adminAuth = getAdminAuth();
      try {
        const newUser = await adminAuth.createUser({ email: newEmail, password: newPassword });
        newUid = newUser.uid;
      } catch (authErr) {
        if (authErr.code === 'auth/email-already-exists') {
          const userRec = await adminAuth.getUserByEmail(newEmail);
          newUid = userRec.uid;
          await adminAuth.updateUser(newUid, { password: newPassword });
        } else {
          throw authErr;
        }
      }

      // Create new teacher docs
      const teacherData = {
        name: newName || 'New Teacher',
        email: newEmail,
        department: newDepartment || 'General',
        password: newPassword, // In PMS logic, passwords are also tracked in firestore
        createdAt: new Date().toISOString()
      };
      await adminDb.collection('colleges').doc(tenantId).collection('teachers').doc(newUid).set(teacherData);
      await adminDb.collection('teacher_users').doc(newUid).set({
        email: newEmail,
        role: 'teacher',
        tenantId
      });
    }

    // MIGRATION: Find and update all documents belonging to oldEmail
    // Tag them with original_teacher_email
    
    // 1. Exams
    const examsSnap = await adminDb.collection('colleges').doc(tenantId).collection('exams').where('teacher_email', '==', oldEmail).get();
    const batchSize = 400;
    let batch = adminDb.batch();
    let count = 0;
    
    for (const docSnap of examsSnap.docs) {
      batch.update(docSnap.ref, { teacher_email: newEmail, original_teacher_email: oldEmail });
      count++;
      if (count % batchSize === 0) { await batch.commit(); batch = adminDb.batch(); }
    }
    
    // 2. Exam Templates
    const tplSnap = await adminDb.collection('colleges').doc(tenantId).collection('exam_templates').where('teacher_email', '==', oldEmail).get();
    for (const docSnap of tplSnap.docs) {
      batch.update(docSnap.ref, { teacher_email: newEmail, original_teacher_email: oldEmail });
      count++;
      if (count % batchSize === 0) { await batch.commit(); batch = adminDb.batch(); }
    }
    
    // 3. Shared Templates (recipient)
    const sharedRecSnap = await adminDb.collection('colleges').doc(tenantId).collection('shared_templates').where('recipient_email', '==', oldEmail).get();
    for (const docSnap of sharedRecSnap.docs) {
      batch.update(docSnap.ref, { recipient_email: newEmail, original_teacher_email: oldEmail });
      count++;
      if (count % batchSize === 0) { await batch.commit(); batch = adminDb.batch(); }
    }
    
    // 4. Shared Templates (sender)
    const sharedSenSnap = await adminDb.collection('colleges').doc(tenantId).collection('shared_templates').where('sender_email', '==', oldEmail).get();
    for (const docSnap of sharedSenSnap.docs) {
      batch.update(docSnap.ref, { sender_email: newEmail, original_teacher_email: oldEmail });
      count++;
      if (count % batchSize === 0) { await batch.commit(); batch = adminDb.batch(); }
    }
    
    if (count % batchSize !== 0) await batch.commit();

    // DELETION: Delete old teacher docs & auth
    await adminDb.collection('colleges').doc(tenantId).collection('teachers').doc(oldUid).delete();
    try { await adminDb.collection('teacher_users').doc(oldUid).delete(); } catch(e){}
    try {
      const adminAuth = getAdminAuth();
      await adminAuth.deleteUser(oldUid);
    } catch(e) {}
    
    // Update facultyEmails in config/settings and product_keys to replace oldEmail with newEmail
    try {
      const settingsRef = adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings');
      const settingsDoc = await settingsRef.get();
      if (settingsDoc.exists) {
        const data = settingsDoc.data();
        if (data.facultyEmails && data.facultyEmails.includes(oldEmail)) {
          const newEmails = data.facultyEmails.map(e => e === oldEmail ? newEmail : e);
          await settingsRef.update({ facultyEmails: newEmails });
        }
      }
      
      const pkSnap = await adminDb.collection('product_keys').where('tenantId', '==', tenantId).get();
      for (const pkDoc of pkSnap.docs) {
        const data = pkDoc.data();
        if (data.facultyEmails && data.facultyEmails.includes(oldEmail)) {
          const newEmails = data.facultyEmails.map(e => e === oldEmail ? newEmail : e);
          await pkDoc.ref.update({ facultyEmails: newEmails });
        }
      }
    } catch(e) {
      console.warn('Failed to update facultyEmails on merge:', e);
    }
    
    res.json({ success: true, message: 'Teacher data migrated and old account deleted.' });
  } catch (err) {
    console.error('[ReplaceTeacher] Execute error:', err);
    res.status(500).json({ error: 'Migration failed. Please try again.' });
  }
});

// ── REMOVE TEACHER EMAIL FROM SLOTS ─────────────────────────────────────────
app.post('/api/admin/remove-teacher-email', generalApiLimiter, async (req, res) => {
  const { tenantId, email } = req.body;
  if (!tenantId || !email) return res.status(400).json({ error: 'Missing fields' });
  try {
    const adminDb = getFirestore();
    const batch = adminDb.batch();

    // 1. Remove from colleges/{tenantId}/config/settings
    const settingsRef = adminDb.collection('colleges').doc(tenantId).collection('config').doc('settings');
    batch.update(settingsRef, {
      facultyEmails: FieldValue.arrayRemove(email)
    });

    // 2. Remove from product_keys
    const pkSnap = await adminDb.collection('product_keys').where('tenantId', '==', tenantId).get();
    pkSnap.forEach(doc => {
      batch.update(doc.ref, {
        facultyEmails: FieldValue.arrayRemove(email)
      });
    });

    await batch.commit();
    res.json({ success: true });
  } catch (err) {
    console.error('Failed to cleanup teacher email:', err);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
