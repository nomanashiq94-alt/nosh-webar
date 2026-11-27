# Nosh WebAR — Launch checklist

## New restaurant onboarding
1. Create restaurant in Super Admin with a unique stable slug.
2. Configure branding, logo, table count, tax, service charge and payment options.
3. Publish menu items, prices, sizes, photos and optional calibrated GLB/USDZ assets.
4. Create individual kitchen and optional owner accounts. Share credentials securely; never share Super Admin access.
5. Configure subscription, record payment and agree expiry and grace period. Use monitor mode until enforcement is agreed.
6. Copy the single restaurant menu link. Generate one QR image for all tables and scan it before printing. Customers select their table at checkout. Keep PIN disabled until live security acceptance.
7. Test menu, ordering, kitchen alerts, statuses, owner analytics, mobile AR and cross-restaurant isolation.
8. Confirm client acceptance and hand over QR stands, kitchen and owner links, support contacts and billing terms.

## Custom domain
Use a domain owned by the business. Add it to the correct Cloudflare Pages project through Custom domains. Follow Cloudflare DNS instructions, verify HTTPS and redirects, and update Edge Function allowed origins and relevant Auth settings before cutover. Keep the current pages.dev deployment working until tests pass. Generate permanent QR codes only after the final domain is verified. The root landing page is not yet implemented; preserve restaurant query links and do not redirect them to marketing content.

## Commercial launch gates
- Actual encrypted database and media backups and isolated restore drill.
- Combined live security, payment, upload, checkout, kitchen and owner tests.
- Mobile AR scale and loading verification on supported Android and iPhone.
- Confirm production deployment and final domain, HTTPS, CORS and Auth configuration.
- Approve PIN activation separately after tests; keep existing staging lock until then.
- Agree subscription pricing, cancellation, maintenance, data retention and client support terms.

No domain purchase, paid plan activation or live PIN activation is authorized by this checklist.
