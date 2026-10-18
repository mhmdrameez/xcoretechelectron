// electron-builder afterPack hook.
//
// Without an Apple Developer ID the macOS build is left unsigned, and Apple
// Silicon Macs refuse to run unsigned code at all. An ad-hoc signature
// ("codesign --sign -") is enough for the app to start; users still see the
// "unidentified developer" prompt the first time (right-click > Open).
// When a real certificate is configured (CSC_LINK / CSC_NAME), electron-builder
// signs the app itself and this step is skipped.

const { execFileSync } = require("child_process");
const path = require("path");

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") return;
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;
  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync("codesign", ["--force", "--deep", "--sign", "-", appPath], { stdio: "inherit" });
};
