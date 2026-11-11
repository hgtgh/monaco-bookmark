import './style.css'
import { detectLanguage } from './detect-language.js'

window.require.config({ paths: { vs: "https://cdn.jsdelivr.net/npm/monaco-editor@0.36.1/min/vs" } })

window.require(["vs/editor/editor.main"], function () {
    // Monaco ships marked for its hovers: an internal module, there as long as the version stays pinned.
    // Required once editor.main has defined it, otherwise the loader looks for a separate file.
    const { marked } = window.require("vs/base/common/marked/marked")
    // Same for the command palette's list, used by the language picker
    const { IQuickInputService } = window.require("vs/platform/quickinput/common/quickInput")
    const { StandaloneServices } = window.require("vs/editor/standalone/browser/standaloneServices")

    // Pasted config files (tsconfig.json, VS Code settings) often have comments and trailing commas
    monaco.languages.json.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: "ignore" })

    const models = {
        original: monaco.editor.createModel(""),
        modified: monaco.editor.createModel(""),
    }
    const options = { theme: "vs-dark", wordWrap: "off", automaticLayout: true, scrollBeyondLastLine: false }
    let editor = createEditor(false)

    function createEditor(diff) {
        const container = document.querySelector(".editor")
        if (!diff) {
            return monaco.editor.create(container, { ...options, model: models.modified })
        }
        const diffEditor = monaco.editor.createDiffEditor(container, { ...options, originalEditable: true })
        diffEditor.setModel(models)
        return diffEditor
    }

    // The editor holding the user's text: the right-hand side in diff mode
    const codeEditor = () => editor.getModifiedEditor?.() ?? editor

    // A data: page cannot store anything: ask before the text is lost
    window.addEventListener("beforeunload", (event) => {
        if (models.original.getValueLength() || models.modified.getValueLength()) event.preventDefault()
    })

    const pickLanguage = setupLanguagePicker(models, codeEditor, StandaloneServices.get(IQuickInputService))
    // In the command palette too
    const addActions = () => {
        codeEditor().addAction({
            id: "change-language",
            label: "Change Language Mode",
            run: pickLanguage,
        })
        codeEditor().addAction({
            id: "save-file",
            label: "Save to File",
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
            run: () => saveToFile(models.modified),
        })
    }
    addActions()
    // The command palette opens with F1 only, which needs Fn on most laptops.
    // Not VS Code's Ctrl+Shift+P: Firefox keeps it for private windows. Ctrl+K works in every browser
    // and replaces the Ctrl+K chords (Ctrl+K Ctrl+C to comment...), all available in the palette.
    monaco.editor.addKeybindingRule({
        keybinding: monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK,
        command: "editor.action.quickCommand",
    })
    // Clicking a toolbar button leaves the focus in the editor, where the shortcuts work
    document.querySelector(".toolbar").addEventListener("mousedown", (event) => event.preventDefault())
    const updatePreviewButton = setupPreview(models.modified, codeEditor, marked)

    setupToggle(".wrap-toggle", (on) => {
        options.wordWrap = on ? "on" : "off"
        editor.updateOptions({ wordWrap: options.wordWrap })
    })

    setupToggle(".diff-toggle", (on) => {
        updatePreviewButton()
        const viewState = codeEditor().saveViewState()
        editor.dispose()
        editor = createEditor(on)
        codeEditor().restoreViewState(viewState)
        addActions()
        codeEditor().focus()
    })
});

// Listed first in the picker, in this order; the other languages follow alphabetically
const COMMON_LANGUAGES = [
    "plaintext", "markdown", "json", "yaml", "xml", "html", "css", "scss", "javascript", "typescript",
    "python", "shell", "sql", "dockerfile", "ini", "php", "java", "c", "cpp", "csharp", "go", "rust",
    "ruby", "kotlin", "swift", "powershell",
]

// "auto" (the default) follows the content; picking a language turns detection off.
// Returns the function opening the picker, a filterable list in the command palette.
function setupLanguagePicker(models, codeEditor, quickInput) {
    const button = document.querySelector(".language-picker")
    let auto = true

    const setLanguage = (language) => {
        monaco.editor.setModelLanguage(models.original, language)
        monaco.editor.setModelLanguage(models.modified, language)
        button.textContent = auto ? `auto (${language})` : language
    }
    const detect = () => setLanguage(detectLanguage(models.modified.getValue()))

    let timer
    models.modified.onDidChangeContent((event) => {
        if (!auto) return
        // Once a language is found, typing keeps it (a markdown file with a SQL block stays markdown):
        // only a large paste or deletion, a replaced or an emptied document detects again
        const length = models.modified.getValueLength()
        const large = event.isFlush || event.changes.some((change) =>
            change.text.length > 100 || change.rangeLength > 100 || change.text.length === length)
        if (!large && models.modified.getLanguageId() !== "plaintext" && length) return
        clearTimeout(timer)
        timer = setTimeout(detect, 300)
    })

    // "JavaScript (javascript)", as in VS Code: the alias is what people search for
    const toPickItem = ({ id, aliases }) => ({ id, label: aliases?.[0] ?? id, description: id })
    const languages = monaco.languages.getLanguages()
    const common = COMMON_LANGUAGES.map((id) => languages.find((language) => language.id === id)).filter(Boolean)
    const others = languages.filter((language) => !COMMON_LANGUAGES.includes(language.id)).sort((a, b) => a.id.localeCompare(b.id))
    const items = [
        { id: "auto", label: "Auto detect", description: "from the content" },
        { type: "separator", label: "common" },
        ...common.map(toPickItem),
        { type: "separator", label: "others" },
        ...others.map(toPickItem),
    ]

    async function pickLanguage() {
        // The palette only opens from a focused editor
        codeEditor().focus()
        const current = auto ? "auto" : models.modified.getLanguageId()
        const choice = await quickInput.pick(items, {
            placeHolder: "Select language",
            matchOnDescription: true,
            activeItem: items.find((candidate) => candidate.id === current),
        })
        if (!choice) return
        clearTimeout(timer)
        auto = choice.id === "auto"
        if (auto) detect()
        else setLanguage(choice.id)
    }

    button.addEventListener("click", pickLanguage)
    detect()
    return pickLanguage
}

// Downloads the text, named after its language (the browser asks where to save it if set to)
function saveToFile(model) {
    const languageId = model.getLanguageId()
    const extension = monaco.languages.getLanguages().find(({ id }) => id === languageId)?.extensions?.[0] ?? ".txt"
    const link = document.createElement("a")
    link.href = URL.createObjectURL(new Blob([model.getValue()], { type: "text/plain" }))
    link.download = "untitled" + extension
    link.click()
    // Firefox starts the download after the click returns
    setTimeout(() => URL.revokeObjectURL(link.href))
}

function setupToggle(selector, onChange) {
    const button = document.querySelector(selector)
    button.addEventListener("click", () => {
        const on = !isPressed(button)
        setPressed(button, on)
        onChange(on)
    })
}

const isPressed = (button) => button.getAttribute("aria-pressed") === "true"
const setPressed = (button, on) => button.setAttribute("aria-pressed", on)

// The Preview button, only offered for markdown outside diff mode.
// Returns the function updating it, for a change of mode.
function setupPreview(model, codeEditor, marked) {
    const button = document.querySelector(".preview-toggle")
    const diffButton = document.querySelector(".diff-toggle")
    let closePreview = () => {}
    let request = 0

    // A newer request supersedes one still waiting for the frame to load
    async function setPreview(on) {
        setPressed(button, on)
        document.querySelector(".preview-frame").hidden = !on
        closePreview()
        closePreview = () => {}
        const current = ++request
        if (!on) return
        try {
            const close = await openPreview(codeEditor(), model, marked)
            if (current === request) closePreview = close
            else close()
        } catch (error) {
            console.error(error)
            if (current === request) setPreview(false)
        }
    }

    function update() {
        const available = model.getLanguageId() === "markdown" && !isPressed(diffButton)
        button.hidden = !available
        if (!available && isPressed(button)) setPreview(false)
    }

    setupToggle(".preview-toggle", setPreview)
    model.onDidChangeLanguage(update)
    update()
    return update
}

// Renders the model as markdown in the preview frame, live, following the editor's scroll.
// Returns a function that stops the updates.
async function openPreview(editor, model, marked) {
    const frame = document.querySelector(".preview-frame")
    await loadPreviewFrame(frame)
    const page = frame.contentDocument
    let timer

    const syncScroll = () => {
        const max = editor.getScrollHeight() - editor.getLayoutInfo().height
        const ratio = max > 0 ? editor.getScrollTop() / max : 0
        const root = page.scrollingElement
        root.scrollTop = ratio * (root.scrollHeight - root.clientHeight)
    }
    const render = () => {
        page.body.innerHTML = marked.parse(model.getValue())
        syncScroll()
    }

    render()
    const subscriptions = [
        model.onDidChangeContent(() => {
            clearTimeout(timer)
            timer = setTimeout(render, 150)
        }),
        editor.onDidScrollChange(syncScroll),
    ]
    return () => {
        clearTimeout(timer)
        subscriptions.forEach((subscription) => subscription.dispose())
    }
}

// The frame is sandboxed without scripts: raw HTML in the markdown is displayed, never executed
function loadPreviewFrame(frame) {
    return new Promise((resolve) => {
        frame.addEventListener("load", resolve, { once: true })
        frame.srcdoc = `<!doctype html><base target="_blank"><style>
body{margin:0;padding:8px 24px;font:14px/1.6 system-ui,sans-serif;background:#1e1e1e;color:#d4d4d4;overflow-wrap:break-word}
a{color:#3794ff}
code,pre{font-family:ui-monospace,Menlo,Consolas,monospace;font-size:13px;background:rgba(128,128,128,.15);border-radius:3px}
code{padding:.1em .3em}
pre{padding:8px 12px;overflow:auto}
pre code{padding:0;background:none}
blockquote{margin:0;padding-left:1em;border-left:3px solid rgba(128,128,128,.5);opacity:.85}
table{border-collapse:collapse}
th,td{border:1px solid rgba(128,128,128,.4);padding:4px 8px}
hr{border:0;border-top:1px solid rgba(128,128,128,.4)}
img{max-width:100%}
</style><body>`
    })
}
