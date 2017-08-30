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
            let sorted = sort(transformed);
            let result = generate(sorted);
            yield writeFile(xmlFile.replace(/\.xml$/, "") + ".d.ts", result);
            console.log("OK");
        }
        catch (e) {
            console.error("Error occurred during converting file: \"" + xmlFile + "\"");
            console.error(e.message + "\n");
        }
    });
}
exports.convert = convert;
function directFindAll(element, selector) {
    let result = [];
    let currentSelector = selector.shift();
    if (currentSelector) {
        for (let child of Array.from(element.children)) {
            if (child.nodeName == currentSelector) {
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
    let currentSelector = selector.shift();
    if (currentSelector) {
        for (let child of Array.from(element.children)) {
            if (child.nodeName == currentSelector) {
                let found = directFind(child, selector.slice());
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
    let result = [];
    let definitions = directFindAll(xml.window.document.documentElement, ["package", "classdef"]);
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
    for (let element of directFindAll(definition, ["elements"])) {
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
    let p = {
        type,
        isStatic,
        readonly: prop.getAttribute("rwaccess") == "readonly",
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
    let shortdesc = directFind(element, ["shortdesc"]);
    if (shortdesc && shortdesc.textContent) {
        desc.push(shortdesc.textContent);
    }
    let description = directFind(element, ["description"]);
    if (description && description.textContent) {
        desc.push(description.textContent);
    }
    desc = desc.join("\n").split("\n");
    desc = desc.map(d => d.replace(/ {2}/g, "").trim()).filter(d => d != "");
    return desc;
}
function parseParameters(parameters) {
    let params = [];
    let previousWasOptional = false;
    for (let parameter of parameters) {
        let param = {
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
    let str = obj.desc[0];
    if (!str) {
        return;
    }
    let regex = /^(.*?)(?:Can(?: also)? (?:accept|return):)(.*)$/;
    let match = regex.exec(str);
    if (!match || match[2].includes("containing")) {
        return;
    }
    let ok = false;
    let canReturn = str.match(/^.*?(?:Can return:)([^.]*).*$/);
    let canAccept = str.match(/^.*?(?:Can accept:)([^.]*).*$/);
    let canAlsoAccept = str.match(/^.*?(?:Can also accept:)([^.]*).*$/);
    if (canReturn) {
        let result = parseCanReturnAndAcceptValue(canReturn[1]);
        if (result) {
            obj.types = obj.types.concat(result);
            ok = true;
        }
    }
    if (canAccept) {
        let result = parseCanReturnAndAcceptValue(canAccept[1]);
        if (result) {
            obj.types = obj.types.concat(result);
            ok = true;
        }
    }
    if (canAlsoAccept) {
        let result = parseCanReturnAndAcceptValue(canAlsoAccept[1]);
        if (result) {
            obj.types = obj.types.concat(result);
            ok = true;
        }
    }
    if (ok) {
        obj.desc[0] = match[1].trim();
        obj.types = obj.types.filter((type) => type.name != "any");
    }
}
function parseCanReturnAndAcceptValue(str) {
    let types = [];
    let words = str.split(/,| or |\./);
    for (let word of words) {
        let type = {
            name: word.trim(),
            isArray: false,
        };
        if (!type.name) {
            continue;
        }
        else if (type.name.match(/Arrays of Array of/)) {
            return;
        }
        parseTypeFixTypeName(type);
        types.push(type);
    }
    return types;
}
function parseTypeFixTypeName(type) {
    type.name = type.name.replace(/enumerators?/, "").trim();
    if (type.name == "varies=any" || type.name == "Any") {
        type.name = "any";
    }
    else if (type.name == "Undefined") {
        type.name = "undefined";
    }
    else if (type.name == "bool") {
        type.name = "boolean";
    }
    else if (type.name == "int" || type.name == "Int32" || type.name == "uint") {
        type.name = "number";
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
}
function parseType(datatype) {
    let types = [];
    if (datatype) {
        let typeElement = directFind(datatype, ["type"]);
        let valueElement = directFind(datatype, ["value"]);
        let type = {
            name: typeElement ? typeElement.textContent || "" : "",
            isArray: !!directFind(datatype, ["array"]),
            value: valueElement ? valueElement.textContent || "" : undefined,
        };
        if (type.name == "Measurement Unit (Number or String)=any") {
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
function sort(definitions) {
    for (let definition of definitions) {
        definition.props.sort((a, b) => {
            if (a.type != b.type) {
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
    else if (name == "export") {
        name = "export_";
    }
    return name;
}
