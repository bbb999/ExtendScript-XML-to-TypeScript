## Convert ExtendScript XML documentation to TypeScript declaration

## Usage:
[Dump declaration files](https://github.com/pravdomil/extendscript-xml-to-typescript/issues/1) first and then:

```bash
# install package
npm i pravdomil/extendscript-xml-to-typescript -g

# convert JavaScript types
extendscript-xml-to-typescript "/Library/Application Support/Adobe/Scripting Dictionaries CC/CommonFiles/javascript.xml"
cat "/Library/Application Support/Adobe/Scripting Dictionaries CC/CommonFiles/javascript.d.ts"

# convert InDesign types
extendscript-xml-to-typescript "~/Library/Preferences/ExtendScript Toolkit/4.0/omv$indesign-11.064$11.3.xml"
cat "~/Library/Preferences/ExtendScript Toolkit/4.0/omv$indesign-11.064$11.3.d.ts"

```

## Converted files
Can be found in [types-for-adobe](https://github.com/pravdomil/types-for-adobe) repository.
