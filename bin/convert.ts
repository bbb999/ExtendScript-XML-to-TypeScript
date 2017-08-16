#!/usr/bin/env node
import * as program from "commander";
import { convert } from "../src/index";

let ok = false;

program
  .version(require("../package.json").version)
  .arguments('<xml_files...>')
  .action(async (...arg) => {
    ok = true;
    
    for(let file of arg[0]) {
      if(typeof file == "string") {
        await convert(file);
      }
    }
    
  })
  .parse(process.argv);

if(!ok) {
  program.help()
}
