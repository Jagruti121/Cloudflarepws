import { initializeApp } from 'firebase/app';
import { getFirestore, collection, doc, setDoc } from 'firebase/firestore';

const firebaseConfig = {
  apiKey: "AIzaSyDWZ2f1wmz_syQz8fWpJumoziAyqPXdOms",
  authDomain: "local-24be0.firebaseapp.com",
  projectId: "local-24be0",
  storageBucket: "local-24be0.firebasestorage.app",
  messagingSenderId: "504537451801",
  appId: "1:504537451801:web:3aa8bdb3a9942b381b8988",
  measurementId: "G-8S4JN2GJMK"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

async function insertMock() {
  const mockKeyData = {
    productKey: 'PMS-TEST-1234',
    adminEmail: 'admin@testcollege.edu',
    adminPhone: '+91 9136234409',
    tenantId: 'tenant_test_123',
    collegeName: 'Test College',
    collegeCode: 'TC123',
    facultyLimit: 50,
    validUntil: new Date('2027-01-01').toISOString(),
    isActivated: false
  };

  try {
    const docRef = doc(collection(db, 'product_keys'));
    await setDoc(docRef, mockKeyData);
    console.log('Successfully inserted mock product key document.');
    console.log('Document ID:', docRef.id);
    console.log('Mock Data:', mockKeyData);
    process.exit(0);
  } catch (error) {
    console.error('Error inserting mock document:', error);
    process.exit(1);
  }
}

insertMock();
