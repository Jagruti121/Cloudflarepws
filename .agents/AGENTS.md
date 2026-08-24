# Authentication & Security Workflows

The following rules must be strictly adhered to for all authentication, OTP, and consent workflows in this project. Do not alter these workflows in future updates.

## OTP Routing Rules

1. **Admin Account Lockout**:
   - The *first* OTP (to unlock) must be sent to the **Super Admin** email ID (the one used to generate the college key).
   - The *second* OTP (for password reset) must be sent to the **Admin's own email ID** (the account that is locked).

2. **Teacher Account Lockout**:
   - The *first* OTP (to unlock) must be sent to the **Primary Admin**.
   - The *second* OTP (for password reset) must be sent to the **Teacher's own email ID** (the account that is locked).

3. **Super Admin Account Lockout**:
   - All OTPs must be sent directly to the **Super Admin's current email ID** only.

4. **Delete Account / Replace Admin (Admin Portal)**:
   - The *first* OTP (to authorize replacement) must be sent to the **Super Admin** email ID (the one used to generate the college key).
   - The *second* OTP (to verify the new admin) must be sent to the **New Admin's email ID** (the user being swapped in).

## Consent Workflows

5. **Mandatory First-Time Consent (Admin & Teacher)**:
   - If an Admin or Teacher logs in for the first time, they must be presented with the **Consent Option** screen.
   - Access to the main dashboard/account is strictly forbidden until the consent is approved.
   - If the user uses the browser's back button or reopens the screen without approving, they must still be intercepted and forced to approve the consent before accessing any inner pages.
