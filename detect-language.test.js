import assert from "node:assert/strict"
import { describe, test } from "node:test"
import { detectLanguage } from "./detect-language.js"

// Expected language → samples. Each sample is a test named after its first line.
const CASES = {
    json: [
        '{\n  "name": "x",\n  "list": [1, 2]\n}',
        '[{"a":1}]',
        // JSONC: comments and trailing commas, a comment marker inside a string
        '{\n  // comment\n  "compilerOptions": {\n    "strict": true, /* block */\n    "lib": ["ES2023",],\n  },\n}',
        '{\n  "url": "https://x.dev", // homepage\n  "glob": "src/**/*.ts"\n}',
        '// Settings\n/* generated */\n{\n  "editor.fontSize": 14,\n}',
        // Beyond the first 10 000 characters looked at by the rules
        JSON.stringify(Array(5000).fill({ id: 1, name: "item", tags: ["a", "b"] }), null, 2),
    ],
    html: [
        '<!DOCTYPE html>\n<html><body><p>Hi</p></body></html>',
        '<div class="card">\n  <h2>Title</h2>\n</div>',
        '<section>\n  <h2>Titre</h2>\n</section>',
    ],
    xml: [
        '<?xml version="1.0"?>\n<note><to>Bob</to></note>',
        '<project>\n  <modelVersion>4.0.0</modelVersion>\n</project>',
    ],
    shell: [
        '#!/usr/bin/env bash\nset -e\necho hi',
        'npm install\nnpm run build',
        '$ git status',
        // A comment line is not a markdown heading
        '# Installation\nnpm install\nnpm run build',
    ],
    python: [
        '#!/usr/bin/env python3\nprint("hi")',
        '#!/usr/bin/python3.11\nprint(1)',
        'import os\n\ndef main():\n    print(os.getcwd())\n\nif __name__ == "__main__":\n    main()',
        'from typing import List\n\nclass Stack:\n    def __init__(self):\n        self.items: List[int] = []',
        'config = {\n    "debug": True,\n}\nprint(config)',
        'for i in range(3):\n    print(i)',
    ],
    javascript: [
        '#!/usr/bin/env node\nconsole.log(1)',
        'const add = (a, b) => a + b\nconsole.log(add(1, 2))',
        "import React from 'react'\n\nexport default function App() {\n  return null\n}",
        "const fs = require('fs');\nfs.readFileSync('x');",
        'console.log("hi")',
        'function hello() {\n  return 42\n}',
        // An object literal is not a CSS rule
        'const theme = {\n  color: "red",\n  size: 12,\n}',
        // `self.` and `.print(` are not Python here
        'const page = self.document\nwindow.print()',
    ],
    typescript: [
        '#!/usr/bin/env -S deno run --allow-net\nconsole.log(1)',
        'function greet(name: string): string {\n  return `Hello ${name}`\n}',
        'interface User {\n  id: number\n  name: string\n}',
        'export type Id = string | number',
        "import type { User } from './user'\nexport const a = 1",
        'const port: number = 3000',
    ],
    css: [
        'body {\n  margin: 0;\n  color: red;\n}',
        '.btn:hover { background: #333 }',
        '@media (max-width: 600px) {\n  body {\n    margin: 0;\n  }\n}',
    ],
    scss: [
        '$c: red;\n.a {\n  .b { color: $c; }\n}',
    ],
    sql: [
        'SELECT id, name\nFROM users\nWHERE active = 1;',
        'select id, name\nfrom users\nwhere id = 1',
        'create table users (id int primary key);',
        'DELETE FROM sessions WHERE expired = 1',
    ],
    go: [
        'package main\n\nimport "fmt"\n\nfunc main() {\n\tx := 1\n\tfmt.Println(x)\n}',
        'package main\n\nfunc main() {\n\tfmt.Println("hi")\n}',
    ],
    rust: [
        'use std::io;\n\nfn main() {\n    let mut s = String::new();\n    println!("{}", s);\n}',
        'fn main() {\n    println!("hi");\n    let v = vec![1, 2];\n}',
    ],
    cpp: [
        '#include <iostream>\n\nint main() {\n  std::cout << "hi";\n}',
        '#include <iostream>\nint main() {\n  return 0;\n}',
    ],
    c: [
        '#include <stdio.h>\n\nint main(void) {\n  printf("hi");\n  return 0;\n}',
        '#include <stdio.h>\nint main(void) {\n  printf("hi");\n}',
    ],
    java: [
        'public class Main {\n  public static void main(String[] args) {\n    System.out.println("hi");\n  }\n}',
    ],
    php: [
        '<?php\necho "hi";',
    ],
    ruby: [
        'def hello\n  puts "hi"\nend',
    ],
    dockerfile: [
        'FROM node:20\nWORKDIR /app\nRUN npm ci\nCMD ["node", "index.js"]',
    ],
    yaml: [
        'name: CI\non: push\njobs:\n  build:\n    runs-on: ubuntu-latest\n    steps:\n      - uses: actions/checkout@v4',
        '# config\nport: 8080\nhosts:\n  - a\n  - b',
        "steps:\n  - uses: actions/setup-node@v4\n    with:\n      node-version: 20\n  - run: npm test\n    if: github.event_name == 'push'",
        'Note: x\nTodo: y',
        'items:\n  - a\n  - b',
    ],
    ini: [
        '[package]\nname = "x"\nversion = "0.1.0"',
    ],
    markdown: [
        '# Titre\n\nUn paragraphe avec un [lien](https://x.y).',
        '## Install\n\n```js\nconst x = require("x");\nconsole.log(x)\n```',
        '- acheter du pain\n- appeler Paul',
        'Liste:\n\n- one\n- two\n\nEt un **mot** important.',
        'Note: rappeler\n- demain',
        // An inline tag does not make it HTML
        '# Doc\n\nUtiliser la balise <html> ici.',
    ],
    // Prose that must not be mistaken for code
    plaintext: [
        '',
        // Comments removed, still not JSON: unquoted keys
        '{\n  // settings\n  debug: true\n}',
        'Bonjour,\n\nJe voulais importer les données depuis le serveur hier soir.\nMerci',
        'Note: any questions, ping me',
        'Merci de select the best option from the list.',
        'Create a new account as admin.',
        '2026-11-02 10:00:01 INFO Server started\n2026-11-02 10:00:02 WARN Slow query',
        'If you have time:\nplease call me back.',
    ],
}

for (const [language, samples] of Object.entries(CASES)) {
    describe(language, () => {
        for (const sample of samples) {
            test(JSON.stringify(sample.split("\n")[0].slice(0, 60)), () => {
                assert.equal(detectLanguage(sample), language)
            })
        }
    })
}
