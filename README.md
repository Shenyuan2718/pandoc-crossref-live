# Pandoc Crossref Live

[English](#english) | [中文](#中文)

## English

An Obsidian plugin written in plain JavaScript for live Pandoc-style equation, figure, and table cross-references.

### Features

- Equation references: `[@eq:id]`
- Figure references: `[@fig:id]`
- Table references: `[@tbl:id]`
- Optional bare references: `@eq:id`, `@fig:id`, and `@tbl:id`, disabled by default
- Sequential equation numbers displayed at the right
- Rendered LaTeX equation previews on hover
- Reading view and live editing view support
- Existing-label autocomplete while typing cross-reference IDs
- Leaves regular Pandoc bibliography citations such as `[@smith2020]` untouched
- Designed to coexist with Pandoc Reference List

### Syntax

```markdown
$$E = mc^2$${#eq:einstein}

![A cat](cat.png){#fig:cat}

| Parameter | Value |
| --- | --- |
| A | 1 |
: Experimental data {#tbl:data}

See [@eq:einstein], [@fig:cat], and [@tbl:data].
```

Live editing mode supports equation tags immediately after the closing `$$`, separated by any number of spaces, or placed on the next line.

### Installation

1. Create this directory in your vault:

```text
<Vault>/.obsidian/plugins/pandoc-crossref-live
```

2. Copy these files into it:

```text
main.js
manifest.json
styles.css
```

3. Enable **Pandoc Crossref Live** under Community plugins.

### Settings

- Show right-aligned equation numbers
- Equation number format
- Equation reference format
- Figure reference format
- Table reference format
- Show rendered equations on hover
- Enable live editing rendering
- Recognize bare references
- Enable cross-reference label autocomplete

Typing `[@eq`, `[@fig`, or `[@tbl` lists matching labels from the current note, whether or not a colon has already been typed. The first matching candidate is preselected; use the arrow keys to choose another label and press Enter to insert it. Continue typing part of an ID to filter the list. Suggestions display the rendered number and available equation content or caption. If bare references are enabled, `@eq`, `@fig`, and `@tbl` also provide autocomplete.

Autocomplete intentionally starts only after a known cross-reference type. It takes priority for those three types but leaves ordinary bibliography suggestions such as `[@smith2020]` to Pandoc Reference List.

The `#` placeholder is replaced with the relevant number:

```text
（#） → （3）
式#    → 式3
图#    → 图2
表#    → 表1
```

### Pandoc Reference List compatibility

This plugin handles only `eq`, `fig`, and `tbl` cross-references. Regular bibliography keys such as `[@smith2020]` remain available for Pandoc Reference List.

Tested with:

- Obsidian 1.14.5
- Pandoc Reference List 2.0.25

### Known limitation

Obsidian's reading-mode Markdown parser does not correctly handle a multiline equation closed by `$$ {#eq:id}`. This form works in live editing view. For reading mode, put the tag on the following line or use a standard single-line display equation.

### Development

```bash
npm run check
npm test
```

### License

[MIT](LICENSE)

---

## 中文

### 功能

- 公式引用：`[@eq:id]`
- 图引用：`[@fig:id]`
- 表引用：`[@tbl:id]`
- 可选裸引用：`@eq:id`、`@fig:id`、`@tbl:id`，默认关闭
- 在公式右侧显示顺序编号
- 鼠标悬停公式引用时显示渲染后的公式
- 同时支持阅读视图和实时编辑视图
- 输入交叉引用时自动补全当前笔记中的已有标签
- 不处理普通 Pandoc 文献引用，例如 `[@smith2020]`
- 与 Pandoc Reference List 插件共存

默认格式：

```text
公式右侧编号：（#）
正文公式引用：式#
图引用：图#
表引用：表#
```

默认显示效果：

```text
（1）  右侧公式编号
式1    正文公式引用
图1    正文图引用
表1    正文表引用
```

### 语法

#### 公式

```markdown
$$E = mc^2$${#eq:einstein}

$$
A(r)x(r)=b(r)
$${#eq:matrix}

$$
E = mc^2
$$
{#eq:energy}
```

实时编辑视图支持公式标签紧跟在结束 `$$` 后、与 `$$` 之间有任意空格，以及位于下一行。

#### 图

```markdown
![A cat](cat.png){#fig:cat}
```

也支持标签位于图片下一行：

```markdown
![A cat](cat.png)
{#fig:cat}
```

#### 表

```markdown
| Parameter | Value |
| --- | --- |
| A | 1 |
: Experimental data {#tbl:data}
```

#### 引用

```markdown
参见[@eq:einstein]、[@fig:cat]和[@tbl:data]。
```

裸引用默认关闭。开启后也支持：

```markdown
参见@eq:einstein、@fig:cat和@tbl:data。
```

### 安装

#### 手动安装

1. 在库中创建目录：

```text
<Vault>/.obsidian/plugins/pandoc-crossref-live
```

2. 将以下文件复制到该目录：

```text
main.js
manifest.json
styles.css
```

3. 在 Obsidian 的“第三方插件”中启用 **Pandoc Crossref Live**。

#### GitHub Release

Release 中应附带：

```text
main.js
manifest.json
styles.css
```

### 设置

- 显示右侧公式编号
- 公式编号格式
- 公式引用格式
- 图引用格式
- 表引用格式
- 悬停显示公式
- 实时编辑视图渲染
- 同时识别裸引用
- 引用标签自动补全

输入 `[@eq`、`[@fig` 或 `[@tbl` 后（不要求已经输入冒号），插件会列出当前笔记中匹配的已有标签。首个匹配项会预先选中，可用方向键切换，按回车插入；继续输入标签的一部分即可过滤。候选会同时显示渲染后的编号，以及公式开头或图表题注。开启裸引用后，`@eq`、`@fig` 和 `@tbl` 也会提供补全。

补全只在已经输入交叉引用类型后启动。它对 `eq`、`fig`、`tbl` 三类引用优先响应，但 `[@smith2020]` 等普通文献引用仍交给 Pandoc Reference List。

格式模板中的 `#` 会被替换为对应编号。例如：

```text
（#） → （3）
式#    → 式3
图#    → 图2
表#    → 表1
```

### 与 Pandoc Reference List 共存

本插件只处理带 `eq`、`fig`、`tbl` 类型的交叉引用，不处理 `[@smith2020]` 等普通文献引用。Pandoc Reference List 可以继续负责 `.bib` 与 CSL 文献渲染。

测试环境：

- Obsidian 1.14.5
- Pandoc Reference List 2.0.25

两者同时启用时：

- `[@eq:...]`、`[@fig:...]`、`[@tbl:...]` 由本插件处理
- `[@smith2020]` 等文献键由 Pandoc Reference List 处理
- 行内代码和围栏代码块不会被替换

### 已知限制

Obsidian 阅读视图的 Markdown 解析器不能正确识别以下多行公式写法：

```markdown
$$
E = mc^2
$$ {#eq:einstein}
```

该写法在实时编辑视图中可以正常工作。需要在阅读视图中使用时，请将标签放在公式结束后的下一行，或使用标准单行公式：

```markdown
$$
E = mc^2
$$
{#eq:einstein}
```

Pandoc Reference List 的文献显示仍依赖正确的 `.bib` 和 CSL 配置。

### 开发

插件使用纯 JavaScript 编写，不需要构建步骤。

```bash
npm run check
npm test
```

### 许可证

[MIT](LICENSE)
