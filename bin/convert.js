#!/usr/bin/env node
"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : new P(function (resolve) { resolve(result.value); }).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const program = require("commander");
const index_1 = require("../src/index");
let ok = false;
program
    .version(require("../package.json").version)
    .arguments('<xml_files...>')
    .action((arg, command) => __awaiter(this, void 0, void 0, function* () {
    ok = true;
    for (let file of arg) {
        if (typeof file == "string") {
            yield index_1.convert(file);
        }
    }
}))
    .parse(process.argv);
if (!ok) {
    program.help();
}
