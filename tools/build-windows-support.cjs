"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");
const { spawnSync } = require("node:child_process");
const { productVersion } = require("../lib/product-info.js");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist", "windows");
const winSWVersion = "2.12.0";
// Pinned official release: https://github.com/winsw/winsw/releases/tag/v2.12.0
const winSWHash = "b5066b7bbdfba1293e5d15cda3caaea88fbeab35bd5b38c41c913d492aadfc4f";

async function download(url) {
    const response = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`Download failed (${response.status}): ${url}`);
    return Buffer.from(await response.arrayBuffer());
}

function productInfoSource(metadata = fs.readFileSync(path.join(root, "installer", "version.inc.iss"), "utf8")) {
    const version = productVersion(metadata);
    return `// Generated from installer/version.inc.iss.\n` +
        `[assembly: System.Reflection.AssemblyVersion("${version}.0")]\n` +
        `[assembly: System.Reflection.AssemblyFileVersion("${version}.0")]\n` +
        `namespace EarsMixer { internal static class ProductInfo { internal const string Version = "${version}"; } }\n`;
}

async function buildWindowsSupport() {
    if (process.platform !== "win32") throw new Error("Build the Windows service and tray on Windows.");
    fs.mkdirSync(output, { recursive: true });
    const wrapper = path.join(output, "EarsMixerService.exe");
    const binary = fs.existsSync(wrapper) ? fs.readFileSync(wrapper) : await download(
        `https://github.com/winsw/winsw/releases/download/v${winSWVersion}/WinSW.NET461.exe`);
    if (createHash("sha256").update(binary).digest("hex") !== winSWHash)
        throw new Error("WinSW checksum mismatch. Remove dist/windows/EarsMixerService.exe and rebuild.");
    fs.writeFileSync(wrapper, binary);
    const license = path.join(output, "WinSW-LICENSE.txt");
    if (!fs.existsSync(license)) fs.writeFileSync(license, await download(
        `https://raw.githubusercontent.com/winsw/winsw/v${winSWVersion}/LICENSE.txt`));
    fs.copyFileSync(path.join(root, "installer", "EarsMixerService.xml"), path.join(output, "EarsMixerService.xml"));
    const compiler = process.env.CSC_PATH || path.join(process.env.WINDIR || "C:\\Windows",
        "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
    if (!fs.existsSync(compiler)) throw new Error("The .NET Framework C# compiler is missing. Set CSC_PATH to csc.exe.");
    const productInfo = path.join(output, "ProductInfo.g.cs");
    fs.writeFileSync(productInfo, productInfoSource());
    const result = spawnSync(compiler, ["/nologo", "/target:winexe", "/platform:anycpu", "/optimize+",
        "/reference:System.Windows.Forms.dll", "/reference:System.Drawing.dll",
        "/reference:System.ServiceProcess.dll", "/reference:System.Web.Extensions.dll",
        `/win32icon:${path.join(root, "web", "images", "favicon.ico")}`,
        `/out:${path.join(output, "EarsMixerTray.exe")}`, path.join(root, "installer", "EarsMixerTray.cs"),
        path.join(root, "installer", "EarsMixerUpdates.cs"), productInfo],
    { cwd: root, stdio: "inherit" });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Tray compilation failed (exit ${result.status}).`);
}

module.exports = { buildWindowsSupport, productInfoSource };
if (require.main === module) buildWindowsSupport().catch(error => { console.error(error.message); process.exitCode = 1; });
