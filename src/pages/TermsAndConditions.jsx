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

const TermsAndConditions = () => {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: 'linear-gradient(135deg, #f0f4ff 0%, #e8eeff 100%)', fontFamily: "'Inter', 'Segoe UI', sans-serif" }}>
      <style>{`@import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700&display=swap');`}</style>

      {/* Header Bar */}
      <div style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #4f46e5 100%)', padding: '20px 32px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 20px rgba(79,70,229,0.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '28px' }}>📜</span>
          <div>
            <div style={{ fontSize: '11px', letterSpacing: '2px', textTransform: 'uppercase', color: '#a5b4fc', fontWeight: '600' }}>NextSolves · PWS</div>
            <div style={{ fontSize: '20px', fontWeight: '700', color: '#ffffff' }}>Terms & Conditions</div>
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

        {/* Agreement Banner */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '28px 36px', marginBottom: '32px', boxShadow: '0 4px 24px rgba(79,70,229,0.08)', border: '1px solid #e0e7ff' }}>
          <p style={{ margin: '0 0 6px', fontSize: '13px', color: '#6b7280' }}>Last updated: <strong>August 02, 2026</strong></p>
          <h2 style={{ fontSize: '18px', fontWeight: '700', color: '#1e3a5f', margin: '10px 0 14px' }}>AGREEMENT TO OUR LEGAL TERMS</h2>
          <p style={{ margin: '0 0 14px', fontSize: '14px', color: '#374151', lineHeight: '1.7' }}>
            We are <strong>NextSolves</strong> ("Company," "we," "us," "our"). We operate the website <a href="https://nextsolvespws.onrender.com" target="_blank" rel="noopener noreferrer" style={{ color: '#4f46e5' }}>https://nextsolvespws.onrender.com</a> (the "Site"), as well as any other related products and services that refer or link to these legal terms (the "Legal Terms") (collectively, the "Services").
          </p>
          <div style={{ background: '#f5f3ff', borderRadius: '10px', padding: '16px 20px', border: '1px solid #ddd6fe', marginBottom: '14px' }}>
            <p style={{ margin: 0, fontSize: '14px', color: '#374151', lineHeight: '1.7' }}>
              The <strong>PRACTICAL WORKFLOW SYSTEM (PWS)</strong> is an end-to-end software solution that fully digitizes the examination lifecycle. For practical exams, teachers upload a question bank, and the system automatically analyzes and distributes randomized digital question slips. Students take their exams in a locked digital environment, writing code directly into the system and uploading their outputs—eliminating the need to write anything on paper. Teachers can monitor live progress, approve submissions, track attendance, and assign grades from a real-time digital dashboard without leaving their seats. For internal MCQ exams, the system fully automates question distribution and grading, instantly generating comprehensive results.
            </p>
          </div>
          <p style={{ margin: '0 0 10px', fontSize: '14px', color: '#374151' }}>
            You can contact us by phone at <strong>(+91) 9136234409 / 9321632938</strong>, email at <a href="mailto:nextsolves@gmail.com" style={{ color: '#4f46e5' }}>nextsolves@gmail.com</a>, or by mail to Goregaon East, Mumbai, Maharashtra 400065, India.
          </p>
          <div style={{ background: '#fef2f2', borderRadius: '8px', padding: '12px 16px', border: '1px solid #fca5a5' }}>
            <p style={{ margin: 0, fontSize: '13px', color: '#dc2626', fontWeight: '600', lineHeight: '1.6' }}>
              ⚠️ IMPORTANT: By accessing the Services, you have read, understood, and agreed to be bound by all of these Legal Terms. IF YOU DO NOT AGREE WITH ALL OF THESE LEGAL TERMS, THEN YOU ARE EXPRESSLY PROHIBITED FROM USING THE SERVICES AND YOU MUST DISCONTINUE USE IMMEDIATELY.
            </p>
          </div>
          <p style={{ margin: '14px 0 0', fontSize: '13px', color: '#6b7280' }}>
            The Services are intended for users who are at least 13 years of age. All users who are minors must have the permission of, and be directly supervised by, their parent or guardian to use the Services.
          </p>
        </div>

        {/* Table of Contents */}
        <div style={{ background: '#fff', borderRadius: '12px', padding: '24px 28px', marginBottom: '32px', border: '1px solid #e5e7eb', boxShadow: '0 2px 8px rgba(0,0,0,0.04)' }}>
          <h2 style={{ fontSize: '15px', fontWeight: '700', color: '#1f2937', margin: '0 0 14px' }}>TABLE OF CONTENTS</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '4px' }}>
            {[
              'OUR SERVICES', 'INTELLECTUAL PROPERTY RIGHTS', 'USER REPRESENTATIONS', 'USER REGISTRATION',
              'PURCHASES AND PAYMENT', 'SUBSCRIPTIONS', 'PROHIBITED ACTIVITIES', 'USER GENERATED CONTRIBUTIONS',
              'CONTRIBUTION LICENSE', 'GUIDELINES FOR REVIEWS', 'SERVICES MANAGEMENT', 'PRIVACY POLICY',
              'COPYRIGHT INFRINGEMENTS', 'TERM AND TERMINATION', 'MODIFICATIONS AND INTERRUPTIONS', 'GOVERNING LAW',
              'DISPUTE RESOLUTION', 'CORRECTIONS', 'DISCLAIMER', 'LIMITATIONS OF LIABILITY',
              'INDEMNIFICATION', 'USER DATA', 'ELECTRONIC COMMUNICATIONS, TRANSACTIONS, AND SIGNATURES', 'MISCELLANEOUS', 'CONTACT US'
            ].map((item, i) => (
              <div key={i} style={{ fontSize: '12px', color: '#4b5563', padding: '3px 0', display: 'flex', gap: '8px' }}>
                <span style={{ color: '#4f46e5', fontWeight: '600', minWidth: '20px' }}>{i + 1}.</span>
                <span>{item}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sections */}
        <div style={{ background: '#fff', borderRadius: '16px', padding: '36px', boxShadow: '0 4px 24px rgba(79,70,229,0.08)', border: '1px solid #e0e7ff' }}>

          <Section number="1" title="OUR SERVICES">
            <p>The information provided when using the Services is not intended for distribution to or use by any person or entity in any jurisdiction or country where such distribution or use would be contrary to law or regulation or which would subject us to any registration requirement within such jurisdiction or country. Accordingly, those persons who choose to access the Services from other locations do so on their own initiative and are solely responsible for compliance with local laws, if and to the extent local laws are applicable.</p>
          </Section>

          <Section number="2" title="INTELLECTUAL PROPERTY RIGHTS">
            <p>We are the owner or the licensee of all intellectual property rights in our Services, including all source code, databases, functionality, software, website designs, audio, video, text, photographs, and graphics in the Services (collectively, the "Content"), as well as the trademarks, service marks, and logos contained therein (the "Marks").</p>
            <p>Our Content and Marks are protected by copyright and trademark laws and treaties around the world. Subject to your compliance with these Legal Terms, we grant you a non-exclusive, non-transferable, revocable license to access the Services and download or print a copy of any portion of the Content to which you have properly gained access, solely for your internal business purpose.</p>
            <p><strong>Submissions:</strong> By directly sending us any question, comment, suggestion, idea, feedback, or other information about the Services, you agree to assign to us all intellectual property rights in such Submission.</p>
            <p><strong>Contributions:</strong> The Services may invite you to chat, contribute to, or participate in blogs, message boards, online forums, and other functionality during which you may create, submit, post, display, transmit, publish, distribute, or broadcast content and materials to us or through the Services.</p>
          </Section>

          <Section number="3" title="USER REPRESENTATIONS">
            <p>By using the Services, you represent and warrant that:</p>
            <BulletList items={[
              'All registration information you submit will be true, accurate, current, and complete.',
              'You will maintain the accuracy of such information and promptly update it as necessary.',
              'You have the legal capacity and you agree to comply with these Legal Terms.',
              'You are not under the age of 13.',
              'You are not a minor in the jurisdiction in which you reside, or if a minor, you have received parental permission to use the Services.',
              'You will not access the Services through automated or non-human means, whether through a bot, script, or otherwise.',
              'You will not use the Services for any illegal or unauthorized purpose.',
              'Your use of the Services will not violate any applicable law or regulation.',
            ]} />
          </Section>

          <Section number="4" title="USER REGISTRATION">
            <p>You may be required to register to use the Services. You agree to keep your password confidential and will be responsible for all use of your account and password. We reserve the right to remove, reclaim, or change a username you select if we determine, in our sole discretion, that such username is inappropriate, obscene, or otherwise objectionable.</p>
          </Section>

          <Section number="5" title="PURCHASES AND PAYMENT">
            <p>We accept the following forms of payment: Cheque, UPI, BharatPe.</p>
            <p>You agree to provide current, complete, and accurate purchase and account information for all purchases made via the Services. All payments shall be in INR/RUPEES. We may change prices at any time.</p>
          </Section>

          <Section number="6" title="SUBSCRIPTIONS">
            <p>Your subscription will continue and automatically renew unless canceled. You consent to our charging your payment method on a recurring basis without requiring your prior approval for each recurring charge, until such time as you cancel the applicable order.</p>
            <p><strong>Cancellation:</strong> All purchases are non-refundable. You can cancel your subscription at any time by contacting us. Your cancellation will take effect at the end of the current paid term. If you have any questions or are unsatisfied with our Services, please email us at <a href="mailto:nextsolves@gmail.com" style={{ color: '#4f46e5' }}>nextsolves@gmail.com</a>.</p>
          </Section>

          <Section number="7" title="PROHIBITED ACTIVITIES">
            <p>You may not access or use the Services for any purpose other than that for which we make the Services available. As a user of the Services, you agree not to:</p>
            <BulletList items={[
              'Systematically retrieve data or other content from the Services to create or compile a collection, compilation, database, or directory without written permission from us.',
              'Trick, defraud, or mislead us and other users, especially in any attempt to learn sensitive account information such as user passwords.',
              'Circumvent, disable, or otherwise interfere with security-related features of the Services.',
              'Disparage, tarnish, or otherwise harm, in our opinion, us and/or the Services.',
              'Use any information obtained from the Services in order to harass, abuse, or harm another person.',
              'Use the Services in a manner inconsistent with any applicable laws or regulations.',
              'Upload or transmit viruses, Trojan horses, or other malicious material.',
              'Engage in any automated use of the system, such as using scripts to send comments or messages.',
              'Attempt to impersonate another user or person.',
              'Interfere with, disrupt, or create an undue burden on the Services.',
              'Attempt to bypass any measures of the Services designed to prevent or restrict access.',
              '⛔ Try to make unauthorized changes in the software.',
              '⛔ Try to manipulate the data in the software.',
              '⛔ Try to hack the software.',
              '⛔ Try to breach the security of the software.',
            ]} />
          </Section>

          <Section number="8" title="USER GENERATED CONTRIBUTIONS">
            <p>The Services may invite you to chat, contribute to, or participate in blogs, message boards, online forums, and other functionality, and may provide you with the opportunity to create, submit, post, display, transmit, perform, publish, distribute, or broadcast content and materials to us or on the Services. When you create or make available any Contributions, you thereby represent and warrant that your Contributions are not false, inaccurate, or misleading; do not infringe any third party's intellectual property rights; do not violate the privacy or publicity rights of any third party; and do not violate any applicable law, regulation, or rule.</p>
          </Section>

          <Section number="9" title="CONTRIBUTION LICENSE">
            <p>By posting your Contributions to any part of the Services, you automatically grant to us an unrestricted, unlimited, irrevocable, perpetual, non-exclusive, transferable, royalty-free, fully-paid, worldwide right and license to host, use, copy, reproduce, disclose, sell, resell, publish, broadcast, retitle, archive, store, cache, publicly perform, publicly display, reformat, translate, transmit, excerpt, and distribute such Contributions for any purpose, commercial, advertising, or otherwise.</p>
            <p>We do not assert any ownership over your Contributions. You retain full ownership of all of your Contributions and any intellectual property rights or other proprietary rights associated with your Contributions.</p>
          </Section>

          <Section number="10" title="GUIDELINES FOR REVIEWS">
            <p>We may provide you areas on the Services to leave reviews or ratings. When posting a review, you must comply with the following criteria: (1) you should have firsthand experience with the person/entity being reviewed; (2) your reviews should not contain offensive or discriminatory language; (3) your reviews should not be affiliated with competitors; (4) your reviews should not make any conclusions as to the legality of conduct.</p>
          </Section>

          <Section number="11" title="SERVICES MANAGEMENT">
            <p>We reserve the right, but not the obligation, to: (1) monitor the Services for violations of these Legal Terms; (2) take appropriate legal action against anyone who, in our sole discretion, violates the law or these Legal Terms; (3) refuse, restrict access to, limit the availability of, or disable any of your Contributions; (4) remove from the Services or otherwise disable all files and content that are excessive in size or are in any way burdensome to our systems; and (5) otherwise manage the Services in a manner designed to protect our rights and property and to facilitate the proper functioning of the Services.</p>
          </Section>

          <Section number="12" title="PRIVACY POLICY">
            <p>We care about data privacy and security. Please review our <a href="/privacy-policy" target="_blank" rel="noopener noreferrer" style={{ color: '#4f46e5', fontWeight: '600' }}>Privacy Notice</a>. By using the Services, you agree to be bound by our Privacy Policy, which is incorporated into these Legal Terms. Please be advised the Services are hosted in India. If you access the Services from any other region of the world with laws or other requirements governing personal data collection, use, or disclosure that differ from applicable laws in India, then through your continued use of the Services, you are transferring your data to India, and you expressly consent to have your data transferred to and processed in India.</p>
          </Section>

          <Section number="13" title="COPYRIGHT INFRINGEMENTS">
            <p>We respect the intellectual property rights of others. If you believe that any material available on or through the Services infringes upon any copyright you own or control, please notify us immediately at <a href="mailto:nextsolves@gmail.com" style={{ color: '#4f46e5' }}>nextsolves@gmail.com</a>.</p>
          </Section>

          <Section number="14" title="TERM AND TERMINATION">
            <p>These Legal Terms shall remain in full force and effect while you use the Services. WITHOUT LIMITING ANY OTHER PROVISION OF THESE LEGAL TERMS, WE RESERVE THE RIGHT TO, IN OUR SOLE DISCRETION AND WITHOUT NOTICE OR LIABILITY, DENY ACCESS TO AND USE OF THE SERVICES (INCLUDING BLOCKING CERTAIN IP ADDRESSES), TO ANY PERSON FOR ANY REASON OR FOR NO REASON.</p>
            <p>If we terminate or suspend your account for any reason, you are prohibited from registering and creating a new account under your name, a fake or borrowed name, or the name of any third party, even if you may be acting on behalf of the third party.</p>
          </Section>

          <Section number="15" title="MODIFICATIONS AND INTERRUPTIONS">
            <p>We reserve the right to change, modify, or remove the contents of the Services at any time or for any reason at our sole discretion without notice. We also reserve the right to modify or discontinue all or part of the Services without notice at any time. We will not be liable to you or any third party for any modification, price change, suspension, or discontinuance of the Services.</p>
          </Section>

          <Section number="16" title="GOVERNING LAW">
            <p>These Legal Terms shall be governed by and defined following the laws of India. NextSolves and yourself irrevocably consent that the courts of India shall have exclusive jurisdiction to resolve any dispute which may arise in connection with these Legal Terms.</p>
          </Section>

          <Section number="17" title="DISPUTE RESOLUTION">
            <p>To expedite resolution and control the cost of any dispute, controversy, or claim related to these Legal Terms (each a "Dispute" and collectively, the "Disputes"), the Parties agree to first attempt to negotiate any Dispute informally for at least thirty (30) days before initiating arbitration. Such informal negotiations commence upon written notice from one Party to the other Party.</p>
          </Section>

          <Section number="18" title="CORRECTIONS">
            <p>There may be information on the Services that contains typographical errors, inaccuracies, or omissions, including descriptions, pricing, availability, and various other information. We reserve the right to correct any errors, inaccuracies, or omissions and to change or update the information on the Services at any time, without prior notice.</p>
          </Section>

          <Section number="19" title="DISCLAIMER">
            <p>THE SERVICES ARE PROVIDED ON AN AS-IS AND AS-AVAILABLE BASIS. YOU AGREE THAT YOUR USE OF THE SERVICES WILL BE AT YOUR SOLE RISK. TO THE FULLEST EXTENT PERMITTED BY LAW, WE DISCLAIM ALL WARRANTIES, EXPRESS OR IMPLIED, IN CONNECTION WITH THE SERVICES AND YOUR USE THEREOF, INCLUDING, WITHOUT LIMITATION, THE IMPLIED WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, AND NON-INFRINGEMENT.</p>
          </Section>

          <Section number="20" title="LIMITATIONS OF LIABILITY">
            <p>IN NO EVENT WILL WE OR OUR DIRECTORS, EMPLOYEES, OR AGENTS BE LIABLE TO YOU OR ANY THIRD PARTY FOR ANY DIRECT, INDIRECT, CONSEQUENTIAL, EXEMPLARY, INCIDENTAL, SPECIAL, OR PUNITIVE DAMAGES, INCLUDING LOST PROFIT, LOST REVENUE, LOSS OF DATA, OR OTHER DAMAGES ARISING FROM YOUR USE OF THE SERVICES, EVEN IF WE HAVE BEEN ADVISED OF THE POSSIBILITY OF SUCH DAMAGES.</p>
          </Section>

          <Section number="21" title="INDEMNIFICATION">
            <p>You agree to defend, indemnify, and hold us harmless, including our subsidiaries, affiliates, and all of our respective officers, agents, partners, and employees, from and against any loss, damage, liability, claim, or demand, including reasonable attorneys' fees and expenses, made by any third party due to or arising out of: (1) your Contributions; (2) use of the Services; (3) breach of these Legal Terms; (4) any breach of your representations and warranties set forth in these Legal Terms; or (5) your violation of the rights of a third party.</p>
          </Section>

          <Section number="22" title="USER DATA">
            <p>We will maintain certain data that you transmit to the Services for the purpose of managing the performance of the Services, as well as data relating to your use of the Services. Although we perform regular routine backups of data, you are solely responsible for all data that you transmit or that relates to any activity you have undertaken using the Services.</p>
          </Section>

          <Section number="23" title="ELECTRONIC COMMUNICATIONS, TRANSACTIONS, AND SIGNATURES">
            <p>Visiting the Services, sending us emails, and completing online forms constitute electronic communications. You consent to receive electronic communications, and you agree that all agreements, notices, disclosures, and other communications we provide to you electronically, via email and on the Services, satisfy any legal requirement that such communication be in writing.</p>
          </Section>

          <Section number="24" title="MISCELLANEOUS">
            <p>These Legal Terms and any policies or operating rules posted by us on the Services or in respect to the Services constitute the entire agreement and understanding between you and us. Our failure to exercise or enforce any right or provision of these Legal Terms shall not operate as a waiver of such right or provision.</p>
          </Section>

          <Section number="25" title="CONTACT US">
            <p>In order to resolve a complaint regarding the Services or to receive further information regarding use of the Services, please contact us at:</p>
            <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: '8px', padding: '16px 20px', marginTop: '12px' }}>
              <p style={{ margin: '0 0 6px', fontWeight: '600', color: '#1f2937' }}>NextSolves</p>
              <p style={{ margin: '0 0 4px', color: '#374151' }}>📧 <a href="mailto:nextsolves@gmail.com" style={{ color: '#4f46e5' }}>nextsolves@gmail.com</a></p>
              <p style={{ margin: '0 0 4px', color: '#374151' }}>📞 (+91) 9136234409 / 9321632938</p>
              <p style={{ margin: 0, color: '#374151' }}>📍 Goregaon East, Mumbai, Maharashtra – 400065, India</p>
            </div>
          </Section>

        </div>

        {/* Footer */}
        <div style={{ textAlign: 'center', marginTop: '32px' }}>
          <button
            onClick={() => navigate(-1)}
            style={{ background: 'linear-gradient(135deg, #4f46e5, #2563eb)', border: 'none', borderRadius: '10px', color: '#fff', padding: '12px 32px', fontSize: '14px', cursor: 'pointer', fontWeight: '600', boxShadow: '0 4px 14px rgba(79,70,229,0.35)' }}
          >
            ← Return to Consent Screen
          </button>
          <p style={{ marginTop: '12px', fontSize: '12px', color: '#9ca3af' }}>© 2026 NextSolves · Practical Workflow System</p>
        </div>
      </div>
    </div>
  );
};

export default TermsAndConditions;
