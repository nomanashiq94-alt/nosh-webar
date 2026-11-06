# Nosh WebAR — GitHub Pages testing

1. Create a GitHub repository, upload **contents of this folder** to repository root.
2. Settings → Pages → Deploy from a branch → main → /(root).
3. Open the HTTPS GitHub Pages link on Android Chrome and iPhone Safari.
4. To publish changes: in Admin, edit dishes and click **Export GitHub ZIP (with media)**, extract it, replace files in the repository and commit. This updates the published menu after deployment.
5. **Export menu.json** alone does NOT include locally uploaded image/GLB/USDZ files.

**Important:** GitHub Pages is public static hosting. Admin edits and kitchen orders are local-browser demos, NOT shared across devices. Do not use with real customer orders. Admin is not secure. Browser localStorage can override menu.json in the browser where you edited the demo; use a fresh/private browser to verify published menu.

**AR:** GLB and USDZ must represent the same food and be correctly scaled in metres. Width calibration in viewer is not a guarantee of real-world scale on both AR platforms. Test against a ruler.
