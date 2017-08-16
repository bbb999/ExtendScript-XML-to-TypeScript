import { readFile as fsReadFileOriginal, realpathSync, writeFile as fsWriteFileOriginal } from "fs";
import { promisify } from "util";
import { parseString } from "xml2js";
import { basename } from "path";
let readFile = promisify(fsReadFileOriginal);
let writeFile = promisify(fsWriteFileOriginal);

export async function convert(xmlFile: string) {
  try {
    console.info("Converting \"" + basename(xmlFile) + "\"");
    
    xmlFile = realpathSync(xmlFile);
    
    let file = await readFile(xmlFile, "utf-8");
    
    let xml = await parseXml(file);
    
    let transformed = transform(xml);
    
    let result = generate(transformed);
    
    await writeFile(xmlFile + ".d.ts", result);
    
    console.log("OK");
  }
  catch (e) {
    console.error("Error occurred during converting file: \"" + xmlFile + "\"");
    console.error(e.message + "\n");
  }
}

interface Definition {
  type: "enum" | "class";
  name: string;
  desc: string[];
  extend: string | undefined;
  props: PropertyDefinition[];
  methods: MethodDefinition[];
}

interface PropertyDefinition {
  isStatic: boolean;
  readonly: boolean;
  name: string;
  desc: string[];
  types: TypeDefinition[];
}

interface MethodDefinition {
  isStatic: boolean;
  name: string;
  desc: string[];
  params: ParameterDefinition[];
  types: TypeDefinition[];
}

interface TypeDefinition {
  name: string;
  isArray: boolean;
  value?: string;
}

interface ParameterDefinition {
  name: string;
  desc: string[];
  optional: boolean;
  types: TypeDefinition[];
}

function parseXml(data: string) {
  return new Promise((resolve, reject) => {
    parseString(data, { explicitCharkey: true },(e, result) => {
      e ? reject(e) : resolve(result)
    })
  })
}

function transform(xml: any) {
  let result: Definition[] = [];
  
  for(let definition of xml.dictionary.package[0].classdef) {
    result.push(parseDefinition(definition));
  }
  return result
}

function parseDefinition(definition: any): Definition {
  let type: Definition["type"];

  if (definition.$.enumeration) {
    type = "enum";
  }
  else if (definition.$.dynamic) {
    type = "class"
  }
  else {
    throw new Error("Unknown definition")
  }

  let props: PropertyDefinition[] = [];
  let methods: MethodDefinition[] = [];

  if (definition.elements) {
    for (let element of definition.elements) {
      let isStatic = element.$.type == "class";

      if (element.property instanceof Array) {
        for (let property of element.property) {
          let p = parseProperty(property, isStatic);
          props.push(p);
        }
      }

      if (element.method instanceof Array) {
        for (let method of element.method) {
          let m = parseMethod(method, isStatic);
          methods.push(m);
        }
      }
    }
  }

  return {
    type,
    name: String(definition.$.name),
    desc: parseDesc(definition),
    extend: definition.superclass ? definition.superclass[0]._ : undefined,
    props,
    methods,
  }
}

function parseProperty(prop: any, isStatic: boolean): PropertyDefinition {
  return {
    isStatic: isStatic,
    readonly: prop.$.rwaccess == "readonly",
    name: String(prop.$.name),
    desc: parseDesc(prop),
    types: parseType(prop.datatype),
  }
}

function parseMethod(method: any, isStatic: boolean): MethodDefinition {
  return {
    isStatic: isStatic,
    name: String(method.$.name),
    desc: parseDesc(method),
    params: method.parameters ? parseParameters(method.parameters[0].parameter) : [],
    types: parseType(method.datatype),
  }
}

function parseParameters(parameters: any): ParameterDefinition[] {
  let params: ParameterDefinition[] = [];
  let previousWasOptional = false;
  
  for(let parameter of parameters) {
    let param: ParameterDefinition = {
      name: String(parameter.$.name),
      desc: parseDesc(parameter),
      optional: previousWasOptional || parameter.$.optional == "true",
      types: parseType(parameter.datatype),
    };
    if(param.name.includes("...")) {
      param.name = "...rest";
      param.types[0].isArray = true;
    }
    param.desc = param.desc.map(d => d.replace(/\(Optional\)/i, ""));
    if(param.desc[0] && param.desc[0].includes("Can accept:")) {
      let canAccept = parseCanAccept(param.desc[0]);
      if(canAccept) {
        param.types = canAccept
      }
    }
    
    params.push(param);
    
    previousWasOptional = previousWasOptional || param.optional;
  }
  
  return params;
}

function parseCanAccept(str: string): TypeDefinition[] | undefined {
  let types: TypeDefinition[] = [];
  let words = str.replace(/^.*Can accept:/, "").replace(".", "");
  if(words.includes("containing")) {
    return
  }
  
  for(let word of words.split(/,| or /)) {
    let type: TypeDefinition = {
      name: word.trim(),
      isArray: false,
    };

    type.name = type.name.replace(/enumerators?/, "").trim();
    
    if(type.name.match(/Arrays of Array of/)) {
      return;
    }
    else if(type.name == "Array of Reals") {
      type.name = "number";
      type.isArray = true;
    }
    else if(type.name.match(/Arrays? of 2 Reals/)) {
      type.name = "[number, number]"
    }
    else if(type.name.match(/Arrays? of 3 Reals/)) {
      type.name = "[number, number, number]"
    }
    else if(type.name.match(/Arrays? of 6 Reals/)) {
      type.name = "[number, number, number, number, number, number]"
    }
    else if(type.name.match(/Arrays? of 2 Units/)) {
      type.name = "[number | string, number | string]"
    }
    else if(type.name.match(/Arrays? of 2 Strings/)) {
      type.name = "[string, string]"
    }
    else if(type.name.match(/(Short|Long) Integers?/)) {
      type.name = "number"
    }
    else if(type.name.startsWith("Array of ")) {
      type.name = type.name.replace(/^Array of (\S+?)s?$/, "$1").trim();
      if(type.name == "Swatche") { type.name = "Swatch" }
      type.isArray = true;
    }
    else if(type.name == "JavaScript Function") {
      type.name = "Function"
    }
    
    types.push(type);
}
  return types;
}

function parseDesc(node: any) {
  let desc: string[] = [];
  if(node.shortdesc && node.shortdesc[0]._) {
    desc.push(String(node.shortdesc[0]._).trim());
  }
  if(node.description && node.description[0]._) {
    desc.push(String(node.description[0]._).trim());
  }
  
  return desc
}

function parseType(datatype: any): TypeDefinition[] {
  let types: TypeDefinition[] = [];
  
  if(datatype instanceof Array) {
    let type = {
      name: datatype[0].type[0]._,
      isArray: !!datatype[0].array,
      value: datatype[0].value ? String(datatype[0].value[0]._) : undefined,
    };
    
    if(type.name == "varies=any" || type.name == "Any") {
      type.name = "any";
    }
    else if(type.name == "Undefined") {
      type.name = "undefined"
    }
    else if(type.name == "bool") {
      type.name = "boolean";
    }
    else if(type.name == "Measurement Unit (Number or String)=any") {
      type.name = "number";
      types.push({ name: "string", isArray: true })
    }
    
    types.push(type)
  }
  else {
    types.push({
      name: "void",
      isArray: false,
    })
  }
  
  return types;
}

function generate(definitions: Definition[]) {
  let output = "";

  for(let definition of definitions) {
    output += "/**\n* " + definition.desc.join("\n * ") + "\n*/\n";
    output += "declare " + definition.type + " " + definition.name + " {\n";
    
    for(let prop of definition.props) {
      output += "\t/**\n\t * " + prop.desc.join("\n\t * ") + "\n\t */\n";
      
      if(definition.type == "class") {
        let name = prop.name == "constructor" ? "'constructor'" : prop.name;
        let staticKeyword = (prop.isStatic ? "static " : "");
        let readonlyKeyword = (prop.readonly ? "readonly " : "");
        let type = generateType(prop.types);
        
        output += "\t" + staticKeyword + readonlyKeyword + name + ": " + type + ";\n";
      }
      else if(definition.type == "enum") {
        output += "\t" + prop.name + " = " + prop.types[0].value + ",\n";
      }
      
      output += "\n";
    }
    
    for(let method of definition.methods) {
      output += "\t/**\n\t * " + method.desc.join("\n\t * ") + "\n";
      
      let staticKeyword = (method.isStatic ? "static " : "");
      let type = generateType(method.types);
      let params: string[] = [];
      for(let param of method.params) {
        let name = fixParamName(param.name);
        
        output += "\t * @param " + param.name + " " + param.desc.join(" ") + "\n";
        let p = name + (param.optional ? "?" : "") + ": " + generateType(param.types);
        params.push(p);
      }

      output += "\t */\n";

      if(method.name == "[]") {
        output += "\t" + staticKeyword + "[" + params.join(", ") + "]: " + type + ";\n";
      }
      else if(method.name == definition.name) {
        output += "\t" + staticKeyword + "constructor(" + params.join(", ") + ");\n";
      }
      else {
        output += "\t" + staticKeyword + method.name + "(" + params.join(", ") + "): " + type + ";\n";
      }
      output += "\n";
    }

    output += "}\n\n"
  }
  return output;
}

function generateType(types: TypeDefinition[]) {
  let output: string[] = [];
  
  for(let type of types) {
    output.push(type.name + (type.isArray ? "[]" : ""));
  }
  
  return output.join(" | ");
}

function fixParamName(name: string) {
  if(name == "for") {
    name = "for_";
  }
  else if(name == "with") {
    name = "with_";
  }
  else if(name == "in") {
    name = "in_";
  }
  else if(name == "default") {
    name = "default_";
  }
  return name;
}
