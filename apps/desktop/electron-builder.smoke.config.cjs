const base = require("./package.json").build;

module.exports = {
  ...base,
  directories: {
    ...base.directories,
    output: "release-smoke"
  },
  win: {
    ...base.win,
    target: ["dir"],
    forceCodeSigning: false
  },
  mac: {
    ...base.mac,
    target: ["dir"],
    forceCodeSigning: false,
    notarize: false
  },
  linux: {
    ...base.linux,
    target: ["dir"]
  }
};
