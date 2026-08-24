import React from 'react';
import { useNavigate } from 'react-router-dom';

const Section = ({ number, title, children }) => (
  <section style={{ marginBottom: '36px' }}>
    <h2 style={{ fontSize: '17px', fontWeight: '700', color: '#1e3a5f', margin: '0 0 12px', paddingBottom: '8px', borderBottom: '2px solid #e0e7ff' }}>
      {number}. {title}
    </h2>
    <div style={{ fontSize: '14px', color: '#374151', lineHeight: '1.8' }}>
      {children}
    </div>
  </section>
);

const BulletList = ({ items }) => (
  <ul style={{ margin: '10px 0 10px 20px', padding: 0 }}>
    {items.map((item, i) => (
      <li key={i} style={{ marginBottom: '6px', paddingLeft: '4px' }}>{item}</li>
    ))}
  </ul>
);

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f0f4ff 0%, #e8eeff 100%)', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');`}</style>

      {/* Header Bar */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 20px rgba(30,58,95,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '28px' }}>🔒</span>
          <div>
            <div style={{ fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#93c5fd', fontWeight: '600' }}>NextSolves · PWS</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff' }}>Privacy Notice</div>
          </div>
        </div>
        <button
          onClick={() => navigate(-1)}
          style={{ background: 'rgba(255,255,255,0.15)', border: '1px solid rgba(255,255,255,0.3)', borderRadius: '8px', color: '#fff', padding: '8px 18px', fontSize: '13px', cursor: 'pointer', fontWeight: '600', transition: 'all 0.2s' }}
          onMouseOver={e => e.target.style.background = 'rgba(255,255,255,0.25)'}
          onMouseOut={e => e.target.style.background = 'rgba(255,255,255,0.15)'}
        >
          ← Go Back
        </button>
      </div>

      {/* Main Content */}
      <div style={{ maxWidth: '860px', margin: '0 auto', padding: '40px 24px 80px' }}>

        {/* Meta Card */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 36px', marginBottom: '32px', boxShadow: '0 4px 24px rgba(37,99,235,0.08)', border: '1px solid #e0e7ff' }}>
          <p style={{ margin: '0 0 6px', fontSize: '13px', color: '#6b7280' }}>Last updated: <strong>August 02, 2026</strong></p>
          <p style={{ margin: 0, fontSize: '14px', color: '#374151', lineHeight: '1.7' }}>
            This Privacy Notice for <strong>NextSolves</strong> ("we," "us," or "our") describes how and why we might access, collect, store, use, and/or share ("process") your personal information when you use our services ("Services"), including when you:
          </p>
          <BulletList items={[
            <>Visit our website at <a href="https://nextsolvespws.onrender.com" target="_blank" rel="noopener noreferrer" style={{ color: '#2563eb' }}>https://nextsolvespws.onrender.com</a> or any website of ours that links to this Privacy Notice</>,
            'Use NextSolves – Practical Workflow System (PWS). The PWS is an end-to-end software solution that fully digitizes the examination lifecycle. For practical exams, teachers upload a question bank, and the system automatically analyzes and distributes randomized digital question slips. Students take their exams in a locked digital environment, writing code directly into the system and uploading their outputs. Teachers can monitor live progress, approve submissions, track attendance, and assign grades from a real-time digital dashboard.',
            'Engage with us in other related ways, including any marketing or events.',
          ]} />
          <p style={{ margin: '12px 0 0', fontSize: '14px', color: '#374151' }}>
            Questions or concerns? Contact us at <a href="mailto:nextsolves@gmail.com" style={{ color: '#2563eb' }}>nextsolves@gmail.com</a>.
          </p>
        </div>

        {/* Summary of Key Points */}
        <div style={{ background: '#eff6ff', borderRadius: '12px', padding: '24px 28px', marginBottom: '32px', border: '1px solid #bfdbfe' }}>
          <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#1e40af', margin: '0 0 14px' }}>📋 SUMMARY OF KEY POINTS</h2>
          {[
            ['What personal information do we process?', 'When you visit, use, or navigate our Services, we may process personal information depending on how you interact with us and the Services, the choices you make, and the products and features you use.'],
            ['Do we process any sensitive personal information?', 'Some information may be considered "special" or "sensitive" in certain jurisdictions. We may process sensitive personal information when necessary with your consent or as otherwise permitted by applicable law.'],
            ['Do we collect any information from third parties?', 'We do not collect any information from third parties.'],
            ['How do we process your information?', 'We process your information to provide, improve, and administer our Services, communicate with you, for security and fraud prevention, and to comply with law.'],
            ['How do we keep your information safe?', 'We have adequate organizational and technical processes and procedures in place to protect your personal information. However, no electronic transmission can be guaranteed to be 100% secure.'],
          ].map(([title, body], i) => (
            <div key={i} style={{ marginBottom: '12px', paddingBottom: '12px', borderBottom: i < 4 ? '1px solid #bfdbfe' : 'none' }}>
              <p style={{ margin: '0 0 4px', fontWeight: '600', fontSize: '13px', color: '#1e40af' }}>{title}</p>
              <p style={{ margin: 0, fontSize: '13px', color: '#374151', lineHeight: '1.6' }}>{body}</p>
            </div>
          ))}
        </div>

        {/* Table of Contents */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 28px', marginBottom: '32px', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#1f2937', margin: '0 0 14px' }}>TABLE OF CONTENTS</h2>
          {[
            'WHAT INFORMATION DO WE COLLECT?',
            'HOW DO WE PROCESS YOUR INFORMATION?',
            'WHEN AND WITH WHOM DO WE SHARE YOUR PERSONAL INFORMATION?',
            'DO WE USE COOKIES AND OTHER TRACKING TECHNOLOGIES?',
            'HOW LONG DO WE KEEP YOUR INFORMATION?',
            'HOW DO WE KEEP YOUR INFORMATION SAFE?',
            'WHAT ARE YOUR PRIVACY RIGHTS?',
            'CONTROLS FOR DO-NOT-TRACK FEATURES',
            'DO WE MAKE UPDATES TO THIS NOTICE?',
            'HOW CAN YOU CONTACT US ABOUT THIS NOTICE?',
            'HOW CAN YOU REVIEW, UPDATE, OR DELETE THE DATA WE COLLECT FROM YOU?',
          ].map((item, i) => (
            <div key={i} style={{ fontSize: '13px', color: '#4b5563', padding: '4px 0', display: 'flex', gap: '10px' }}>
              <span style={{ color: '#2563eb', fontWeight: '600', minWidth: '22px' }}>{i + 1}.</span>
              <span>{item}</span>
            </div>
          ))}
        </div>

        {/* Sections */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '36px', boxShadow: '0 4px 24px rgba(37,99,235,0.08)', border: '1px solid #e0e7ff' }}>

          <Section number="1" title="WHAT INFORMATION DO WE COLLECT?">
            <p><strong>Personal information you disclose to us</strong></p>
            <p>We collect personal information that you voluntarily provide to us when you register on the Services, express an interest in obtaining information about us or our products and Services, when you participate in activities on the Services, or otherwise when you contact us.</p>
            <p>The personal information we collect may include the following:</p>
            <BulletList items={['Names', 'Email addresses', 'Usernames', 'Passwords', 'Job titles', 'Roll numbers', 'Uploaded files']} />
            <p><strong>Sensitive Information.</strong> When necessary, with your consent or as otherwise permitted by applicable law, we process the following categories of sensitive information:</p>
            <BulletList items={['Student data', 'College faculty data', 'College data', 'Student academic data']} />
            <p><strong>Information automatically collected</strong></p>
            <p>We automatically collect certain information when you visit, use, or navigate the Services. This may include device and usage information, such as your IP address, browser and device characteristics, operating system, language preferences, and other technical information. The information we collect includes:</p>
            <BulletList items={[
              'Log and Usage Data — IP address, device information, browser type, activity timestamps, pages and files viewed.',
              'Device Data — Computer, phone, tablet or other device information used to access the Services.',
              'Location Data — Device location data, which can be either precise or imprecise.',
              'Student Academic Data — Student identification (names, roll numbers) and academic performance (marks). Processed securely to generate private, highly confidential analytical reports exclusively for the respective colleges.',
            ]} />
          </Section>

          <Section number="2" title="HOW DO WE PROCESS YOUR INFORMATION?">
            <p>We process your personal information for a variety of reasons, depending on how you interact with our Services, including:</p>
            <BulletList items={[
              'To facilitate account creation and authentication and otherwise manage user accounts.',
              'To deliver and facilitate delivery of services to the user.',
              'To respond to user inquiries/offer support to users.',
              'To send administrative information to you.',
              'To fulfill and manage your orders.',
              'To enable user-to-user communications.',
              'Student Academic Data — Information including student identification (names, roll numbers, photo) and academic performance (marks and files uploaded). This data is processed securely to generate private, highly confidential analytical reports exclusively for the respective colleges.',
              'College faculty — Using email IDs, department, phone number, name information for authentication.',
            ]} />
          </Section>

          <Section number="3" title="WHEN AND WITH WHOM DO WE SHARE YOUR PERSONAL INFORMATION?">
            <p>We may share your data with third-party vendors, service providers, contractors, or agents who perform services for us or on our behalf. The categories of third parties we may share personal information with are as follows:</p>
            <BulletList items={['Cloud Computing Services', 'Communication & Collaboration Tools', 'Data Storage Service Providers', 'Performance Monitoring Tools', 'User Account Registration & Authentication Services', 'Website Hosting Service Providers']} />
            <p>We also may need to share your personal information in the following situations:</p>
            <BulletList items={['Business Transfers — We may share or transfer your information in connection with any merger, sale of company assets, financing, or acquisition of all or a portion of our business to another company.']} />
          </Section>

          <Section number="4" title="DO WE USE COOKIES AND OTHER TRACKING TECHNOLOGIES?">
            <p>We may use cookies and similar tracking technologies (like web beacons and pixels) to gather information when you interact with our Services. Some online tracking technologies help us maintain the security of our Services and your account, prevent crashes, fix bugs, save your preferences, and assist with basic site functions.</p>
            <p>We also permit third parties and service providers to use online tracking technologies on our Services for analytics and advertising purposes. Specific information about how we use such technologies and how you can refuse certain cookies is set out in our Cookie Notice.</p>
          </Section>

          <Section number="5" title="HOW LONG DO WE KEEP YOUR INFORMATION?">
            <p>We will only keep your personal information for as long as it is necessary for the purposes set out in this Privacy Notice, unless a longer retention period is required or permitted by law (such as tax, accounting, or other legal requirements). No purpose in this notice will require us keeping your personal information for longer than the period of time in which users have an account with us.</p>
            <p>When we have no ongoing legitimate business need to process your personal information, we will either delete or anonymize such information.</p>
          </Section>

          <Section number="6" title="HOW DO WE KEEP YOUR INFORMATION SAFE?">
            <p>We have implemented appropriate and reasonable technical and organizational security measures designed to protect the security of any personal information we process. However, despite our safeguards and efforts to secure your information, no electronic transmission over the Internet or information storage technology can be guaranteed to be 100% secure.</p>
            <p>Although we will do our best to protect your personal information, transmission of personal information to and from our Services is at your own risk. You should only access the Services within a secure environment.</p>
          </Section>

          <Section number="7" title="WHAT ARE YOUR PRIVACY RIGHTS?">
            <p><strong>Withdrawing your consent:</strong> If we are relying on your consent to process your personal information, you have the right to withdraw your consent at any time by contacting us using the details provided below. However, please note that this will not affect the lawfulness of the processing before its withdrawal.</p>
            <p><strong>Account Information:</strong> If you would at any time like to review or change the information in your account or terminate your account, you can:</p>
            <BulletList items={['Log in to your account settings and update your user account.', 'Contact us using the contact information provided.']} />
            <p>If you have questions or comments about your privacy rights, you may email us at <a href="mailto:nextsolves@gmail.com" style={{ color: '#2563eb' }}>nextsolves@gmail.com</a>.</p>
          </Section>

          <Section number="8" title="CONTROLS FOR DO-NOT-TRACK FEATURES">
            <p>Most web browsers and some mobile operating systems include a Do-Not-Track ("DNT") feature or setting you can activate to signal your privacy preference not to have data about your online browsing activities monitored and collected. At this stage, no uniform technology standard for recognizing and implementing DNT signals has been finalized. As such, we do not currently respond to DNT browser signals or any other mechanism that automatically communicates your choice not to be tracked online.</p>
          </Section>

          <Section number="9" title="DO WE MAKE UPDATES TO THIS NOTICE?">
            <p>Yes, we will update this notice as necessary to stay compliant with relevant laws. We may update this Privacy Notice from time to time. The updated version will be indicated by an updated "Revised" date at the top of this Privacy Notice. If we make material changes to this Privacy Notice, we may notify you either by prominently posting a notice of such changes or by directly sending you a notification.</p>
          </Section>

          <Section number="10" title="HOW CAN YOU CONTACT US ABOUT THIS NOTICE?">
            <p>If you have questions or comments about this notice, you may contact our Data Protection Officer (DPO):</p>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px', marginTop: '12px' }}>
              <p style={{ margin: '0 0 6px', fontWeight: '600', color: '#1f2937' }}>NextSolves — Data Protection Officer</p>
              <p style={{ margin: '0 0 4px', color: '#374151' }}>📧 <a href="mailto:nextsolves@gmail.com" style={{ color: '#2563eb' }}>nextsolves@gmail.com</a></p>
              <p style={{ margin: '0 0 4px', color: '#374151' }}>📞 9136234409 / 9321632938</p>
              <p style={{ margin: 0, color: '#374151' }}>📍 Goregaon East, Mumbai, Maharashtra – 400065, India</p>
            </div>
          </Section>

          <Section number="11" title="HOW CAN YOU REVIEW, UPDATE, OR DELETE THE DATA WE COLLECT FROM YOU?">
            <p>Based on the applicable laws of your country, you may have the right to request access to the personal information we collect from you, details about how we have processed it, correct inaccuracies, or delete your personal information. You may also have the right to withdraw your consent to our processing of your personal information. These rights may be limited in some circumstances by applicable law.</p>
            <p>To exercise these rights, please contact us at <a href="mailto:nextsolves@gmail.com" style={{ color: '#2563eb' }}>nextsolves@gmail.com</a>.</p>
          </Section>

        </div>

        {/* Footer note */}
        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'linear-gradient(135deg, #2563eb, #4f46e5)', border: 'none', borderRadius: '10px', color: '#fff', padding: '12px 32px', fontSize: '14px', cursor: 'pointer', fontWeight: '600', boxShadow: '0 4px 14px rgba(37,99,235,0.35)' }}
          >
            ← Return to Consent Screen
          </button>
          <p style={{ marginTop: '12px', fontSize: '12px', color: '#9ca3af' }}>© 2026 NextSolves · Practical Workflow System</p>
        </div>
      </div>
    </div>
  );
};

export default PrivacyPolicy;
