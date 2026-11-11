// Guesses a Monaco language id from the text with cheap heuristics:
// unambiguous signatures first, then rules checked in order

const SHEBANGS = {
    node: "javascript", deno: "typescript", bun: "javascript", python: "python", ruby: "ruby",
    perl: "perl", php: "php", bash: "shell", zsh: "shell", sh: "shell",
}

const atLeast = (min, ...patterns) => text => patterns.filter(pattern => pattern.test(text)).length >= min

// Every meaningful line is a `key: value`, a list item, a block scalar or a document marker
function isYaml(text) {
    const lines = text.split("\n").filter(line => line.trim() && !line.trimStart().startsWith("#"))

    if (lines.length < 2) return false

    const key = /^\s*(?:-\s+)?[\w."'/-]+:\s*(?:.*)$/
    const other = /^\s*(?:---|\.\.\.|-\s+\S.*|\||>)\s*$/

    // At least two keys, or one key opening a block (`items:` followed by a list)
    return (lines.filter(line => key.test(line)).length >= 2 || lines.some(line => /^[\w."'/-]+:\s*$/.test(line)))
        && lines.every(line => key.test(line) || other.test(line))
}

function isJson(text) {
    try {
        JSON.parse(text)
        return true
    } catch {
        return false
    }
}

// JSONC (tsconfig.json, VS Code settings): removes comments, then trailing commas.
// Strings are matched first and kept, so "https://…" is left untouched.
const stripJsonc = text => text
    .replace(/("(?:[^"\\]|\\.)*")|\/\/[^\n]*|\/\*[\s\S]*?\*\//g, (_, string) => string ?? "")
    .replace(/("(?:[^"\\]|\\.)*")|,(?=\s*[}\]])/g, (_, string) => string ?? "")

// The first matching rule wins: put the most specific languages first
const LANGUAGE_RULES = [
    ["markdown", atLeast(1, /^```[\w-]*\s*$/m)],
    ["dockerfile", atLeast(2, /^FROM\s+\S/mi, /^(RUN|CMD|COPY|ENTRYPOINT|WORKDIR)\s/mi)],
    ["go", atLeast(2, /^package\s+\w+\s*$/m, /\bfunc\s+(?:\([^)]*\)\s*)?\w+\s*\(/, /:=/, /\bfmt\.\w+\(/)],
    ["rust", atLeast(2, /\bfn\s+\w+\s*[(<]/, /\blet\s+mut\b/, /^\s*(use|mod)\s+[\w:]+/m, /\b(?:println|vec|format)!\s*[\[(]/, /->\s*\w/)],

    // C++ before C: both use #include
    ["cpp", atLeast(1, /\bstd::/, /\b(?:cout|cin|cerr)\s*<</, /\bnamespace\s+\w+/, /\btemplate\s*</, /^#include\s*<(iostream|vector|string|memory|algorithm)>/m)],
    ["c", atLeast(2, /^#include\s*[<"]/m, /\b(?:int|void)\s+main\s*\(/, /\b(?:printf|scanf|malloc|free)\s*\(/, /^\s*#define\s+\w+/m)],

    ["php", atLeast(1, /<\?(?:php|=)/i, /\$\w+\s*->\s*\w+/)],
    ["java", atLeast(1, /\bpublic\s+static\s+void\s+main\s*\(/, /\bSystem\.out\.print/, /\b(?:public|private|protected)\s+(?:static\s+)?(?:final\s+)?(?:class|interface|void)\b/)],
    // One strong Python signature is enough, otherwise two weaker hints
    ["python", atLeast(1,
        /^\s*(?:async\s+)?def\s+\w+\s*\([^)]*\)\s*(?:->[^:]+)?:/m,
        /^\s*class\s+\w+(?:\([^)]*\))?\s*:/m,
        /^from\s+[\w.]+\s+import\s/m,
        /^import\s+[\w.]+(?:\s+as\s+\w+)?\s*$/m,
        /^\s*(?:for|while|if|elif|with)\s+\S.*:\s*$/m,
        /^\s*(?:try|else|finally|except)\b.*:\s*$/m,
        /^\s*print\s*\(/m
    )],
    ["python", atLeast(2, /\bself\./, /^if\s+__name__\s*==/m, /(?:^|[^.\w])print\s*\(/m, /\b(?:True|False|None)\b/)],
    ["ruby", atLeast(2, /^\s*def\s+\w+[?!]?(?:\(.*\))?\s*$/m, /^\s*end\s*$/m, /\bputs\s/)],
    ["typescript", atLeast(1,
        /\b(?:const|let|var)\s+\w+\s*:\s*[\w[\]|<>, ]+\s*=/,
        /\b\w+\s*:\s*(?:string|number|boolean|any|void|unknown|never)(?:\[\])?(?=\s*[,;)=}]|\s*$)/m,
        /\binterface\s+\w+(?:<[^>]+>)?\s*\{/,
        /^\s*(?:export\s+)?type\s+\w+\s*=/m,
        /\bimport\s+type\s*\{/
    )],
    // No `=>` here: it shows up in plain text too
    ["javascript", atLeast(1,
        /\b(?:const|let|var)\s+[\w$]+\s*=/,
        /\bfunction\s*[\w$]*\s*\(/,
        /\bconsole\.\w+\s*\(/, /\brequire\s*\(\s*['"]/,
        /^\s*import\s+.+\s+from\s+['"]/m,
        /^\s*export\s+(?:default|const|function|class)\b/m
    )],
    // SCSS before CSS: SCSS files contain CSS rules too
    ["scss", atLeast(1, /^\s*\$[\w-]+\s*:/m, /^\s*@(?:mixin|include|use)\b/m)],
    ["css", atLeast(1, /^\s*[^{}\n;]+\{\s*[\w-]+\s*:[^;{}]+(?:;|\})/m, /@(?:media|supports|keyframes|font-face)\b/)],
    // Keywords must start a line: "select … from" inside a sentence stays plain text
    ["sql", atLeast(1,
        /^\s*SELECT\b[\s\S]{0,500}?\bFROM\b/im, /^\s*INSERT\s+INTO\b/im, /^\s*CREATE\s+(?:TABLE|VIEW|INDEX)\b/im,
        /^\s*UPDATE\s+\w+\s+SET\b/im, /^\s*DELETE\s+FROM\b/im, /^\s*ALTER\s+TABLE\b/im, /^\s*WITH\s+\w+\s+AS\s*\(/im
    )],
    ["shell", atLeast(1, /^\s*\$?\s*(?:sudo|npm|npx|yarn|pnpm|git|cd|ls|echo|export|apt|brew|curl|wget|mkdir|rm|cp|mv|chmod|docker|pip)\s+\S/m)],
    ["yaml", isYaml],
    ["ini", atLeast(2, /^\s*\[[\w.\- ]+\]\s*$/m, /^\s*[\w.-]+\s*=\s*\S/m)],
    ["markdown", atLeast(1,
        /^#{1,6}\s+\S/m, /^\s*(?:[-*+]|\d+\.)\s+\S/m,
        /\[[^\]]+\]\([^)]+\)/, /\*\*[^*\n]+\*\*/,
        /^>\s+\S/m, /^\|.*\|\s*$/m
    )],
]

// Returns a Monaco language id, "plaintext" when nothing matches
export function detectLanguage(text) {
    if (typeof text !== "string" || !text.trim()) return "plaintext"

    // Rules only look at the beginning of the text
    const sample = text.slice(0, 10000).trim()

    // Also handles /usr/bin/env, env -S and versioned interpreters (python3.11)
    const shebang = sample.match(/^#!\s*(?:\S*\/)?(?:env\s+(?:-S\s+)?(?:\w+=\S+\s+)*?)?([a-z][\w.-]*)/i)
    if (shebang) {
        const command = shebang[1].replace(/^python\d+(?:\.\d+)?$/, "python")
        if (SHEBANGS[command]) return SHEBANGS[command]
    }

    // The whole text is parsed: about 4 ms per MB
    if (/^[{[]/.test(sample) && isJson(text)) return "json"
    // Stripping is slower (about 40 ms per MB on invalid text) and config files are small
    if (text.length < 100000 && /^(?:\/\/[^\n]*\s*|\/\*[\s\S]*?\*\/\s*)*[{[]/.test(sample) && isJson(stripJsonc(text))) return "json"

    if (/^<!doctype\s+html\b|^<html[\s>]/i.test(sample)) return "html"
    if (/^<\?xml\b/i.test(sample)) return "xml"

    // A fragment starting with a common HTML tag
    if (/^<\/?(?:div|p|span|a|body|head|script|style|ul|li|h[1-6]|img|form|input|button|section|article|table)(?=[\s/>])/i.test(sample)) {
        return "html"
    }

    // Any other tag: most likely XML
    if (/^<[a-z][\w:.-]*(?=[\s/>])/i.test(sample)) return "xml"

    return LANGUAGE_RULES.find(([, test]) => test(sample))?.[0] ?? "plaintext"
}
