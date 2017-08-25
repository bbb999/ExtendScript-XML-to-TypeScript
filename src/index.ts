import { readFile as fsReadFileOriginal, realpathSync, writeFile as fsWriteFileOriginal } from "fs";
import { promisify } from "util";
import { JSDOM } from "jsdom";
import { basename } from "path";
let readFile = promisify(fsReadFileOriginal);
let writeFile = promisify(fsWriteFileOriginal);

export async function convert(xmlFile: string) {
  try {
    console.info("Converting \"" + basename(xmlFile) + "\"");
    
    xmlFile = realpathSync(xmlFile);
    
    let file = await readFile(xmlFile, "utf-8");
    
    let xml = new JSDOM(file, { contentType: "text/xml" });
    
    let transformed = parse(xml);
    
    let sorted = sort(transformed);
    
    let result = generate(sorted);
    
    await writeFile(xmlFile.replace(/\.xml$/, "") + ".d.ts", result);
    
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
}

interface PropertyDefinition {
  type: "method" | "property";
  isStatic: boolean;
  readonly: boolean;
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

function directFindAll(element: Element, selector: string[]) {
  let result: Element[] = [];
  let currentSelector = selector.shift();
  
  if(currentSelector) {
    for(let child of Array.from(element.children)) {
      if(child.nodeName == currentSelector) {
        result = result.concat(directFindAll(child, selector.slice()));
      }
    }
  }
  else {
    result.push(element);
  }
  
  return result;
}

function directFind(element: Element, selector: string[]): Element | undefined {
  let currentSelector = selector.shift();
  
  if(currentSelector) {
    for(let child of Array.from(element.children)) {
      if(child.nodeName == currentSelector) {
        let found = directFind(child, selector.slice());
        if(found) {
          return found;
        }
      }
    }
  }
  else {
    return element
  }
}

function parse(xml: JSDOM) {
  let result: Definition[] = [];
  
  let definitions = directFindAll(xml.window.document.documentElement, ["package", "classdef"]);
  
  for(let definition of definitions) {
    result.push(parseDefinition(definition));
  }
  
  removeInheritedProperties(result);
  
  return result
}

function parseDefinition(definition: Element): Definition {
  let type: Definition["type"];
  
  if (definition.getAttribute("enumeration")) {
    type = "enum";
  }
  else if (definition.getAttribute("dynamic")) {
    type = "class"
  }
  else {
    throw new Error("Unknown definition")
  }
  
  let props: PropertyDefinition[] = [];
  
  for (let element of directFindAll(definition,["elements"])) {
    let isStatic = element.getAttribute("type") == "class";
    
    for (let property of Array.from(element.children)) {
      let p = parseProperty(property, isStatic);
      props.push(p);
    }
  }
  
  let extend = directFind(definition, ["superclass"]);
  return {
    type,
    name: definition.getAttribute("name") || "",
    desc: parseDesc(definition),
    extend: extend ? extend.innerHTML || undefined : undefined,
    props,
  }
}

function parseProperty(prop: Element, isStatic: boolean): PropertyDefinition {
  let type: PropertyDefinition["type"];
  if(prop.nodeName == "property") { type = "property"; }
  else if(prop.nodeName == "method") { type = "method"; }
  else { throw new Error("Unknown property " + prop.nodeName); }
  
  return {
    type,
    isStatic,
    readonly: prop.getAttribute("rwaccess") == "readonly",
    name: prop.getAttribute("name") || "",
    desc: parseDesc(prop),
    params: parseParameters(directFindAll(prop, ["parameters", "parameter"])),
    types: parseType(directFind(prop, ["datatype"])),
  }
}

function parseParameters(parameters: Element[]): ParameterDefinition[] {
  let params: ParameterDefinition[] = [];
  let previousWasOptional = false;
  
  for(let parameter of parameters) {
    let param: ParameterDefinition = {
      name: parameter.getAttribute("name") || "",
      desc: parseDesc(parameter),
      optional: previousWasOptional || !!parameter.getAttribute("optional"),
      types: parseType(directFind(parameter, ["datatype"])),
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

function parseDesc(element: Element) {
  let desc: string[] = [];
  
  let shortdesc = directFind(element, ["shortdesc"]);
  if(shortdesc && shortdesc.textContent) {
    desc.push(shortdesc.textContent);
  }
  
  let description = directFind(element, ["description"]);
  if(description && description.textContent) {
    desc.push(description.textContent);
  }
  
  desc = desc.join("\n").split("\n");
  desc = desc.map(d => d.replace(/ {2}/g, "").trim()).filter(d => d != "");
  
  return desc;
}

function parseType(datatype: Element | undefined): TypeDefinition[] {
  let types: TypeDefinition[] = [];
  
  if(datatype) {
    let typeElement = directFind(datatype, ["type"]);
    let valueElement = directFind(datatype, ["value"]);
    
    let type: TypeDefinition = {
      name: typeElement ? typeElement.textContent || "" : "",
      isArray: !!directFind(datatype, ["array"]),
      value: valueElement ? valueElement.textContent || "" : undefined,
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

function removeInheritedProperties(definitions: Definition[]) {
  for(let definition of definitions) {
    let props = getListOfPropsToBeRemovedFor(definition, definitions);
    for(let prop of props) {
      definition.props = definition.props.filter(p => p.name != prop);
    }
  }
}

function getListOfPropsToBeRemovedFor(definition: Definition, definitions: Definition[]) {
  let props: string[] = [];
  
  if(definition.extend) {
    let parent = definitions.find(d => d.name == definition.extend);
    if(parent) {
      for(let prop of parent.props) {
        props.push(prop.name);
      }
      let p = getListOfPropsToBeRemovedFor(parent, definitions);
      props = props.concat(p);
    }
  }

  return props
}

function sort(definitions: Definition[]) {
  for(let definition of definitions) {
    definition.props.sort((a, b) => {
      if(a.type != b.type) {
        if (a.type < b.type) {
          return 1;
        }
        else if (a.type > b.type) {
          return -1;
        }
        else {
          return 0;
        }
      }
      else {
        if (a.name < b.name) {
          return -1;
        }
        else if (a.name > b.name) {
          return 1;
        }
        else {
          return 0;
        }
      }
    })
  }
  return definitions
}

function generate(definitions: Definition[]) {
  let output = "";
  
  for(let definition of definitions) {
    output += "/**\n * " + definition.desc.join("\n * ") + "\n */\n";
    let name = "declare " + definition.type + " " + definition.name;
    let extend = definition.extend ? " extends " + definition.extend : "";
    output += name + extend + " {\n";
    
    for(let prop of definition.props) {
      output += "\t/**\n\t * " + prop.desc.join("\n\t * ") + "\n";
      
      if(prop.type == "method") {
        let params: string[] = [];
        for(let param of prop.params) {
          let name = generateFixParamName(param.name);
          output += "\t * @param " + param.name + " " + param.desc.join(" ") + "\n";
          let p = name + (param.optional ? "?" : "") + ": " + generateType(param.types);
          params.push(p);
        }
        output += "\t */\n";
        
        let type = generateType(prop.types);
        let staticKeyword = (prop.isStatic ? "static " : "");
        if(prop.name == "[]") {
          output += "\t" + staticKeyword + "[" + params.join(", ") + "]: " + type + ";\n";
        }
        else if(prop.name == definition.name) {
          output += "\tconstructor(" + params.join(", ") + ");\n";
        }
        else {
          output += "\t" + staticKeyword + prop.name + "(" + params.join(", ") + "): " + type + ";\n";
        }
      }
      else if(definition.type == "class") {
        output += "\t */\n";
        
        let name = prop.name == "constructor" ? "'constructor'" : prop.name;
        let staticKeyword = (prop.isStatic ? "static " : "");
        let readonlyKeyword = (prop.readonly ? "readonly " : "");
        let type = generateType(prop.types);

        output += "\t" + staticKeyword + readonlyKeyword + name + ": " + type + ";\n";
      }
      else if(definition.type == "enum") {
        output += "\t */\n";
        
        output += "\t" + prop.name + " = " + prop.types[0].value + ",\n";
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

function generateFixParamName(name: string) {
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
  else if(name == "return") {
    name = "return_";
  }
  return name;
}
