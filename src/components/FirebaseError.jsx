const FirebaseError = () => {
  return (
    <div className="min-h-screen bg-red-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl p-8 max-w-2xl">
        <div className="text-center mb-6">
          <div className="text-5xl mb-4">⚠️</div>
          <h1 className="text-3xl font-bold text-red-800 mb-2">Firebase Configuration Error</h1>
        </div>
        
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded mb-4">
          <p className="font-bold mb-2">The Firebase configuration is incorrect.</p>
          <p>You're using a <strong>service account</strong> format, but you need the <strong>web app</strong> configuration.</p>
        </div>

        <div className="space-y-4">
          <h2 className="font-bold text-lg">How to fix:</h2>
          <ol className="list-decimal list-inside space-y-2 text-gray-700">
            <li>Go to <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">Firebase Console</a></li>
            <li>Select your project: <strong>pws-om-jagruti</strong></li>
            <li>Click the gear icon ⚙️ → <strong>Project Settings</strong></li>
            <li>Scroll down to <strong>"Your apps"</strong> section</li>
            <li>If you don't have a web app, click <strong>"Add app"</strong> → Select <strong>Web</strong> (the &lt;/&gt; icon)</li>
            <li>Copy the config object that looks like this:</li>
          </ol>
          
          <pre className="bg-gray-100 p-4 rounded text-sm overflow-x-auto">
{`const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "pws-om-jagruti.firebaseapp.com",
  projectId: "pws-om-jagruti",
  storageBucket: "pws-om-jagruti.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abc123"
};`}
          </pre>
          
          <p className="text-sm text-gray-600">
            Replace the config in <code className="bg-gray-200 px-1 rounded">src/firebase.js</code> with the values from Firebase Console.
          </p>
        </div>
      </div>
    </div>
  );
};

export default FirebaseError;

