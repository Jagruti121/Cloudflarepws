import admin from 'firebase-admin';
import { readFileSync } from 'fs';
import { join } from 'path';

const serviceAccount = JSON.parse(readFileSync(join(process.cwd(), 'serviceAccountKey.json'), 'utf8'));
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

async function check() {
  const snaps = await db.collection('colleges').doc('DEMO_TENANT').collection('students').where('exam_type', '==', 'internal').limit(5).get();
  snaps.forEach(doc => {
    console.log(doc.id, JSON.stringify(doc.data().answers, null, 2));
  });
  process.exit(0);
}
check().catch(console.error);
