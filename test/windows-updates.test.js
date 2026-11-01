"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { productInfoSource } = require("../tools/build-windows-support.cjs");
const { productVersion } = require("../lib/product-info.js");

test("Windows tray version comes from installer metadata, independently of the Node package", () => {
  const metadata = fs.readFileSync(path.join(__dirname, "../installer/version.inc.iss"), "utf8");
  const version = metadata.match(/^#define AppVersion "([\d.]+)"/m)[1];
  assert.equal(productVersion(), version);
  assert(require("../package.json").pkg.assets.includes("installer/version.inc.iss"), "packaged apps must include their version metadata");
  const source = productInfoSource();
  assert(source.includes(`const string Version = "${version}"`));
  assert(source.includes(`AssemblyVersion("${version}.0")`));
  assert(source.includes(`AssemblyFileVersion("${version}.0")`));
  assert(productInfoSource('#define AppVersion "1.10.2"\r\n').includes('Version = "1.10.2"'));
  for (const invalid of ["", "1.0", "1.0.0.1", "01.0.0", "1.0.0-beta", "65535.0.0", '1.0.0"; code']) {
    assert.throws(() => productInfoSource(`#define AppVersion "${invalid}"`), /AppVersion/);
  }
});

test("Windows release checker compares versions and only offers published installers from this repository", {
  skip: process.platform !== "win32",
  timeout: 30000,
}, t => {
  const compiler = process.env.CSC_PATH || path.join(process.env.WINDIR || "C:\\Windows",
    "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe");
  assert(fs.existsSync(compiler), "The Windows update tests require the .NET Framework C# compiler.");
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "earsmixer-updates-test-"));
  t.after(() => {
    assert.equal(path.dirname(directory), path.resolve(os.tmpdir()));
    assert(path.basename(directory).startsWith("earsmixer-updates-test-"));
    fs.rmSync(directory, { recursive: true, force: true });
  });
  const productInfo = path.join(directory, "ProductInfo.g.cs");
  const executable = path.join(directory, "UpdateTests.exe");
  fs.writeFileSync(productInfo, productInfoSource());
  execFileSync(compiler, ["/nologo", "/target:exe", "/reference:System.Web.Extensions.dll", `/out:${executable}`,
    path.join(__dirname, "../installer/EarsMixerUpdates.cs"),
    path.join(__dirname, "fixtures/windows-updates.cs"), productInfo], { windowsHide: true, timeout: 15000 });
  const output = execFileSync(executable, [], { windowsHide: true, encoding: "utf8", timeout: 10000 });
  assert.match(output, /Windows update checks passed/);
});
