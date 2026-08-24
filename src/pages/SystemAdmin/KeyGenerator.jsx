import React, { useState } from 'react';
import { db } from '../../firebase';
import { collection, addDoc, serverTimestamp, doc, setDoc } from 'firebase/firestore';

const KeyGenerator = () => {
  const [loading, setLoading] = useState(false);
  const [generatedKey, setGeneratedKey] = useState('');
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const [formData, setFormData] = useState({
    collegeName: '',
    collegeRegistrationNumber: '',
    facultyLimit: 50,
    adminEmail: '',
    secondaryEmail: '',
    adminPhone: '',
    validUntil: '',
    paymentDetails: ''
  });

  const handleInputChange = (e) => {
    setFormData({
      ...formData,
      [e.target.name]: e.target.value
    });
  };

  const generateRandomKey = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    let result = 'PWS-';
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    result += '-';
    for (let i = 0; i < 4; i++) result += chars.charAt(Math.floor(Math.random() * chars.length));
    return result;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    setSuccess('');
    setGeneratedKey('');

    try {
      const newKey = generateRandomKey();
      const tenantId = `tenant_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

      const keyData = {
        productKey: newKey,
        tenantId: tenantId,
        collegeName: formData.collegeName,
        collegeCode: formData.collegeRegistrationNumber, // Using collegeCode mapping
        facultyLimit: parseInt(formData.facultyLimit, 10),
        adminEmail: formData.adminEmail,
        secondaryEmail: formData.secondaryEmail,
        adminPhone: formData.adminPhone,
        validUntil: new Date(formData.validUntil).toISOString(),
        paymentDetails: formData.paymentDetails,
        isActivated: false,
        createdAt: serverTimestamp()
      };

      // Add to product_keys collection
      // Generating a specific doc ID or letting Firestore do it
      const docRef = doc(collection(db, 'product_keys'));
      await setDoc(docRef, keyData);

      setGeneratedKey(newKey);
      setSuccess('Product Key generated and saved successfully!');
      
      // Optionally reset form
      // setFormData({...});
      
    } catch (err) {
      console.error("Error generating key:", err);
      setError('Failed to generate product key. Ensure you have proper Firestore permissions.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-100 flex py-12 px-4 sm:px-6 lg:px-8 justify-center">
      <div className="max-w-2xl w-full space-y-8 bg-white p-10 rounded-xl shadow-2xl">
        <div>
          <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
            System Admin: Product Key Generator
          </h2>
          <p className="mt-2 text-center text-sm text-gray-600">
            Generate activation keys for new colleges
          </p>
        </div>

        {error && (
          <div className="bg-red-50 border-l-4 border-red-400 p-4 mb-4">
            <p className="text-sm text-red-700">{error}</p>
          </div>
        )}

        {success && (
          <div className="bg-green-50 border-l-4 border-green-400 p-4 mb-4">
            <p className="text-sm text-green-700">{success}</p>
            <div className="mt-4 p-4 bg-gray-900 rounded-lg text-center">
              <p className="text-gray-300 text-sm mb-1">Generated Product Key:</p>
              <p className="text-2xl font-mono text-green-400 font-bold tracking-wider">{generatedKey}</p>
              <p className="text-gray-400 text-xs mt-2">Copy this key and send it to the college admin.</p>
            </div>
          </div>
        )}

        <form className="mt-8 space-y-6" onSubmit={handleSubmit}>
          <div className="grid grid-cols-1 gap-y-6 gap-x-4 sm:grid-cols-2">
            
            {/* College Name */}
            <div className="sm:col-span-2">
              <label htmlFor="collegeName" className="block text-sm font-medium text-gray-700">College Name</label>
              <div className="mt-1">
                <input type="text" name="collegeName" id="collegeName" required value={formData.collegeName} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
            </div>

            {/* Registration Number */}
            <div>
              <label htmlFor="collegeRegistrationNumber" className="block text-sm font-medium text-gray-700">Registration Number</label>
              <div className="mt-1">
                <input type="text" name="collegeRegistrationNumber" id="collegeRegistrationNumber" required value={formData.collegeRegistrationNumber} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
            </div>

            {/* Faculty Limit */}
            <div>
              <label htmlFor="facultyLimit" className="block text-sm font-medium text-gray-700">Faculty Limit</label>
              <div className="mt-1">
                <input type="number" name="facultyLimit" id="facultyLimit" min="1" required value={formData.facultyLimit} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
            </div>

            {/* Primary Email */}
            <div>
              <label htmlFor="adminEmail" className="block text-sm font-medium text-gray-700">Primary Admin Email</label>
              <div className="mt-1">
                <input type="email" name="adminEmail" id="adminEmail" required value={formData.adminEmail} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
            </div>

            {/* Secondary Email */}
            <div>
              <label htmlFor="secondaryEmail" className="block text-sm font-medium text-gray-700">Secondary Email (Optional)</label>
              <div className="mt-1">
                <input type="email" name="secondaryEmail" id="secondaryEmail" value={formData.secondaryEmail} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
            </div>

            {/* Admin Phone */}
            <div className="sm:col-span-2">
              <label htmlFor="adminPhone" className="block text-sm font-medium text-gray-700">Admin Phone Number (with Country Code)</label>
              <div className="mt-1">
                <input type="tel" name="adminPhone" id="adminPhone" placeholder="+919876543210" required value={formData.adminPhone} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
              <p className="mt-2 text-sm text-gray-500">Must include country code. They will need this number to receive the activation OTP.</p>
            </div>

            {/* Valid Until */}
            <div>
              <label htmlFor="validUntil" className="block text-sm font-medium text-gray-700">Validity Date</label>
              <div className="mt-1">
                <input type="date" name="validUntil" id="validUntil" required value={formData.validUntil} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
            </div>

            {/* Payment Details */}
            <div>
              <label htmlFor="paymentDetails" className="block text-sm font-medium text-gray-700">Payment History / Ref</label>
              <div className="mt-1">
                <input type="text" name="paymentDetails" id="paymentDetails" value={formData.paymentDetails} onChange={handleInputChange} className="shadow-sm focus:ring-indigo-500 focus:border-indigo-500 block w-full sm:text-sm border-gray-300 rounded-md p-2 border" />
              </div>
            </div>

          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="group relative w-full flex justify-center py-3 px-4 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
            >
              {loading ? 'Generating...' : 'Generate Product Key'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default KeyGenerator;
