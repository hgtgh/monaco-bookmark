import './style.css'

require.config({ paths: { vs: "https://unpkg.com/monaco-editor@0.34.1/min/vs" } })

require(["vs/editor/editor.main"], function () {
    const editor = monaco.editor.create(document.getElementById("editor"), {
        theme: "vs-dark"
    })

    const languagePicker = document.querySelector(".language-picker")
    const languages = monaco.languages.getLanguages()
        .map((lang) => lang.id)
        .sort()

    languages.forEach((language) => {
        const option = document.createElement("option")
        option.textContent = language
        if (language === editor.getModel().getLanguageId()) {
            option.selected = true;
        }
        languagePicker.append(option)
    })

    languagePicker.addEventListener("change", (event) => {
        monaco.editor.setModelLanguage(editor.getModel(), event.target.value)
    });

    window.onresize = () => editor.layout()

    const colorSchema = getComputedStyle(document.querySelector(".monaco-editor"))
    const menu = document.querySelector(".menu")
    menu.style.background = colorSchema.getPropertyValue("--vscode-editor-background")
    menu.style.color = colorSchema.getPropertyValue("--vscode-editor-foreground")
    menu.style.borderBottom = "1px solid" + colorSchema.getPropertyValue("--vscode-editor-lineHighlightBorder")
});
