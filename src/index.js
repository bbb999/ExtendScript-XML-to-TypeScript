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
const fs = require("fs");
const util_1 = require("util");
const jsdom_1 = require("jsdom");
const path_1 = require("path");
const readFile = util_1.promisify(fs.readFile);
const realpath = util_1.promisify(fs.realpath);
const writeFile = util_1.promisify(fs.writeFile);
function convert(xmlFilepath) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.info("Converting \"" + path_1.basename(xmlFilepath) + "\"");
            const xmlRealpath = yield realpath(xmlFilepath);
            const file = yield readFile(xmlRealpath, "utf-8");
            const xml = new jsdom_1.JSDOM(file, { contentType: "text/xml" });
            const transformed = parse(xml);
            const sorted = sort(transformed);
            const result = generate(sorted);
            yield writeFile(xmlRealpath.replace(/\.xml$/, "") + ".d.ts", result);
            console.log("OK");
        }
        catch (e) {
            console.error("Error occurred during converting file: \"" + xmlFilepath + "\"");
            console.error(e.message + "\n");
        }
    });
}
exports.convert = convert;
function directFindAll(element, selector) {
    let result = [];
    const currentSelector = selector.shift();
    if (currentSelector) {
        for (const child of Array.from(element.children)) {
            if (child.nodeName === currentSelector) {
                result = result.concat(directFindAll(child, selector.slice()));
            }
        }
    }
    else {
        result.push(element);
    }
    return result;
}
function directFind(element, selector) {
    const currentSelector = selector.shift();
    if (currentSelector) {
        for (const child of Array.from(element.children)) {
            if (child.nodeName === currentSelector) {
                const found = directFind(child, selector.slice());
                if (found) {
                    return found;
                }
            }
        }
    }
    else {
        return element;
    }
}
function parse(xml) {
    const result = [];
    const definitions = directFindAll(xml.window.document.documentElement, ["package", "classdef"]);
    for (const definition of definitions) {
        result.push(parseDefinition(definition));
    }
    removeInheritedProperties(result);
    return result;
}
function parseDefinition(definition) {
    let type;
    if (definition.getAttribute("enumeration")) {
        type = "enum";
    }
    else if (definition.getAttribute("dynamic")) {
        type = "class";
    }
    else {
        throw new Error("Unknown definition");
    }
    const props = [];
    for (const element of directFindAll(definition, ["elements"])) {
        const isStatic = element.getAttribute("type") === "class";
        for (const property of Array.from(element.children)) {
            const p = parseProperty(property, isStatic);
            props.push(p);
        }
    }
    const extend = directFind(definition, ["superclass"]);
    return {
        type,
        name: definition.getAttribute("name") || "",
        desc: parseDesc(definition),
        extend: extend ? extend.innerHTML || undefined : undefined,
        props,
    };
}
function parseProperty(prop, isStatic) {
    let type;
    if (prop.nodeName === "property") {
        type = "property";
    }
    else if (prop.nodeName === "method") {
        type = "method";
    }
    else {
        throw new Error("Unknown property " + prop.nodeName);
    }
    const p = {
        type,
        isStatic,
        readonly: prop.getAttribute("rwaccess") === "readonly",
        name: (prop.getAttribute("name") || "").replace(/^\./, "").replace(/[^\[\]0-9a-zA-Z_$]/g, "_"),
        desc: parseDesc(prop),
        params: parseParameters(directFindAll(prop, ["parameters", "parameter"])),
        types: parseType(directFind(prop, ["datatype"])),
    };
    parseCanReturnAndAccept(p);
    return p;
}
function parseDesc(element) {
    let desc = [];
    const shortdesc = directFind(element, ["shortdesc"]);
    if (shortdesc && shortdesc.textContent) {
        desc.push(shortdesc.textContent);
    }
    const description = directFind(element, ["description"]);
    if (description && description.textContent) {
        desc.push(description.textContent);
    }
    desc = desc.join("\n").split("\n");
    desc = desc.map(d => d.replace(/ {2}/g, "").trim()).filter(d => d !== "");
    return desc;
}
function parseParameters(parameters) {
    const params = [];
    let previousWasOptional = false;
    for (const parameter of parameters) {
        const param = {
            name: parameter.getAttribute("name") || "",
            desc: parseDesc(parameter),
            optional: previousWasOptional || !!parameter.getAttribute("optional"),
            types: parseType(directFind(parameter, ["datatype"])),
        };
        if (param.name.includes("...")) {
            param.name = "...rest";
            param.types[0].isArray = true;
        }
        param.desc = param.desc.map(d => d.replace(/\(Optional\)/i, ""));
        parseCanReturnAndAccept(param);
        params.push(param);
        previousWasOptional = previousWasOptional || param.optional;
    }
    return params;
}
function parseCanReturnAndAccept(obj) {
    const str = obj.desc[0];
    if (!str) {
        return;
    }
    const match = str.match(/^(.*?)(?:Can(?: also)? (?:accept|return):)(.*)$/);
    if (!match || match[2].includes("containing") || match[2].match(/Arrays? of Arrays? of/)) {
        return;
    }
    match[2] = match[2].replace("Can also accept:", " or ");
    const result = parseCanReturnAndAcceptValue(match[2]);
    if (result) {
        obj.desc[0] = match[1].trim();
        obj.types = obj.types.concat(result);
        obj.types = obj.types.filter((type) => type.name !== "any");
    }
}
function parseCanReturnAndAcceptValue(str) {
    let types = [];
    const words = str.split(/,| or/);
    for (const word of words) {
        const type = {
            name: word.trim(),
            isArray: false,
        };
        if (!type.name || type.name === ".") {
            continue;
        }
        parseTypeFixTypeName(type);
        types.push(type);
    }
    types = types.filter((type, index, self) => {
        const foundIndex = self.findIndex((t) => t.name === type.name && t.isArray === type.isArray);
        return foundIndex === index;
    });
    return types;
}
function parseTypeFixTypeName(type) {
    type.name = type.name.trim();
    type.name = type.name.replace(/enumerators?/, "");
    type.name = type.name.replace(/\.$/, "");
    type.name = type.name.trim();
    if (type.name === "varies=any" || type.name === "Any") {
        type.name = "any";
    }
    else if (type.name === "Undefined") {
        type.name = "undefined";
    }
    else if (type.name === "Object") {
        type.name = "object";
    }
    else if (type.name === "String") {
        type.name = "string";
    }
    else if (type.name === "Boolean" || type.name === "bool") {
        type.name = "boolean";
    }
    else if (type.name === "Number" || type.name === "int" || type.name === "Int32" || type.name === "uint") {
        type.name = "number";
    }
    else if (type.name.match(/^(Unit|Real)\s*(\([\d.]+ - [\d.]+( points)?\))?$/)) {
        type.name = "number";
    }
    else if (type.name === "Array of 4 Units (0 - 8640 points)") {
        type.name = "[number, number, number, number]";
        type.isArray = false;
    }
    else if (type.name === "Array of Reals") {
        type.name = "number";
        type.isArray = true;
    }
    else if (type.name.match(/Arrays? of 2 Reals/)) {
        type.name = "[number, number]";
    }
    else if (type.name.match(/Arrays? of 3 Reals/)) {
        type.name = "[number, number, number]";
    }
    else if (type.name.match(/Arrays? of 6 Reals/)) {
        type.name = "[number, number, number, number, number, number]";
    }
    else if (type.name.match(/Arrays? of 2 Units/)) {
        type.name = "[number | string, number | string]";
    }
    else if (type.name.match(/Arrays? of 2 Strings/)) {
        type.name = "[string, string]";
    }
    else if (type.name.match(/(Short|Long) Integers?/)) {
        type.name = "number";
    }
    else if (type.name.startsWith("Array of ")) {
        type.name = type.name.replace(/^Array of (\S+?)s?$/, "$1").trim();
        type.isArray = true;
        parseTypeFixTypeName(type);
    }
    else if (type.name === "Swatche") {
        type.name = "Swatch";
    }
    else if (type.name === "JavaScript Function") {
        type.name = "Function";
    }
}
function parseType(datatype) {
    const types = [];
    if (datatype) {
        const typeElement = directFind(datatype, ["type"]);
        const valueElement = directFind(datatype, ["value"]);
        const type = {
            name: typeElement ? typeElement.textContent || "" : "",
            isArray: !!directFind(datatype, ["array"]),
            value: valueElement ? valueElement.textContent || "" : undefined,
        };
        if (type.name === "Measurement Unit (Number or String)=any") {
            type.name = "number";
            types.push({ name: "string", isArray: type.isArray });
        }
        parseTypeFixTypeName(type);
        types.push(type);
    }
    else {
        types.push({
            name: "void",
            isArray: false,
        });
    }
    return types;
}
function removeInheritedProperties(definitions) {
    for (const definition of definitions) {
        const props = getListOfPropsToBeRemovedFor(definition, definitions);
        for (const prop of props) {
            definition.props = definition.props.filter(p => p.name !== prop);
        }
    }
}
function getListOfPropsToBeRemovedFor(definition, definitions) {
    let props = [];
    if (definition.extend) {
        const parent = definitions.find(d => d.name === definition.extend);
        if (parent) {
            for (const prop of parent.props) {
                props.push(prop.name);
            }
            const p = getListOfPropsToBeRemovedFor(parent, definitions);
            props = props.concat(p);
        }
    }
    return props;
}
function sort(definitions) {
    for (const definition of definitions) {
        definition.props.sort((a, b) => {
            if (a.type !== b.type) {
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
        });
    }
    return definitions;
}
function generate(definitions) {
    let output = "";
    for (const definition of definitions) {
        output += "/**\n * " + definition.desc.join("\n * ") + "\n */\n";
        const name = "declare " + definition.type + " " + definition.name;
        const extend = definition.extend ? " extends " + definition.extend : "";
        output += name + extend + " {\n";
        for (const prop of definition.props) {
            output += "\t/**\n\t * " + prop.desc.join("\n\t * ") + "\n";
            if (prop.type === "method") {
                const params = prop.params.map(param => {
                    const methodName = generateFixParamName(param.name);
                    const desc = param.desc.join(" ").trim();
                    if (desc) {
                        output += "\t * @param " + methodName + " " + desc + "\n";
                    }
                    return methodName + (param.optional ? "?" : "") + ": " + generateType(param.types);
                });
                output += "\t */\n";
                const type = generateType(prop.types);
                const staticKeyword = (prop.isStatic ? "static " : "");
                if (prop.name === "[]") {
                    output += "\t" + staticKeyword + "[" + params.join(", ") + "]: " + type + ";\n";
                }
                else if (prop.name === definition.name) {
                    output += "\tconstructor(" + params.join(", ") + ");\n";
                }
                else {
                    output += "\t" + staticKeyword + prop.name + "(" + params.join(", ") + "): " + type + ";\n";
                }
            }
            else if (definition.type === "class") {
                output += "\t */\n";
                const className = prop.name === "constructor" ? "'constructor'" : prop.name;
                const staticKeyword = (prop.isStatic ? "static " : "");
                const readonlyKeyword = (prop.readonly ? "readonly " : "");
                const type = generateType(prop.types);
                output += "\t" + staticKeyword + readonlyKeyword + className + ": " + type + ";\n";
            }
            else if (definition.type === "enum") {
                output += "\t */\n";
                output += "\t" + prop.name + " = " + prop.types[0].value + ",\n";
            }
            output += "\n";
        }
        output += "}\n\n";
    }
    return output;
}
function generateType(types) {
    const output = [];
    for (const type of types) {
        output.push(type.name + (type.isArray ? "[]" : ""));
    }
    return output.join(" | ");
}
function generateFixParamName(name) {
    if (name === "for") {
        return "for_";
    }
    else if (name === "with") {
        return "with_";
    }
    else if (name === "in") {
        return "in_";
    }
    else if (name === "default") {
        return "default_";
    }
    else if (name === "return") {
        return "return_";
    }
    else if (name === "export") {
        return "export_";
    }
    else if (name === "function") {
        return "function_";
    }
    return name;
}
