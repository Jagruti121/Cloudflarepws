import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';

// ✅ Correct project: pms-om-jagruti-7bfbd (same as the main app)
const firebaseConfig = {
  apiKey: "AIzaSyBaO721WavYj0xnGVhg6x1ciqStbj_uUi0",
  authDomain: "pms-om-jagruti-7bfbd.firebaseapp.com",
  projectId: "pms-om-jagruti-7bfbd",
  storageBucket: "pms-om-jagruti-7bfbd.firebasestorage.app",
  messagingSenderId: "495010276674",
  appId: "1:495010276674:web:3ec32c5ddb9285c88714db",
  measurementId: "G-LB7PBHVJS4"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function insertKey() {
  const keyData = {
    productKey: 'PMS-407O-P8WY-BYEX',
    adminEmail: 'ommurkar34@gmail.com',
    adminPhone: '9136234409',
    tenantId: 'tenant_ommurkar_001',
    collegeName: 'Your College',
    collegeCode: 'YC001',
    facultyLimit: 50,
    facultyEmails: [],
    validUntil: new Date('2027-12-31').toISOString(),
    isActivated: false,
    createdAt: new Date().toISOString(),
  };

  try {
    const docRef = doc(collection(db, 'product_keys'));
    await setDoc(docRef, keyData);
    console.log('✅ Successfully inserted product key into pms-om-jagruti-7bfbd!');
    console.log('Document ID:', docRef.id);
    console.log('Key Data:', keyData);
    process.exit(0);
  } catch (error) {
    console.error('❌ Error inserting document:', error.message);
    console.error('Code:', error.code);
    process.exit(1);
  }
}

insertKey();
