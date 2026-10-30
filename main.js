const {
    EditorSuggest,
    MarkdownRenderer,
    MarkdownView,
    Plugin,
    PluginSettingTab,
    Setting,
} = require("obsidian");
const { Decoration, EditorView, WidgetType } = require("@codemirror/view");
const { RangeSetBuilder } = require("@codemirror/state");

const DEFAULT_SETTINGS = {
    showEquationNumbers: true,
    equationNumberFormat: "（#）",
    equationReferenceFormat: "式#",
    figureReferenceFormat: "图#",
    tableReferenceFormat: "表#",
    enableHoverPreview: true,
    enableLiveRendering: true,
    enableBareReferences: false,
    enableLabelSuggestions: true,
};

const DEFINITION_TAG_RE = /\s*\{#(?:eq|fig|tbl):[^}\r\n]+\}/g;
const BRACKET_REFERENCE_RE =
    /\[@(eq|fig|tbl):([^\]\r\n]+)\]/g;
const REFERENCE_RE =
    /\[@(eq|fig|tbl):([^\]\r\n]+)\]|(?<![\\\w])@(eq|fig|tbl):([A-Za-z0-9_](?:[A-Za-z0-9_.:-]*[A-Za-z0-9_-])?)/g;
const INLINE_CODE_RE = /`+[^`\r\n]*`+/g;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;
const TABLE_CAPTION_RE =
    /^[ \t]*(?::|Table:)[ \t]*(.*?)[ \t]*(\{#tbl:[^}\r\n]+\})[ \t]*$/i;
const FIGURE_SAME_LINE_RE =
    /^[ \t]*!\[([^\]]*)\]\([^)]*\)[ \t]*(\{#fig:[^}\r\n]+\})[ \t]*$/;
const STANDALONE_TAG_RE =
    /^[ \t]*\{#(eq|fig|tbl):([^}\r\n]+)\}[ \t]*$/;
const SUGGESTION_TYPES = new Set(["eq", "fig", "tbl"]);

function stripCarriageReturn(line) {
    return line.endsWith("\r") ? line.slice(0, -1) : line;
}

function formatTemplate(template, value) {
    const source = String(template || "").trim();
    const text = String(value ?? "");
    if (!source) return text;
    return source.includes("#") ? source.replace(/#/g, text) : `${source}${text}`;
}

function parseTag(tag) {
    const match = /\{#(eq|fig|tbl):([^}\r\n]+)\}/.exec(tag);
    if (!match) return null;
    return { type: match[1], id: match[2].trim() };
}

function maskCode(source) {
    const lines = source.split("\n");
    let fence = null;

    for (let index = 0; index < lines.length; index += 1) {
        const line = stripCarriageReturn(lines[index]);
        const fenceMatch = FENCE_RE.exec(line);

        if (fence) {
            const close = new RegExp(`^\\s*${fence[0][0]}{${fence.length},}\\s*$`);
            lines[index] = " ".repeat(lines[index].length);
            if (close.test(line)) fence = null;
            continue;
        }

        if (fenceMatch) {
            fence = fenceMatch[1];
            lines[index] = " ".repeat(lines[index].length);
        }
    }

    return lines.join("\n").replace(INLINE_CODE_RE, (match) => " ".repeat(match.length));
}

function referencePattern(allowBareReferences) {
    return allowBareReferences ? REFERENCE_RE : BRACKET_REFERENCE_RE;
}

function parseDocumentModel(source, options = {}) {
    const allowBareReferences = options.allowBareReferences === true;
    const lines = source.split("\n");
    const lineStarts = [];
    let sourceOffset = 0;
    for (const line of lines) {
        lineStarts.push(sourceOffset);
        sourceOffset += line.length + 1;
    }

    const counters = { eq: 0, fig: 0, tbl: 0 };
    const definitions = [];
    const definitionByKey = new Map();
    let fence = null;

    const addDefinition = ({
        type,
        id,
        line,
        startLine = line,
        tag,
        body = "",
        caption = "",
    }) => {
        const tagColumn = stripCarriageReturn(lines[line]).indexOf(tag);
        counters[type] += 1;
        const definition = {
            type,
            id,
            number: counters[type],
            line,
            startLine,
            tag,
            body,
            caption,
            labelStart: lineStarts[line] + tagColumn,
            labelEnd: lineStarts[line] + tagColumn + tag.length,
        };
        definitions.push(definition);
        const key = `${type}:${id}`;
        if (!definitionByKey.has(key)) definitionByKey.set(key, definition);
    };

    for (let index = 0; index < lines.length; index += 1) {
        const line = stripCarriageReturn(lines[index]);
        const fenceMatch = FENCE_RE.exec(line);

        if (fence) {
            const close = new RegExp(`^\\s*${fence[0][0]}{${fence.length},}\\s*$`);
            if (close.test(line)) fence = null;
            continue;
        }
        if (fenceMatch) {
            fence = fenceMatch[1];
            continue;
        }

        const sameLineEquation =
            /^[ \t]*\$\$(.+?)\$\$[ \t]*(\{#eq:[^}\r\n]+\})[ \t]*$/.exec(line);
        if (sameLineEquation) {
            const parsed = parseTag(sameLineEquation[2]);
            addDefinition({
                type: "eq",
                id: parsed.id,
                line: index,
                startLine: index,
                tag: sameLineEquation[2],
                body: sameLineEquation[1].trim(),
            });
            continue;
        }

        if (/^[ \t]*\$\$[ \t]*$/.test(line)) {
            let closingLine = index + 1;
            while (
                closingLine < lines.length &&
                !/^[ \t]*\$\$/.test(stripCarriageReturn(lines[closingLine]))
            ) {
                closingLine += 1;
            }
            if (closingLine >= lines.length) break;

            const closeLine = stripCarriageReturn(lines[closingLine]);
            const closeMatch =
                /^[ \t]*\$\$[ \t]*(\{#eq:[^}\r\n]+\})?[ \t]*$/.exec(closeLine);
            if (!closeMatch) {
                index = closingLine;
                continue;
            }

            let tag = closeMatch[1] || null;
            let labelLine = closingLine;
            if (!tag && closingLine + 1 < lines.length) {
                const nextLine = stripCarriageReturn(lines[closingLine + 1]);
                const standalone = STANDALONE_TAG_RE.exec(nextLine);
                if (standalone?.[1] === "eq") {
                    tag = standalone[0].trim();
                    labelLine = closingLine + 1;
                }
            }

            const body = lines
                .slice(index + 1, closingLine)
                .map(stripCarriageReturn)
                .join("\n")
                .trim();
            if (tag && body) {
                const parsed = parseTag(tag);
                addDefinition({
                    type: "eq",
                    id: parsed.id,
                    line: labelLine,
                    startLine: index,
                    tag,
                    body,
                });
                index = labelLine;
            } else {
                index = closingLine;
            }
            continue;
        }

        const figure = FIGURE_SAME_LINE_RE.exec(line);
        if (figure) {
            const parsed = parseTag(figure[2]);
            addDefinition({
                type: "fig",
                id: parsed.id,
                line: index,
                tag: figure[2],
                caption: figure[1].trim(),
            });
            continue;
        }

        const table = TABLE_CAPTION_RE.exec(line);
        if (table) {
            const parsed = parseTag(table[2]);
            addDefinition({
                type: "tbl",
                id: parsed.id,
                line: index,
                tag: table[2],
                caption: table[1].trim(),
            });
            continue;
        }

        const standalone = STANDALONE_TAG_RE.exec(line);
        if (standalone && standalone[1] !== "eq") {
            const previous = index > 0 ? stripCarriageReturn(lines[index - 1]) : "";
            const previousMatches =
                standalone[1] === "fig"
                    ? /^[ \t]*!\[[^\]]*\]\([^)]*\)[ \t]*$/.test(previous)
                    : /^[ \t]*(?:\||:)/.test(previous);
            if (previousMatches) {
                const parsed = parseTag(standalone[0]);
                addDefinition({
                    type: standalone[1],
                    id: parsed.id,
                    line: index,
                    tag: standalone[0].trim(),
                });
            }
        }
    }

    const citations = [];
    const searchable = maskCode(source);
    const pattern = referencePattern(allowBareReferences);
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(searchable)) !== null) {
        const type = match[1] || match[3];
        const id = (match[2] || match[4] || "").trim();
        if (!type || !id) continue;
        const start = match.index;
        const end = start + match[0].length;
        const definition = definitionByKey.get(`${type}:${id}`);
        const original = source.slice(start, end);
        citations.push({
            type,
            id,
            start,
            end,
            original,
            definition,
            rendered: definition
                ? referenceText(definition, options.settings || DEFAULT_SETTINGS)
                : original,
        });
    }

    return { definitions, definitionByKey, citations };
}

function referenceText(definition, settings) {
    if (!definition) return "";
    const template =
        definition.type === "eq"
            ? settings.equationReferenceFormat
            : definition.type === "fig"
              ? settings.figureReferenceFormat
              : settings.tableReferenceFormat;
    return formatTemplate(template, definition.number);
}

function parseLabelSuggestionTrigger(text, allowBareReferences = false) {
    const bracketOpenMatch = /\[@(eq|fig|tbl)(?::([^\]\s]*))?$/.exec(text);
    if (bracketOpenMatch) {
        return {
            start: bracketOpenMatch.index,
            type: bracketOpenMatch[1],
            query: bracketOpenMatch[2] || "",
            bracket: true,
        };
    }

    const bracketClosedTypeMatch = /\[@(eq|fig|tbl)\]$/.exec(text);
    if (bracketClosedTypeMatch) {
        return {
            start: bracketClosedTypeMatch.index,
            type: bracketClosedTypeMatch[1],
            query: "",
            bracket: true,
        };
    }

    if (!allowBareReferences) return null;
    const bareMatch = /(^|[^\w\\])@(eq|fig|tbl)(?::([^\]\s]*))?$/.exec(text);
    if (!bareMatch) return null;

    return {
        start: bareMatch.index + (bareMatch[1] || "").length,
        type: bareMatch[2],
        query: bareMatch[3] || "",
        bracket: false,
    };
}

function collectLabelSuggestions(source, type, query, settings) {
    if (!SUGGESTION_TYPES.has(type)) return [];

    const model = parseDocumentModel(source, {
        allowBareReferences: settings.enableBareReferences,
        settings,
    });
    const normalizedQuery = String(query || "").trim().toLowerCase();
    const seen = new Set();
    const suggestions = [];

    for (const definition of model.definitions) {
        if (definition.type !== type) continue;
        const key = `${definition.type}:${definition.id}`;
        if (seen.has(key)) continue;
        seen.add(key);

        const normalizedId = definition.id.toLowerCase();
        if (normalizedQuery && !normalizedId.includes(normalizedQuery)) continue;

        const detail = String(definition.caption || definition.body || "")
            .replace(/\s+/g, " ")
            .trim();
        suggestions.push({
            type: definition.type,
            id: definition.id,
            number: definition.number,
            rendered: referenceText(definition, settings),
            detail,
            queryMatch: normalizedId.startsWith(normalizedQuery) ? 0 : 1,
        });
    }

    return suggestions.sort(
        (left, right) =>
            left.queryMatch - right.queryMatch ||
            left.number - right.number ||
            left.id.localeCompare(right.id)
    );
}

function prioritizeEditorSuggest(app, suggestion) {
    const suggests = app?.workspace?.editorSuggest?.suggests;
    if (!Array.isArray(suggests)) return false;

    const index = suggests.indexOf(suggestion);
    if (index < 0) return false;
    if (index > 0) {
        suggests.splice(index, 1);
        suggests.unshift(suggestion);
    }
    return true;
}

function findTextNodeReferences(text, model, settings) {
    const replacements = [];
    const pattern = referencePattern(settings.enableBareReferences);
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
        const type = match[1] || match[3];
        const id = (match[2] || match[4] || "").trim();
        const definition = model.definitionByKey.get(`${type}:${id}`);
        replacements.push({
            start: match.index,
            end: match.index + match[0].length,
            type,
            id,
            original: match[0],
            definition,
            rendered: definition ? referenceText(definition, settings) : match[0],
        });
    }
    return replacements;
}

function isInEditableRange(start, end, state, buffer = 1) {
    const range = state.selection.main;
    const expandedStart = Math.max(0, start - buffer);
    const expandedEnd = end + buffer;
    if (range.from !== range.to) {
        return !(expandedEnd <= range.from || expandedStart >= range.to);
    }
    return range.head >= expandedStart && range.head <= expandedEnd;
}

function refreshViews(app) {
    for (const leaf of app.workspace.getLeavesOfType("markdown")) {
        const view = leaf.view;
        if (!(view instanceof MarkdownView)) continue;
        view.previewMode?.rerender?.(true);
        const cm = view.editor?.cm;
        if (cm) {
            cm.dispatch({ selection: { anchor: cm.state.selection.main.head } });
        }
    }
}

async function navigateToDefinition(plugin, sourcePath, definition) {
    const file = plugin.app.vault.getAbstractFileByPath(sourcePath);
    if (!file || !definition) return;

    const leaf = plugin.app.workspace.getLeaf(false);
    await leaf.openFile(file, {
        state: { mode: "source" },
        eState: { line: definition.line },
        active: true,
    });

    const view = plugin.app.workspace.getActiveViewOfType(MarkdownView);
    if (!view?.editor) return;
    view.editor.setCursor({ line: definition.line, ch: 0 });
    view.editor.focus();

    setTimeout(() => {
        const line = view.containerEl.querySelector(".cm-active.cm-line");
        if (line) {
            line.classList.add("pcl-highlight-line");
            setTimeout(() => line.classList.remove("pcl-highlight-line"), 1500);
        }
    }, 100);
}

function bindEquationHover(target, definition, plugin, sourcePath) {
    if (
        !plugin.settings.enableHoverPreview ||
        !definition ||
        definition.type !== "eq"
    ) {
        return;
    }

    target.removeAttribute("title");
    target.setAttribute("aria-label", `${referenceText(definition, plugin.settings)}，悬停显示公式`);

    let popover = null;
    let showTimer = null;
    let hideTimer = null;

    const destroy = () => {
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = null;
        if (popover) {
            popover.remove();
            popover = null;
        }
    };

    const hide = () => {
        if (showTimer) window.clearTimeout(showTimer);
        showTimer = null;
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = window.setTimeout(destroy, 80);
    };

    const place = () => {
        if (!popover || !target.isConnected) return;
        const anchor = target.getBoundingClientRect();
        const width = Math.min(680, Math.max(280, window.innerWidth - 24));
        popover.style.width = `${width}px`;
        popover.style.left = `${Math.max(12, Math.min(anchor.left, window.innerWidth - width - 12))}px`;
        popover.style.top = `${anchor.bottom + 10}px`;
        requestAnimationFrame(() => {
            if (!popover) return;
            const height = popover.getBoundingClientRect().height;
            if (anchor.bottom + 10 + height > window.innerHeight - 12) {
                popover.style.top = `${Math.max(12, anchor.top - height - 10)}px`;
            }
        });
    };

    const show = async () => {
        if (popover || !target.isConnected) return;
        const element = document.createElement("div");
        element.className = "pcl-equation-popover";
        element.style.visibility = "hidden";

        const title = document.createElement("div");
        title.className = "pcl-equation-popover-title";
        title.textContent = referenceText(definition, plugin.settings);
        const math = document.createElement("div");
        math.className = "pcl-equation-popover-math";

        element.append(title, math);
        document.body.appendChild(element);
        popover = element;
        place();

        try {
            await MarkdownRenderer.render(
                plugin.app,
                `$$\n${definition.body}\n$$`,
                math,
                sourcePath || "",
                plugin
            );
            if (popover === element) {
                place();
                element.style.visibility = "visible";
            }
        } catch (error) {
            console.error("[Pandoc Crossref Live] Failed to render equation preview", error);
            if (popover === element) destroy();
        }
    };

    target.addEventListener("mouseenter", () => {
        if (hideTimer) window.clearTimeout(hideTimer);
        hideTimer = null;
        if (showTimer) window.clearTimeout(showTimer);
        showTimer = window.setTimeout(show, 180);
    });
    target.addEventListener("mouseleave", hide);
    target.addEventListener("blur", hide);
    target.addEventListener("mousedown", destroy);
}

function createReferenceSpan(reference, plugin, sourcePath) {
    const span = document.createElement("span");
    span.className = `pcl-reference${reference.definition ? "" : " invalid"}`;
    span.textContent = reference.rendered;
    span.dataset.rendered = reference.rendered;
    span.dataset.crossref = `${reference.type}:${reference.id}`;

    if (reference.definition) {
        bindEquationHover(span, reference.definition, plugin, sourcePath);
        span.style.cursor = "pointer";
        span.addEventListener("mousedown", (event) => {
            event.preventDefault();
            event.stopPropagation();
            navigateToDefinition(plugin, sourcePath, reference.definition);
        });
    } else {
        span.title = `未找到交叉引用: ${reference.type}:${reference.id}`;
    }

    return span;
}

function replaceReferencesInElement(element, model, plugin, sourcePath) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const jobs = [];
    let node;

    while ((node = walker.nextNode())) {
        const parent = node.parentElement;
        if (parent?.closest("code, pre, a, .pcl-reference")) continue;
        const replacements = findTextNodeReferences(node.textContent || "", model, plugin.settings);
        if (replacements.length) jobs.push({ node, replacements });
    }

    for (const { node, replacements } of jobs) {
        const text = node.textContent || "";
        const fragment = document.createDocumentFragment();
        let lastEnd = 0;

        for (const reference of replacements) {
            if (reference.start > lastEnd) {
                fragment.appendChild(document.createTextNode(text.slice(lastEnd, reference.start)));
            }

            fragment.appendChild(createReferenceSpan(reference, plugin, sourcePath));
            lastEnd = reference.end;
        }

        if (lastEnd < text.length) {
            fragment.appendChild(document.createTextNode(text.slice(lastEnd)));
        }
        node.parentNode?.replaceChild(fragment, node);
    }
}

function recoverPandocReferenceHosts(element, model, plugin, sourcePath) {
    const hosts = element.querySelectorAll("[data-citekey]");
    for (const host of hosts) {
        const key = host.getAttribute("data-citekey") || "";
        if (key.includes("|")) continue;

        const match = /^(eq|fig|tbl):(.+)$/.exec(key);
        if (!match) continue;

        const definition = model.definitionByKey.get(key);
        if (!definition) continue;

        const reference = {
            type: match[1],
            id: match[2],
            definition,
            rendered: referenceText(definition, plugin.settings),
        };
        host.replaceWith(createReferenceSpan(reference, plugin, sourcePath));
    }
}

function hideDefinitionTags(element) {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const jobs = [];
    let node;
    while ((node = walker.nextNode())) {
        const text = node.textContent || "";
        DEFINITION_TAG_RE.lastIndex = 0;
        if (DEFINITION_TAG_RE.test(text)) {
            jobs.push({ node, text: text.replace(DEFINITION_TAG_RE, "") });
        }
    }
    for (const job of jobs) job.node.textContent = job.text;
}

function decorateReadingEquationNumbers(element, model, plugin, ctx) {
    if (!plugin.settings.showEquationNumbers) return;
    const section = ctx.getSectionInfo(element);
    if (!section) return;

    const equations = model.definitions.filter(
        (definition) =>
            definition.type === "eq" &&
            ((definition.startLine >= section.lineStart &&
                definition.startLine <= section.lineEnd) ||
                (definition.line >= section.lineStart &&
                    definition.line <= section.lineEnd))
    );
    if (!equations.length) return;

    const blocks = [];
    if (element.matches?.(".math-block")) blocks.push(element);
    blocks.push(...element.querySelectorAll(".math-block"));
    if (!blocks.length) {
        for (const container of element.querySelectorAll('mjx-container[display="true"]')) {
            const block = container.closest(".math-block") || container.parentElement;
            if (block && !blocks.includes(block)) blocks.push(block);
        }
    }

    for (let index = 0; index < Math.min(equations.length, blocks.length); index += 1) {
        blocks[index].classList.add("pcl-numbered-equation");
        blocks[index].dataset.pclEquationNumber = formatTemplate(
            plugin.settings.equationNumberFormat,
            equations[index].number
        );
    }
}

class ReferenceWidget extends WidgetType {
    constructor(plugin, reference, sourcePath) {
        super();
        this.plugin = plugin;
        this.reference = reference;
        this.sourcePath = sourcePath;
    }

    toDOM(view) {
        const span = document.createElement("span");
        span.className = `pcl-reference${this.reference.definition ? "" : " invalid"}`;
        span.textContent = this.reference.rendered;
        span.dataset.rendered = this.reference.rendered;
        span.dataset.crossref = `${this.reference.type}:${this.reference.id}`;

        if (this.reference.definition) {
            bindEquationHover(
                span,
                this.reference.definition,
                this.plugin,
                this.sourcePath
            );
            span.style.cursor = "pointer";
            span.addEventListener("mousedown", (event) => {
                event.preventDefault();
                event.stopPropagation();
                setTimeout(() => {
                    view.dispatch({
                        selection: { anchor: this.reference.definition.labelStart },
                        scrollIntoView: true,
                    });
                    view.focus();
                }, 0);
            });
        } else {
            span.title = `未找到交叉引用: ${this.reference.type}:${this.reference.id}`;
        }
        return span;
    }

    eq(other) {
        return (
            other instanceof ReferenceWidget &&
            this.reference.type === other.reference.type &&
            this.reference.id === other.reference.id &&
            this.reference.rendered === other.reference.rendered
        );
    }
}

class EquationNumberWidget extends WidgetType {
    constructor(text) {
        super();
        this.text = text;
    }

    toDOM() {
        const span = document.createElement("span");
        span.className = "pcl-equation-number";
        span.textContent = this.text;
        return span;
    }

    eq(other) {
        return other instanceof EquationNumberWidget && this.text === other.text;
    }

    ignoreEvent() {
        return true;
    }
}

class CrossrefLabelSuggest extends EditorSuggest {
    constructor(app, plugin) {
        super(app);
        this.plugin = plugin;
        this.pendingType = null;
        this.pendingBracket = true;
        this.limit = 80;
        this.setInstructions([
            { command: "↑↓", purpose: "选择引用标签" },
            { command: "↵", purpose: "插入标签" },
        ]);
    }

    onTrigger(cursor, editor, file) {
        this.pendingType = null;
        if (!this.plugin.settings.enableLabelSuggestions) {
            return null;
        }

        const line = editor.getLine(cursor.line);
        const trigger = parseLabelSuggestionTrigger(
            line.slice(0, cursor.ch),
            this.plugin.settings.enableBareReferences
        );
        if (!trigger) return null;

        this.pendingType = trigger.type;
        this.pendingBracket = trigger.bracket;
        return {
            start: { line: cursor.line, ch: trigger.start },
            end: cursor,
            query: trigger.query,
        };
    }

    getSuggestions(context) {
        try {
            const suggestions = collectLabelSuggestions(
                context.editor.getValue(),
                this.pendingType,
                context.query,
                this.plugin.settings
            );
            return suggestions;
        } catch (error) {
            console.error("[Pandoc Crossref Live] Label suggestion error", error);
            return [];
        }
    }

    renderSuggestion(suggestion, element) {
        element.addClass("pcl-suggestion");
        element.createSpan({
            cls: "pcl-suggestion-label",
            text: suggestion.id,
        });
        element.createSpan({
            cls: "pcl-suggestion-number",
            text: suggestion.rendered,
        });
        if (suggestion.detail) {
            element.createSpan({
                cls: "pcl-suggestion-detail",
                text: suggestion.detail,
            });
        }
    }

    selectSuggestion(suggestion) {
        const context = this.context;
        if (!context) return;

        const { editor, start, end } = context;
        const replacement = this.pendingBracket
            ? `[@${suggestion.type}:${suggestion.id}]`
            : `@${suggestion.type}:${suggestion.id}`;
        const currentLine = editor.getLine(end.line);
        const replacementEnd = {
            line: end.line,
            ch:
                this.pendingBracket && currentLine[end.ch] === "]"
                    ? end.ch + 1
                    : end.ch,
        };

        editor.replaceRange(replacement, start, replacementEnd);
        editor.setCursor({
            line: start.line,
            ch: start.ch + replacement.length,
        });
        this.close();
    }
}

function createLiveExtension(plugin) {
    return EditorView.decorations.compute(["doc", "selection"], (state) => {
        if (!plugin.settings.enableLiveRendering) return Decoration.none;

        try {
            const file = plugin.app.workspace.getActiveFile();
            if (!file || file.extension !== "md") return Decoration.none;

            const content = state.doc.toString();
            const model = parseDocumentModel(content, {
                allowBareReferences: plugin.settings.enableBareReferences,
                settings: plugin.settings,
            });
            const entries = [];

            for (const reference of model.citations) {
                if (isInEditableRange(reference.start, reference.end, state)) continue;
                entries.push({
                    start: reference.start,
                    end: reference.end,
                    decoration: Decoration.replace({
                        widget: new ReferenceWidget(plugin, reference, file.path),
                    }),
                });
            }

            for (const definition of model.definitions) {
                if (isInEditableRange(definition.labelStart, definition.labelEnd, state)) continue;
                const number =
                    definition.type === "eq" && plugin.settings.showEquationNumbers
                        ? new EquationNumberWidget(
                              formatTemplate(
                                  plugin.settings.equationNumberFormat,
                                  definition.number
                              )
                          )
                        : null;
                entries.push({
                    start: definition.labelStart,
                    end: definition.labelEnd,
                    decoration: Decoration.replace(number ? { widget: number } : {}),
                });
            }

            entries.sort((a, b) => a.start - b.start || a.end - b.end);
            const builder = new RangeSetBuilder();
            for (const entry of entries) {
                builder.add(entry.start, entry.end, entry.decoration);
            }
            return builder.finish();
        } catch (error) {
            console.error("[Pandoc Crossref Live] Live decoration error", error);
            return Decoration.none;
        }
    });
}

class PandocCrossrefLiveSettingTab extends PluginSettingTab {
    constructor(app, plugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display() {
        const { containerEl } = this;
        containerEl.empty();
        containerEl.createEl("h2", { text: "Pandoc Crossref Live" });

        new Setting(containerEl)
            .setName("显示右侧公式编号")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.showEquationNumbers)
                    .onChange(async (value) => {
                        this.plugin.settings.showEquationNumbers = value;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("公式编号格式")
            .setDesc("使用 # 代表编号，例如：（#）")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.equationNumberFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.equationNumberFormat =
                            value.trim() || DEFAULT_SETTINGS.equationNumberFormat;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("公式引用格式")
            .setDesc("使用 # 代表编号，例如：式#")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.equationReferenceFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.equationReferenceFormat =
                            value.trim() || DEFAULT_SETTINGS.equationReferenceFormat;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("图引用格式")
            .setDesc("使用 # 代表编号，例如：图#")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.figureReferenceFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.figureReferenceFormat =
                            value.trim() || DEFAULT_SETTINGS.figureReferenceFormat;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("表引用格式")
            .setDesc("使用 # 代表编号，例如：表#")
            .addText((text) =>
                text
                    .setValue(this.plugin.settings.tableReferenceFormat)
                    .onChange(async (value) => {
                        this.plugin.settings.tableReferenceFormat =
                            value.trim() || DEFAULT_SETTINGS.tableReferenceFormat;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("悬停显示公式")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableHoverPreview)
                    .onChange(async (value) => {
                        this.plugin.settings.enableHoverPreview = value;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("实时编辑视图渲染")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableLiveRendering)
                    .onChange(async (value) => {
                        this.plugin.settings.enableLiveRendering = value;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("同时识别裸引用")
            .setDesc("除 [@type:id] 外也识别 @type:id。默认关闭，避免与文献引用混淆")
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableBareReferences)
                    .onChange(async (value) => {
                        this.plugin.settings.enableBareReferences = value;
                        await this.plugin.saveSettings();
                        refreshViews(this.app);
                    })
            );

        new Setting(containerEl)
            .setName("引用标签自动补全")
            .setDesc(
                "输入 [@eq:、[@fig: 或 [@tbl: 后，从当前笔记的已有标签中选择"
            )
            .addToggle((toggle) =>
                toggle
                    .setValue(this.plugin.settings.enableLabelSuggestions)
                    .onChange(async (value) => {
                        this.plugin.settings.enableLabelSuggestions = value;
                        await this.plugin.saveSettings();
                    })
            );
    }
}

module.exports = class PandocCrossrefLivePlugin extends Plugin {
    settings = { ...DEFAULT_SETTINGS };

    async onload() {
        await this.loadSettings();
        this.addSettingTab(new PandocCrossrefLiveSettingTab(this.app, this));

        this.registerMarkdownPostProcessor((element, ctx) => {
            if (element.dataset.pclProcessed === "true") return;
            element.dataset.pclProcessed = "true";

            const file = this.app.vault.getAbstractFileByPath(ctx.sourcePath);
            if (!file) return;

            this.app.vault.cachedRead(file).then((content) => {
                const model = parseDocumentModel(content, {
                    allowBareReferences: this.settings.enableBareReferences,
                    settings: this.settings,
                });
                const render = () => {
                    if (!element.isConnected) return;
                    hideDefinitionTags(element);
                    replaceReferencesInElement(element, model, this, ctx.sourcePath);
                    recoverPandocReferenceHosts(element, model, this, ctx.sourcePath);
                    decorateReadingEquationNumbers(element, model, this, ctx);
                };
                setTimeout(render, 50);
                setTimeout(render, 500);
            });
        });

        this.registerEditorExtension(createLiveExtension(this));
        this.labelSuggest = new CrossrefLabelSuggest(this.app, this);
        this.registerEditorSuggest(this.labelSuggest);
        this.app.workspace.onLayoutReady(() => {
            prioritizeEditorSuggest(this.app, this.labelSuggest);
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
};

module.exports.__test = {
    CrossrefLabelSuggest,
    parseDocumentModel,
    parseLabelSuggestionTrigger,
    collectLabelSuggestions,
    prioritizeEditorSuggest,
    formatTemplate,
    referenceText,
    maskCode,
};
