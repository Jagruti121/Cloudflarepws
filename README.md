# PWS - Practical Workflow System

A secure, hybrid-web application to automate university practical examinations built with React (Vite) and Firebase.

## Features

### 🛡️ Admin Module (Cloud)
- Google OAuth authentication
- Create/Delete teacher accounts
- View all student submissions across all exams
- Export consolidated results as CSV

### 👩‍🏫 Teacher Module (Online)
- Email & Password authentication
- **Exam Creation Wizard** (4 steps):
  1. Config: Subject name, session code, marks distribution
  2. Student Upload: Upload Excel (.xlsx) with Roll No and Name
  3. Question Bank: Upload CSV with Question ID, Topic, Marks
  4. Launch: System generates randomized slips for each student
- **Live Dashboard**: Real-time status tracking
- **Approval System**: View drafts, approve for final submission
- **Grading**: Enter marks for Viva/Journal after submission

### 🧑‍🎓 Student Module (Lab/Local)
- Whitelist login (no password required)
- Access exam interface with assigned randomized questions
- Two-stage submission:
  - **Draft Mode**: Fill answers, request approval
  - **Approved Mode**: Final submit after teacher approval
- File upload support (images/output files)

## Tech Stack

- **Frontend**: React.js (Vite)
- **Styling**: Tailwind CSS
- **Backend**: Firebase Firestore (NoSQL)
- **Authentication**: Firebase Auth (Google OAuth for Admin, Email/Pass for Teachers)
- **Storage**: Firebase Storage (for student file uploads)
- **File Processing**: xlsx (Excel), papaparse (CSV)

## Setup Instructions

### 1. Prerequisites
- Node.js (v16 or higher)
- npm or yarn
- Firebase project with Firestore, Auth, and Storage enabled

### 2. Install Dependencies
```bash
npm install
```

### 3. Firebase Configuration

1. Create a Firebase project at [Firebase Console](https://console.firebase.google.com/)
2. Enable the following services:
   - **Authentication**: Enable Google Sign-in and Email/Password
   - **Firestore Database**: Create database in production mode
   - **Storage**: Enable Firebase Storage
3. Get your Firebase config from Project Settings
4. Update `src/firebase.js` with your Firebase configuration:

```javascript
const firebaseConfig = {
  apiKey: "your-api-key",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project-id",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "your-app-id"
};
```

### 4. Firestore Security Rules

Set up your Firestore security rules:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Teachers collection
    match /teachers/{teacherId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null && request.auth.uid == teacherId;
    }
    
    // Exams collection
    match /exams/{examId} {
      allow read: if request.auth != null;
      allow create: if request.auth != null;
      allow update, delete: if request.auth != null && 
        resource.data.teacher_email == request.auth.token.email;
    }
    
    // Questions collection
    match /questions/{questionId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
    
    // Students collection
    match /students/{studentId} {
      allow read: if request.auth != null;
      allow write: if request.auth != null;
    }
  }
}
```

### 5. Run Development Server
```bash
npm run dev
```

The application will be available at `http://localhost:5173`

### 6. Build for Production
```bash
npm run build
```

## File Format Requirements

### Student List (Excel .xlsx)
Required columns:
- `Roll No` (or `roll_no` or `RollNo`)
- `Name` (or `name`)

### Question Bank (CSV)
Required columns:
- `Question ID` (or `question_id` or `QuestionID`)
- `Topic` (or `topic`)
- `Marks` (or `marks`)

## Usage Flow

1. **Admin** creates teacher accounts
2. **Teacher** logs in and creates an exam using the wizard:
   - Uploads student list (Excel)
   - Uploads question bank (CSV)
   - System automatically generates randomized slips
3. **Students** log in using Roll No, Name, and Session Key
4. **Students** complete their assigned questions and request approval
5. **Teacher** reviews and approves drafts
6. **Students** submit final answers
7. **Teacher** enters Viva/Journal marks
8. **Admin** can export all results as CSV

## Project Structure

```
src/
├── components/
│   ├── Navbar.jsx           # Dynamic Navigation
│   ├── ProtectedRoute.jsx   # Route Guards
│   └── StatusBadge.jsx      # Status UI Component
├── context/
│   └── AuthContext.jsx      # Firebase Auth State
├── pages/
│   ├── Home.jsx             # Landing Page
│   ├── Admin/
│   │   ├── AdminLogin.jsx
│   │   └── AdminDashboard.jsx
│   ├── Teacher/
│   │   ├── TeacherLogin.jsx
│   │   ├── Dashboard.jsx
│   │   ├── ExamWizard.jsx
│   │   └── Monitor.jsx
│   └── Student/
│       ├── StudentLogin.jsx
│       └── ExamInterface.jsx
├── firebase.js              # Firebase Config
├── App.jsx                  # Router
└── main.jsx
```

## Key Features Implementation

### Slip Generation Algorithm
- Randomly selects questions for each student
- Ensures sum of question marks equals total practical marks
- Stored in `assigned_questions` array in student document

### Real-time Approval System
- Uses Firestore `onSnapshot` listeners for real-time updates
- Status flow: `registered` → `in_progress` → `approval_requested` → `approved` → `submitted`

### Student Whitelist Login
- No Firebase Auth required
- Database lookup validates Roll No + Name + Session Code
- Session stored in localStorage

## License

MIT

## Support

For issues or questions, please create an issue in the repository.

