# 🌊 ContextFlow (Skill for Claude Code)

A dynamic, terminal-native task management skill that keeps your AI collaborator in sync without the noise.

![Status: Silent-Mode Active](https://img.shields.io/badge/Status-Silent--Mode%20Active-success?style=flat-square&color=10B981)

## Key Features

- **🔕 Silent Updates**: Background state management that runs invisibly during normal conversation
- **🌳 Git-Tree Visualization**: ASCII-art style trees via `/context` command, rendered like `git log --graph`
- **🔀 Detour Tracking**: Automatic branching for research questions and side explorations
- **📊 Mermaid.js Export**: Professional mind map generation for documentation and sharing

## Visualization Example

When you type `/context`, ContextFlow renders a clean, structured tree:

```text
📂 Project: Chrome Extension
├── 🛠️ Core Development
│   ├── [x] manifest.json
│   └── [>] background.js
├── 🔍 Research & Detours
│   └── [ ] SidePanel API vs Popup
└── 🚀 Deployment
    └── [ ] Chrome Web Store Upload
```

The visualization uses:
- **Category icons** only on top-level branches (`🛠️`, `🔍`, `🚀`)
- **Status markers** on task lines: `[ ]` (todo), `[>]` (in progress), `[x]` (completed)
- **Standard tree connectors**: `├──`, `└──`, `│` for clear hierarchy

## Quick Start

### 1. Install the Skill

Run the one-click installer:

```bash
sh install.sh
```

The installer automatically detects your OS and Claude Code skills directory. If not found, it falls back to a local `.contextflow` directory.

### 2. Restart Your AI Terminal

Restart or refresh your Claude Code terminal to load the skill.

### 3. Start Using ContextFlow

Simply begin your conversation. ContextFlow silently tracks your project state in the background.

### 4. View Your Context Tree

Type `/context` anytime to see your current project structure:

```bash
/context
```

Other useful commands:
- `/done` - Mark current task complete
- `/merge` - Merge a detour back into the main flow
- `/export` - Generate a Mermaid.js diagram

---

*Crafted for productive AI-human collaboration.*
