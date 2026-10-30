const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

class Stub {}
class Plugin extends Stub {}
class PluginSettingTab extends Stub {}
class WidgetType extends Stub {}
class EditorSuggest extends Stub {
    constructor(app) {
        super();
        this.app = app;
    }

    setInstructions() {}

    close() {}
}

const pluginPath = path.resolve(__dirname, "..", "main.js");
const source = fs.readFileSync(pluginPath, "utf8");
const moduleRecord = { exports: {} };

const requireStub = (id) => {
    if (id === "obsidian") {
        return {
            EditorSuggest,
            MarkdownRenderer: { render: async () => {} },
            MarkdownView: Stub,
            Plugin,
            PluginSettingTab,
            Setting: Stub,
        };
    }
    if (id === "@codemirror/view") {
        return {
            Decoration: {
                none: null,
                replace: (value) => value,
            },
            EditorView: {
                decorations: {
                    compute: () => null,
                },
            },
            WidgetType,
        };
    }
    if (id === "@codemirror/state") {
        return { RangeSetBuilder: Stub };
    }
    throw new Error(`Unexpected require: ${id}`);
};

new Function(
    "require",
    "module",
    "exports",
    "document",
    "window",
    source
)(requireStub, moduleRecord, moduleRecord.exports, undefined, undefined);

const {
    CrossrefLabelSuggest,
    parseDocumentModel,
    parseLabelSuggestionTrigger,
    collectLabelSuggestions,
    prioritizeEditorSuggest,
    formatTemplate,
    referenceText,
    maskCode,
} = moduleRecord.exports.__test;

const settings = {
    equationReferenceFormat: "式#",
    figureReferenceFormat: "图#",
    tableReferenceFormat: "表#",
};

function citationText(definition) {
    return referenceText(definition, settings);
}

test("parses all supported equation label placements", () => {
    const cases = [
        ["$${#eq:no-space}", "no-space"],
        ["$$     {#eq:many-spaces}", "many-spaces"],
        ["$$\n{#eq:next-line}", "next-line"],
    ];

    for (const [closing, id] of cases) {
        const model = parseDocumentModel(
            `$$\nx=1\n${closing}\n\nSee [@eq:${id}].\n`,
            { settings }
        );
        assert.equal(model.definitions.length, 1);
        assert.equal(model.definitions[0].id, id);
        assert.equal(model.definitions[0].body, "x=1");
        assert.equal(model.citations.length, 1);
        assert.equal(citationText(model.citations[0].definition), "式1");
    }
});

test("parses equations, figures, and tables independently", () => {
    const document = [
        "$$E=mc^2$${#eq:einstein}",
        "",
        "![Cat](cat.png){#fig:cat}",
        "![Dog](dog.png)",
        "{#fig:dog}",
        "",
        ": Data {#tbl:data}",
        "",
        "See [@eq:einstein], [@fig:cat], [@fig:dog], and [@tbl:data].",
    ].join("\n");
    const model = parseDocumentModel(document, { settings });

    assert.equal(
        model.definitions.filter((item) => item.type === "eq").length,
        1
    );
    assert.equal(
        model.definitions.filter((item) => item.type === "fig").length,
        2
    );
    assert.equal(
        model.definitions.filter((item) => item.type === "tbl").length,
        1
    );
    assert.equal(model.citations.length, 4);
    assert.deepEqual(
        model.citations.map((item) => item.rendered),
        ["式1", "图1", "图2", "表1"]
    );
});

test("keeps bibliography citations untouched", () => {
    const model = parseDocumentModel(
        "Crossref [@fig:cat], bibliography [@smith2020].",
        { settings }
    );

    assert.equal(model.citations.length, 1);
    assert.equal(model.citations[0].original, "[@fig:cat]");
});

test("bare references are opt-in", () => {
    const document = "![Cat](cat.png){#fig:cat}\n\nSee @fig:cat.";
    assert.equal(parseDocumentModel(document, { settings }).citations.length, 0);
    assert.equal(
        parseDocumentModel(document, {
            settings,
            allowBareReferences: true,
        }).citations.length,
        1
    );
});

test("ignores references inside code", () => {
    assert.equal(
        parseDocumentModel("`[@fig:fake]`", { settings }).citations.length,
        0
    );
    assert.equal(
        parseDocumentModel("```\n[@fig:fake]\n```", { settings }).citations
            .length,
        0
    );
    assert.equal(maskCode("`[@fig:fake]`").trim(), "");
});

test("formats equation numbers and references separately", () => {
    assert.equal(formatTemplate("（#）", 5), "（5）");
    assert.equal(formatTemplate("式#", 5), "式5");
});

test("detects bracket reference label completion triggers", () => {
    assert.deepEqual(parseLabelSuggestionTrigger("See [@eq"), {
        start: 4,
        type: "eq",
        query: "",
        bracket: true,
    });
    assert.deepEqual(parseLabelSuggestionTrigger("See [@eq]"), {
        start: 4,
        type: "eq",
        query: "",
        bracket: true,
    });
    assert.deepEqual(parseLabelSuggestionTrigger("See [@eq:matrix"), {
        start: 4,
        type: "eq",
        query: "matrix",
        bracket: true,
    });
    assert.deepEqual(parseLabelSuggestionTrigger("[@fig:"), {
        start: 0,
        type: "fig",
        query: "",
        bracket: true,
    });
    assert.equal(parseLabelSuggestionTrigger("[@smith2020:"), null);
    assert.equal(parseLabelSuggestionTrigger("[@e"), null);
    assert.equal(parseLabelSuggestionTrigger("See @eq:matrix"), null);
});

test("detects bare reference label completion only when enabled", () => {
    assert.deepEqual(parseLabelSuggestionTrigger("See @eq", true), {
        start: 4,
        type: "eq",
        query: "",
        bracket: false,
    });
    assert.deepEqual(parseLabelSuggestionTrigger("See @eq:matrix", true), {
        start: 4,
        type: "eq",
        query: "matrix",
        bracket: false,
    });
    assert.equal(parseLabelSuggestionTrigger("name@eq:matrix", true), null);
    assert.equal(parseLabelSuggestionTrigger("See @eq:matrix", false), null);
});

test("collects matching existing labels in document order", () => {
    const document = [
        "$$a$${#eq:matrix}",
        "$$b$${#eq:matrix-extra}",
        "$$c$${#eq:energy}",
        "![Cat](cat.png){#fig:cat}",
        "",
        "See [@eq:matrix].",
    ].join("\n");

    const suggestions = collectLabelSuggestions(
        document,
        "eq",
        "mat",
        settings
    );
    assert.deepEqual(
        suggestions.map((item) => item.id),
        ["matrix", "matrix-extra"]
    );
    assert.deepEqual(
        suggestions.map((item) => item.rendered),
        ["式1", "式2"]
    );
    assert.equal(
        collectLabelSuggestions(document, "fig", "", settings)[0].id,
        "cat"
    );
});

test("deduplicates repeated labels in label suggestions", () => {
    const document = [
        "$$a$${#eq:repeat}",
        "$$b$${#eq:repeat}",
        "",
        "See [@eq:repeat].",
    ].join("\n");

    const suggestions = collectLabelSuggestions(
        document,
        "eq",
        "rep",
        settings
    );
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].id, "repeat");
});

test("prioritizes crossref suggestions ahead of bibliography suggestions", () => {
    const bibliographySuggest = { name: "bibliography" };
    const crossrefSuggest = { name: "crossref" };
    const manager = { suggests: [bibliographySuggest, crossrefSuggest] };
    const app = { workspace: { editorSuggest: manager } };

    assert.equal(prioritizeEditorSuggest(app, crossrefSuggest), true);
    assert.deepEqual(manager.suggests, [
        crossrefSuggest,
        bibliographySuggest,
    ]);
    assert.equal(
        prioritizeEditorSuggest({ workspace: {} }, crossrefSuggest),
        false
    );
});

test("uses instance state because Obsidian does not preserve custom context fields", () => {
    const document = [
        "$$a$${#eq:matrix}",
        "$$b$${#eq:energy}",
        "",
        "See [@eq",
    ].join("\n");
    const plugin = {
        settings: {
            ...settings,
            enableBareReferences: false,
            enableLabelSuggestions: true,
        },
    };
    const editor = {
        getLine: () => "See [@eq",
        getValue: () => document,
    };
    const suggest = new CrossrefLabelSuggest({}, plugin);
    const trigger = suggest.onTrigger(
        { line: 3, ch: 8 },
        editor,
        { extension: "md" }
    );

    assert.equal(trigger.query, "");
    assert.equal(suggest.pendingType, "eq");
    assert.deepEqual(
        suggest
            .getSuggestions({ editor, query: "" })
            .map((item) => item.id),
        ["matrix", "energy"]
    );
});
