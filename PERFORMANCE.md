# Production CSS migration

The current static deployment uses the Tailwind browser CDN. Keep it until a compiled stylesheet has been verified in an isolated preview. Do not change the existing Cloudflare build settings or remove the CDN yet.

1. Inventory all HTML and JS templates, including dynamically toggled classes and arbitrary values.
2. Use a pinned Tailwind 3 CLI build in a separate preview branch; scan all HTML and JS templates, safelist any runtime-composed classes. Generate a minified local stylesheet.
3. Replace CDN scripts only in the preview. Preserve custom restaurant CSS variables, inline styles, hidden states and responsive classes.
4. Compare customer, kitchen, admin and super-admin screens at mobile and desktop widths, including checkout, modals, order status, custom palettes and offline states. Owner CSS and landing CSS are already standalone.
5. Measure cold and warm loads, CSS transfer size and first AR interaction on actual devices. Promote only after visual and functional acceptance; retain the previous branch for rollback.

No build output or browser measurements have been produced by this checklist.
