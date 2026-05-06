# DeepSeek Chat Prompt Injector

A Tampermonkey script that automatically injects custom prompts into new conversations on DeepSeek Chat. It intercepts the **first API request** of each session and prepends or wraps your preset prompts – so you can steer the AI’s behavior from the very first message, without touching every follow‑up.

![License](https://img.shields.io/badge/license-MIT-blue)
![Platform](https://img.shields.io/badge/platform-Tampermonkey%20%7C%20Violentmonkey-green)

---

## ✨ Features

- 🎯 **Session‑aware injection** – Injects only once per new chat session; never modifies later turns in the same conversation.
- ✏️ **Full prompt management** – Add, edit, delete, and select prompts directly from a clean UI panel.
- 🔀 **Flexible activation** – Pick one active prompt from your list, or disable injection entirely with one click.
- 🧩 **Template support** – Use `{{prompt}}` as a placeholder for your actual input, giving you total control over the final prompt.
- 🎨 **Light‑theme panel** – A floating button (`💬`) opens a sleek white panel that blends with DeepSeek’s interface.
- 💾 **Persistent local storage** – All prompts are saved via `GM_setValue` and survive page reloads.
- 🛡️ **Minimal permissions** – Only uses Tampermonkey’s storage and style APIs; no cross‑origin requests.

---

## 📦 Installation

1. Install a userscript manager extension for your browser:
   - [Tampermonkey](https://www.tampermonkey.net/) (recommended)
   - [Violentmonkey](https://violentmonkey.github.io/)
2. Install the script using one of these methods:
   - **Directly from Greasy Fork** *(link coming soon)*
   - **Manual install**:
     - Open your userscript manager’s dashboard.
     - Click the **“+”** (new script) button.
     - Copy the entire content of [`script.js`](./script.js) and paste it into the editor.
     - Save (`Ctrl+S`). The script will activate on `https://chat.deepseek.com/*`.

---

## 🧠 How to Use

### Opening the Panel
While on the DeepSeek Chat page, click the **floating speech‑bubble button 💬** in the top‑right corner to open the prompt manager.

### Managing Your Prompts
- **➕ Add a prompt** – Click `+ Add new prompt`. It appears in the list and automatically opens in edit mode.
- **✏️ Edit** – Click the pencil icon on any prompt, change the name or text in the inline form, then press **Save**.
- **🗑️ Delete** – Click the trash icon and confirm. The prompt is permanently removed.
- **✅ Select** – Click anywhere on a prompt row (or its radio button) to make it the active one. A blue highlight indicates the active prompt.
- **🚫 Disable injection** – Choose the `🚫 No prompt (send as is)` option at the top. No prompt will be injected.

### Using the `{{prompt}}` Placeholder
In your custom prompt text, insert `{{prompt}}` wherever you want the original user message to appear.  
**Example**:

<img width="382" height="476" alt="image" src="https://github.com/user-attachments/assets/c378db68-23fe-4230-8684-e07ee0245e71" />

