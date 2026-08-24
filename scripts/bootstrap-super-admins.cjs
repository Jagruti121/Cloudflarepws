/**
 * ONE-TIME BOOTSTRAP SCRIPT
 * Run with: node scripts/bootstrap-super-admins.cjs
 *
 * Creates super_admins Firestore documents for existing Firebase Auth users.
 * Safe to run multiple times — skips docs that already exist.
 */

const { initializeApp, cert } = require('firebase-admin/app');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');
const { getAuth } = require('firebase-admin/auth');
const serviceAccount = require('../sa.json');

initializeApp({
  credential: cert(serviceAccount),
});

const db = getFirestore();
const authAdmin = getAuth();

// List of emails to bootstrap as Super Admins
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

      console.log(`✅ Found Auth user: ${email}`);
      console.log(`   UID: ${uid}`);

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
          createdAt: FieldValue.serverTimestamp(),
        });
        console.log(`   🎉 Created super_admins document successfully!\n`);
      }

    } catch (err) {
      if (err.code === 'auth/user-not-found') {
        console.warn(`   ⚠️  No Auth user found for ${email} — skipping.\n`);
      } else {
        console.error(`   ❌ Error processing ${email}:`, err.message, '\n');
      }
    }
  }

  console.log('─────────────────────────────────────────────');
  console.log('✅ Bootstrap complete!');
  console.log('   Login at: http://localhost:5173/super_admin/LIO-73-23/2372/SYSTEM');
  console.log('─────────────────────────────────────────────\n');
  process.exit(0);
}

bootstrapSuperAdmins();
