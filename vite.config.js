import { readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { defineConfig } from "vite"
import { viteSingleFile } from "vite-plugin-singlefile"

const README_SNIPPET = /(<!-- bookmark -->)[\s\S]*?(<!-- \/bookmark -->)/

// Writes the built page as a data: URL in README.md, between the bookmark markers.
// `%` and `#` must be escaped, otherwise the browser truncates the URL at the first `#`.
function dataUrlBookmark() {
    let root
    let outDir
    return {
        name: "data-url-bookmark",
        apply: "build",
        configResolved(config) {
            root = config.root
            outDir = resolve(config.root, config.build.outDir)
        },
        closeBundle() {
            const htmlPath = resolve(outDir, "index.html")
            const html = readFileSync(htmlPath, "utf8")
                .replace(/\/\*\$vite\$:\d+\*\//g, "")
                // Line breaks and indentation between tags, which end up as `%0A    ` in the URL
                .replace(/>\s+</g, "><")
                .trim()
            writeFileSync(htmlPath, html)
            const url = "data:text/html," + html.replace(/[%#\r\n]/g, encodeURIComponent)

            const readmePath = resolve(root, "README.md")
            const readme = readFileSync(readmePath, "utf8")
            if (!README_SNIPPET.test(readme)) {
                this.warn("README.md: bookmark markers not found, URL not updated")
                return
            }
            // A function replacement: `$` in the URL must not be read as a pattern
            writeFileSync(readmePath, readme.replace(README_SNIPPET, (_, start, end) => `${start}\n\n\`\`\`txt\n${url}\n\`\`\`\n\n${end}`))
        },
    }
}

export default defineConfig({
    build: {
        modulePreload: { polyfill: false },
    },
    plugins: [
        viteSingleFile(),
        dataUrlBookmark(),
    ],
})
