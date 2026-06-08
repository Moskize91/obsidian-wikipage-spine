#!/usr/bin/env node
var __getOwnPropNames = Object.getOwnPropertyNames;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};

// src/core/project-info.ts
var PACKAGE_NAME;
var init_project_info = __esm({
  "src/core/project-info.ts"() {
    "use strict";
    PACKAGE_NAME = "wikipage-spine";
  }
});

// src/cli/main.ts
var require_main = __commonJS({
  "src/cli/main.ts"() {
    init_project_info();
    console.log(`${PACKAGE_NAME} CLI is not implemented yet.`);
  }
});
export default require_main();
//# sourceMappingURL=wikipage-spine.mjs.map