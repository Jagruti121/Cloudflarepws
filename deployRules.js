import { initializeApp, cert } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config();

const serviceAccount = {
  projectId: process.env.VITE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};

const app = initializeApp({
  credential: cert(serviceAccount)
});

async function deployRules() {
  try {
    const rulesSource = fs.readFileSync(path.join(__dirname, 'firestore.rules'), 'utf8');
    
    console.log('Deploying Firestore rules...');
    
    // Release to the default database directly
    await getSecurityRules(app).releaseFirestoreRulesetFromSource(rulesSource);
    
    console.log('✅ Firestore rules deployed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error deploying rules:');
    if (err.response && err.response.data) {
      console.error(JSON.stringify(err.response.data, null, 2));
    } else if (err.errors) {
      console.error(JSON.stringify(err.errors, null, 2));
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}

deployRules();
