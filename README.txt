RNK FINWEALTH SERVICES WEBSITE

1. Open index.html in any browser to preview.
2. Client Login currently points to the existing RNK dashboard URL.
3. Before public launch, replace the placeholder phone/email if needed and verify all business/compliance details.
4. Upload index.html and approved-design.png together to a web host.

NSEINVEST UAT INTEGRATION

1. The private, unlinked test console is available at /nse-dashboard.html.
2. The server-side endpoint is /api/nseinvest. It requires a private Bearer token.
3. Copy the variable names from .env.example into Vercel Environment Variables.
4. Never place NSEInvest credentials in HTML, browser JavaScript, GitHub or any NEXT_PUBLIC variable.
5. Only data/report actions are enabled. Order placement, registration, cancellation,
   payment and document-upload actions remain disabled until authentication, audit logging,
   user authorization and NSE production approval are confirmed.
6. Run npm test and npm run check before deployment.
