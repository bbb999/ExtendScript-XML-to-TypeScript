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
const fs_1 = require("fs");
const util_1 = require("util");
const jsdom_1 = require("jsdom");
const path_1 = require("path");
let readFile = util_1.promisify(fs_1.readFile);
let writeFile = util_1.promisify(fs_1.writeFile);
function convert(xmlFile) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.info("Converting \"" + path_1.basename(xmlFile) + "\"");
            xmlFile = fs_1.realpathSync(xmlFile);
            let file = yield readFile(xmlFile, "utf-8");
            let xml = new jsdom_1.JSDOM(file, { contentType: "text/xml" });
            let transformed = parse(xml);
            let result = generate(transformed);
            yield writeFile(xmlFile + ".d.ts", result);
            console.log("OK");
        }
        catch (e) {
            console.error("Error occurred during converting file: \"" + xmlFile + "\"");
            console.error(e.message + "\n");
        }
    });
}
exports.convert = convert;
function parse(xml) {
    let result = [];
    let definitions = xml.window.document.documentElement.querySelectorAll(":root > package > classdef");
    for (let definition of definitions) {
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
    let props = [];
    for (let element of definition.querySelectorAll(":root > elements")) {
        let isStatic = element.getAttribute("type") == "class";
        for (let property of Array.from(element.children)) {
            let p = parseProperty(property, isStatic);
            props.push(p);
        }
    }
    let extend = definition.querySelector(":root > superclass");
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
    if (prop.nodeName == "property") {
        type = "property";
    }
    else if (prop.nodeName == "method") {
        type = "method";
    }
    else {
        throw new Error("Unknown property " + prop.nodeName);
    }
    return {
        type,
        isStatic,
        readonly: prop.getAttribute("rwaccess") == "readonly",
        name: prop.getAttribute("name") || "",
        desc: parseDesc(prop),
        params: parseParameters(prop.querySelectorAll(":root > parameters > parameter")),
        types: parseType(prop.querySelector(":root > datatype")),
    };
}
function parseParameters(parameters) {
    let params = [];
    let previousWasOptional = false;
    for (let parameter of parameters) {
        let param = {
            name: parameter.getAttribute("name") || "",
            desc: parseDesc(parameter),
            optional: previousWasOptional || !!parameter.getAttribute("optional"),
            types: parseType(parameter.querySelector(":root > datatype")),
        };
        if (param.name.includes("...")) {
            param.name = "...rest";
            param.types[0].isArray = true;
        }
        param.desc = param.desc.map(d => d.replace(/\(Optional\)/i, ""));
        if (param.desc[0] && param.desc[0].includes("Can accept:")) {
            let canAccept = parseCanAccept(param.desc[0]);
            if (canAccept) {
                param.types = canAccept;
            }
        }
        params.push(param);
        previousWasOptional = previousWasOptional || param.optional;
    }
    return params;
}
function parseCanAccept(str) {
    let types = [];
    let words = str.replace(/^.*Can accept:/, "").replace(".", "");
    if (words.includes("containing")) {
        return;
    }
    for (let word of words.split(/,| or /)) {
        let type = {
            name: word.trim(),
            isArray: false,
        };
        type.name = type.name.replace(/enumerators?/, "").trim();
        if (type.name.match(/Arrays of Array of/)) {
            return;
        }
        else if (type.name == "Array of Reals") {
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
            if (type.name == "Swatche") {
                type.name = "Swatch";
            }
            type.isArray = true;
        }
        else if (type.name == "JavaScript Function") {
            type.name = "Function";
        }
        types.push(type);
    }
    return types;
}
function parseDesc(element) {
    let desc = [];
    let shortdesc = element.querySelector(":root > shortdesc");
    if (shortdesc && shortdesc.textContent) {
        desc.push(shortdesc.textContent);
    }
    let description = element.querySelector(":root > description");
    if (description && description.textContent) {
        desc.push(description.textContent);
    }
    desc = desc.join("\n").split("\n");
    desc = desc.map(d => d.replace(/  /g, "").trim()).filter(d => d != "");
    return desc;
}
function parseType(datatype) {
    let types = [];
    if (datatype) {
        let typeElement = datatype.querySelector(":root > type");
        let valueElement = datatype.querySelector(":root > value");
        let type = {
            name: typeElement ? typeElement.textContent || "" : "",
            isArray: !!datatype.querySelector(":root > array"),
            value: valueElement ? valueElement.textContent || "" : undefined,
        };
        if (type.name == "varies=any" || type.name == "Any") {
            type.name = "any";
        }
        else if (type.name == "Undefined") {
            type.name = "undefined";
        }
        else if (type.name == "bool") {
            type.name = "boolean";
        }
        else if (type.name == "Measurement Unit (Number or String)=any") {
            type.name = "number";
            types.push({ name: "string", isArray: true });
        }
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
    for (let definition of definitions) {
        let props = getListOfPropsToBeRemovedFor(definition, definitions);
        for (let prop of props) {
            definition.props = definition.props.filter(p => p.name != prop);
        }
    }
}
function getListOfPropsToBeRemovedFor(definition, definitions) {
    let props = [];
    if (definition.extend) {
        let parent = definitions.find(d => d.name == definition.extend);
        if (parent) {
            for (let prop of parent.props) {
                props.push(prop.name);
            }
            let p = getListOfPropsToBeRemovedFor(parent, definitions);
            props = props.concat(p);
        }
    }
    return props;
}
function generate(definitions) {
    let output = "";
    for (let definition of definitions) {
        output += "/**\n * " + definition.desc.join("\n * ") + "\n */\n";
        let name = "declare " + definition.type + " " + definition.name;
        let extend = definition.extend ? " extends " + definition.extend : "";
        output += name + extend + " {\n";
        for (let prop of definition.props) {
            output += "\t/**\n\t * " + prop.desc.join("\n\t * ") + "\n";
            if (prop.type == "method") {
                let params = [];
                for (let param of prop.params) {
                    let name = generateFixParamName(param.name);
                    output += "\t * @param " + param.name + " " + param.desc.join(" ") + "\n";
                    let p = name + (param.optional ? "?" : "") + ": " + generateType(param.types);
                    params.push(p);
                }
                output += "\t */\n";
                let type = generateType(prop.types);
                let staticKeyword = (prop.isStatic ? "static " : "");
                if (prop.name == "[]") {
                    output += "\t" + staticKeyword + "[" + params.join(", ") + "]: " + type + ";\n";
                }
                else if (prop.name == definition.name) {
                    output += "\tconstructor(" + params.join(", ") + ");\n";
                }
                else {
                    output += "\t" + staticKeyword + prop.name + "(" + params.join(", ") + "): " + type + ";\n";
                }
            }
            else if (definition.type == "class") {
                output += "\t */\n";
                let name = prop.name == "constructor" ? "'constructor'" : prop.name;
                let staticKeyword = (prop.isStatic ? "static " : "");
                let readonlyKeyword = (prop.readonly ? "readonly " : "");
                let type = generateType(prop.types);
                output += "\t" + staticKeyword + readonlyKeyword + name + ": " + type + ";\n";
            }
            else if (definition.type == "enum") {
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
    let output = [];
    for (let type of types) {
        output.push(type.name + (type.isArray ? "[]" : ""));
    }
    return output.join(" | ");
}
function generateFixParamName(name) {
    if (name == "for") {
        name = "for_";
    }
    else if (name == "with") {
        name = "with_";
    }
    else if (name == "in") {
        name = "in_";
    }
    else if (name == "default") {
        name = "default_";
    }
    else if (name == "return") {
        name = "return_";
    }
    return name;
}
//# sourceMappingURL=index.js.map