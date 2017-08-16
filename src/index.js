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
const xml2js_1 = require("xml2js");
const path_1 = require("path");
let readFile = util_1.promisify(fs_1.readFile);
let writeFile = util_1.promisify(fs_1.writeFile);
function convert(xmlFile) {
    return __awaiter(this, void 0, void 0, function* () {
        try {
            console.info("Converting \"" + path_1.basename(xmlFile) + "\"");
            xmlFile = fs_1.realpathSync(xmlFile);
            let file = yield readFile(xmlFile, "utf-8");
            let xml = yield parseXml(file);
            let transformed = transform(xml);
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
function parseXml(data) {
    return new Promise((resolve, reject) => {
        xml2js_1.parseString(data, { explicitCharkey: true }, (e, result) => {
            e ? reject(e) : resolve(result);
        });
    });
}
function transform(xml) {
    let result = [];
    for (let definition of xml.dictionary.package[0].classdef) {
        result.push(parseDefinition(definition));
    }
    return result;
}
function parseDefinition(definition) {
    let type;
    if (definition.$.enumeration) {
        type = "enum";
    }
    else if (definition.$.dynamic) {
        type = "class";
    }
    else {
        throw new Error("Unknown definition");
    }
    let props = [];
    let methods = [];
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
    };
}
function parseProperty(prop, isStatic) {
    return {
        isStatic: isStatic,
        readonly: prop.$.rwaccess == "readonly",
        name: String(prop.$.name),
        desc: parseDesc(prop),
        types: parseType(prop.datatype),
    };
}
function parseMethod(method, isStatic) {
    return {
        isStatic: isStatic,
        name: String(method.$.name),
        desc: parseDesc(method),
        params: method.parameters ? parseParameters(method.parameters[0].parameter) : [],
        types: parseType(method.datatype),
    };
}
function parseParameters(parameters) {
    let params = [];
    let previousWasOptional = false;
    for (let parameter of parameters) {
        let param = {
            name: String(parameter.$.name),
            desc: parseDesc(parameter),
            optional: previousWasOptional || parameter.$.optional == "true",
            types: parseType(parameter.datatype),
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
function parseDesc(node) {
    let desc = [];
    if (node.shortdesc && node.shortdesc[0]._) {
        desc.push(String(node.shortdesc[0]._).trim());
    }
    if (node.description && node.description[0]._) {
        desc.push(String(node.description[0]._).trim());
    }
    return desc;
}
function parseType(datatype) {
    let types = [];
    if (datatype instanceof Array) {
        let type = {
            name: datatype[0].type[0]._,
            isArray: !!datatype[0].array,
            value: datatype[0].value ? String(datatype[0].value[0]._) : undefined,
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
function generate(definitions) {
    let output = "";
    for (let definition of definitions) {
        output += "/**\n* " + definition.desc.join("\n * ") + "\n*/\n";
        output += "declare " + definition.type + " " + definition.name + " {\n";
        for (let prop of definition.props) {
            output += "\t/**\n\t * " + prop.desc.join("\n\t * ") + "\n\t */\n";
            if (definition.type == "class") {
                let name = prop.name == "constructor" ? "'constructor'" : prop.name;
                let staticKeyword = (prop.isStatic ? "static " : "");
                let readonlyKeyword = (prop.readonly ? "readonly " : "");
                let type = generateType(prop.types);
                output += "\t" + staticKeyword + readonlyKeyword + name + ": " + type + ";\n";
            }
            else if (definition.type == "enum") {
                output += "\t" + prop.name + " = " + prop.types[0].value + ",\n";
            }
            output += "\n";
        }
        for (let method of definition.methods) {
            output += "\t/**\n\t * " + method.desc.join("\n\t * ") + "\n";
            let staticKeyword = (method.isStatic ? "static " : "");
            let type = generateType(method.types);
            let params = [];
            for (let param of method.params) {
                let name = fixParamName(param.name);
                output += "\t * @param " + param.name + " " + param.desc.join(" ") + "\n";
                let p = name + (param.optional ? "?" : "") + ": " + generateType(param.types);
                params.push(p);
            }
            output += "\t */\n";
            if (method.name == "[]") {
                output += "\t" + staticKeyword + "[" + params.join(", ") + "]: " + type + ";\n";
            }
            else if (method.name == definition.name) {
                output += "\t" + staticKeyword + "constructor(" + params.join(", ") + ");\n";
            }
            else {
                output += "\t" + staticKeyword + method.name + "(" + params.join(", ") + "): " + type + ";\n";
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
function fixParamName(name) {
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
    return name;
}
//# sourceMappingURL=index.js.map