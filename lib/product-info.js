"use strict";

const fs = require("node:fs");
const path = require("node:path");

function productVersion(metadata = fs.readFileSync(path.join(__dirname, "..", "installer", "version.inc.iss"), "utf8")) {
  const match = metadata.match(/^#define[ \t]+AppVersion[ \t]+"((?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*))"[ \t]*\r?$/m);
  if (!match || match[1].split(".").some(part => Number(part) > 65534)) {
    throw new Error("AppVersion must be major.minor.patch with components between 0 and 65534.");
  }
  return match[1];
}

module.exports = { productVersion };
