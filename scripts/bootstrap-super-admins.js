/**
 * ONE-TIME BOOTSTRAP SCRIPT
 * Run with: node scripts/bootstrap-super-admins.js
 *
 * This script looks up existing Firebase Auth users by email
 * and creates their super_admins documents in Firestore.
 * Safe to run multiple times — it won't overwrite existing docs.
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const admin = require('firebase-admin');
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const serviceAccount = JSON.parse(
  readFileSync(join(__dirname, '../sa.json'), 'utf8')
);

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

const db = admin.firestore();
const authAdmin = admin.auth();

// ── List of emails to bootstrap as Super Admins ──
const SUPER_ADMIN_EMAILS = [
  'ommurkar34@gmail.com',
  'jagrutimorvekar@gmail.com',
];

async function bootstrapSuperAdmins() {
  console.log('🚀 Starting Super Admin bootstrap...\n');

  for (const email of SUPER_ADMIN_EMAILS) {
    try {
      // Look up the Firebase Auth user by email
      const userRecord = await authAdmin.getUserByEmail(email);
      const uid = userRecord.uid;

      console.log(`✅ Found Auth user: ${email} (uid: ${uid})`);

      // Check if super_admins doc already exists
      const docRef = db.collection('super_admins').doc(uid);
      const existing = await docRef.get();

      if (existing.exists) {
        console.log(`   ⏭  super_admins/${uid} already exists — skipping.\n`);
      } else {
        // Create the super_admins document
        await docRef.set({
          email: email,
          role: 'super_admin',
          createdAt: admin.firestore.FieldValue.serverTimestamp(),
        });
        console.log(`   🎉 Created super_admins/${uid} successfully!\n`);
      }

    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.warn(`   ⚠️  No Auth user found for ${email} — skipping.\n`);
      } else {
        console.error(`   ❌ Error processing ${email}:`, err.message, '\n');
      }
    }
  }

  console.log('✅ Bootstrap complete! You can now log in at:');
  console.log('   http://localhost:5173/super_admin/LIO-73-23/2372/SYSTEM\n');
  process.exit(0);
}

bootstrapSuperAdmins();
