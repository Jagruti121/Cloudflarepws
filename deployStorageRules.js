import { initializeApp, cert } from 'firebase-admin/app';
import { getSecurityRules } from 'firebase-admin/security-rules';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const serviceAccount = {
  projectId: process.env.VITE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
};

const app = initializeApp({
  credential: cert(serviceAccount),
  storageBucket: process.env.VITE_STORAGE_BUCKET
});

// Read the secure rules from storage.rules (same directory as this script)
const rulesSource = readFileSync(resolve(__dirname, 'storage.rules'), 'utf8');

async function deployRules() {
  try {
    console.log('Deploying Storage rules...');
    console.log('Rules source:\n', rulesSource);

    // Release to the default bucket
    await getSecurityRules(app).releaseStorageRulesetFromSource(rulesSource);

    console.log('✅ Storage rules deployed successfully!');
    process.exit(0);
  } catch (err) {
    console.error('❌ Error deploying rules:');
    console.error(err);
    process.exit(1);
  }
}

deployRules();

