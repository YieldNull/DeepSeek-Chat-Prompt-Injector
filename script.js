// ==UserScript==
// @name         DeepSeek Prompt Injector
// @namespace    https://github.com/YieldNull/DeepSeek-Chat-Prompt-Injector
// @version      1.0.0
// @description  在 DeepSeek 新对话的第一次请求中注入自定义提示词，支持增删改及选择提示词
// @author       You
// @match        https://chat.deepseek.com/*
// @run-at       document-start
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    // ==================== 调试开关 ====================
    const DEBUG = false;
    function log(...args) {
        if (DEBUG) console.log('[DS Prompt Injector]', ...args);
    }

    // ==================== 常量 ====================
    const API_PATH = '/api/v0/chat/completion';
    const SESSION_STORAGE_KEY = '__ds_prompt_injector_sessions__';
    const MAX_SESSION_CACHE = 300;

    // ==================== 存储层 (GM_setValue/GM_getValue) ====================
    function loadPrompts() {
        try {
            const raw = GM_getValue('prompts', null);
            if (raw) return JSON.parse(raw);
        } catch (e) {
            log('加载提示词失败', e);
        }
        // 默认预设一个示例提示词
        const defaultPrompt = {
            id: 'default_' + Date.now(),
            name: '示例提示词',
            text: '请用中文回答，保持专业且详细的风格。',
            createdAt: Date.now()
        };
        const list = [defaultPrompt];
        savePrompts(list);
        return list;
    }

    function savePrompts(prompts) {
        try {
            GM_setValue('prompts', JSON.stringify(prompts));
        } catch (e) {
            log('保存提示词失败', e);
        }
    }

    function loadSelectedPromptId() {
        try {
            return GM_getValue('selectedPromptId', null);
        } catch (e) {
            return null;
        }
    }

    function saveSelectedPromptId(id) {
        try {
            GM_setValue('selectedPromptId', id);
        } catch (e) {
            log('保存选中状态失败', e);
        }
    }

    // ==================== Session 追踪 (sessionStorage) ====================
    function getInjectedSessions() {
        try {
            const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
            if (raw) return JSON.parse(raw);
        } catch (e) {
            log('读取session记录失败', e);
        }
        return [];
    }

    function markSessionInjected(sessionId) {
        try {
            let sessions = getInjectedSessions();
            sessions.push(sessionId);
            // 限制大小
            if (sessions.length > MAX_SESSION_CACHE) {
                sessions = sessions.slice(-MAX_SESSION_CACHE);
            }
            sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(sessions));
        } catch (e) {
            log('记录session失败', e);
        }
    }

    function isSessionInjected(sessionId) {
        const sessions = getInjectedSessions();
        return sessions.includes(sessionId);
    }

    // ==================== 获取当前选中的提示词文本 ====================
    function getActivePromptText() {
        const selectedId = loadSelectedPromptId();
        if (!selectedId) return null;
        const prompts = loadPrompts();
        const selected = prompts.find(p => p.id === selectedId);
        return selected ? selected.text : null;
    }

    // ==================== 注入逻辑：将提示词合并到原始prompt ====================
    function injectPrompt(originalPrompt, customPromptText) {
        if (!customPromptText || !customPromptText.trim()) {
            return originalPrompt;
        }
        if (customPromptText.includes('{{prompt}}')) {
            // 使用模板替换
            return customPromptText.replace(/\{\{prompt\}\}/g, originalPrompt);
        }
        // 默认在前面添加
        return customPromptText + '\n\n' + originalPrompt;
    }

    // ==================== Fetch 拦截 ====================
    const originalFetch = window.fetch;

    window.fetch = function (resource, config) {
        // 解析URL
        let url = '';
        if (typeof resource === 'string') {
            url = resource;
        } else if (resource instanceof Request) {
            url = resource.url;
        } else if (resource && resource.url) {
            url = resource.url;
        }

        // 检查是否为目标API
        if (url && url.includes(API_PATH)) {
            // 获取请求体
            let bodyStr = null;
            let bodySource = null; // 'config' | 'request'

            if (config && typeof config.body === 'string') {
                bodyStr = config.body;
                bodySource = 'config';
            } else if (resource instanceof Request && typeof resource._bodyText === 'string') {
                // 某些情况下Request内部已经有_bodyText
                bodyStr = resource._bodyText;
                bodySource = 'request_internal';
            }

            if (bodyStr) {
                try {
                    const bodyJson = JSON.parse(bodyStr);
                    const sessionId = bodyJson.chat_session_id;

                    if (sessionId && !isSessionInjected(sessionId)) {
                        const customPrompt = getActivePromptText();
                        if (customPrompt && customPrompt.trim()) {
                            const originalPrompt = bodyJson.prompt || '';
                            const newPrompt = injectPrompt(originalPrompt, customPrompt);
                            bodyJson.prompt = newPrompt;
                            const newBodyStr = JSON.stringify(bodyJson);

                            // 更新请求体
                            if (bodySource === 'config' && config) {
                                config.body = newBodyStr;
                            } else if (bodySource === 'request_internal' && resource instanceof Request) {
                                // 需要重新构造Request
                                // 对于Request对象，创建一个新的Request来替换
                                const newRequest = new Request(resource, { body: newBodyStr });
                                // 复制属性
                                Object.defineProperty(newRequest, 'url', { value: resource.url, writable: false });
                                resource = newRequest;
                            }

                            markSessionInjected(sessionId);
                            log('✅ 已注入提示词到 session:', sessionId, '| 原始prompt长度:', originalPrompt.length, '| 新prompt长度:', newPrompt.length);
                        } else {
                            // 没有选中提示词，也标记session（避免后续重复检查）
                            markSessionInjected(sessionId);
                            log('ℹ️ 未选择提示词，跳过注入 session:', sessionId);
                        }
                    }
                } catch (e) {
                    log('⚠️ 解析请求体失败', e);
                }
            }
        }

        // 调用原始fetch
        if (resource instanceof Request && arguments.length === 1) {
            return originalFetch.call(this, resource);
        }
        return originalFetch.call(this, resource, config);
    };

    // ==================== XMLHttpRequest 拦截 (备用) ====================
    const originalXHROpen = XMLHttpRequest.prototype.open;
    const originalXHRSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url, ...rest) {
        this.__ds_injector_url = url;
        return originalXHROpen.call(this, method, url, ...rest);
    };

    XMLHttpRequest.prototype.send = function (body) {
        const url = this.__ds_injector_url || '';
        if (url && url.includes(API_PATH) && typeof body === 'string') {
            try {
                const bodyJson = JSON.parse(body);
                const sessionId = bodyJson.chat_session_id;

                if (sessionId && !isSessionInjected(sessionId)) {
                    const customPrompt = getActivePromptText();
                    if (customPrompt && customPrompt.trim()) {
                        const originalPrompt = bodyJson.prompt || '';
                        const newPrompt = injectPrompt(originalPrompt, customPrompt);
                        bodyJson.prompt = newPrompt;
                        body = JSON.stringify(bodyJson);
                        markSessionInjected(sessionId);
                        log('✅ [XHR] 已注入提示词到 session:', sessionId);
                    } else {
                        markSessionInjected(sessionId);
                        log('ℹ️ [XHR] 未选择提示词，跳过注入 session:', sessionId);
                    }
                }
            } catch (e) {
                log('⚠️ [XHR] 解析请求体失败', e);
            }
        }
        return originalXHRSend.call(this, body);
    };

    // ==================== UI 面板 ====================
    function createPanel() {
        // 注入样式
        GM_addStyle(`
#ds-prompt-injector-root {
    position: fixed;
    z-index: 99999;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
    font-size: 14px;
    line-height: 1.5;
}
#ds-prompt-injector-root * {
    box-sizing: border-box;
}
.ds-injector-toggle-btn {
    width: 44px;
    height: 44px;
    border-radius: 50%;
    border: 1.5px solid #d1d5db;
    background: #ffffff;
    color: #374151;
    cursor: pointer;
    font-size: 20px;
    display: flex;
    align-items: center;
    justify-content: center;
    box-shadow: 0 4px 16px rgba(0,0,0,0.06);
    transition: all 0.25s ease;
    position: relative;
    user-select: none;
}
.ds-injector-toggle-btn:hover {
    background: #f3f4f6;
    border-color: #4a6cf7;
    box-shadow: 0 6px 24px rgba(74,108,247,0.15);
    transform: scale(1.05);
}
.ds-injector-toggle-btn.active {
    background: #4a6cf7;
    border-color: #4a6cf7;
    color: #ffffff;
    box-shadow: 0 6px 28px rgba(74,108,247,0.45);
}
.ds-injector-toggle-btn .badge {
    position: absolute;
    top: -4px;
    right: -4px;
    width: 12px;
    height: 12px;
    background: #4ade80;
    border-radius: 50%;
    border: 2px solid #ffffff;
    display: none;
}
.ds-injector-toggle-btn.has-active .badge {
    display: block;
}
.ds-injector-panel {
    position: absolute;
    top: 52px;
    right: 0;
    width: 370px;
    max-height: 70vh;
    background: #ffffff;
    border: 1.5px solid #e5e7eb;
    border-radius: 16px;
    box-shadow: 0 16px 48px rgba(0,0,0,0.08);
    overflow: hidden;
    display: flex;
    flex-direction: column;
    animation: ds-panel-in 0.22s ease-out;
}
@keyframes ds-panel-in {
    from { opacity: 0; transform: translateY(-12px) scale(0.96); }
    to { opacity: 1; transform: translateY(0) scale(1); }
}
.ds-injector-panel-header {
    padding: 16px 18px 12px;
    border-bottom: 1px solid #f0f0f0;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-shrink: 0;
}
.ds-injector-panel-header h3 {
    margin: 0;
    font-size: 15px;
    font-weight: 600;
    color: #1f2937;
    letter-spacing: 0.3px;
}
.ds-injector-panel-close {
    width: 30px;
    height: 30px;
    border-radius: 8px;
    border: none;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    font-size: 18px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
}
.ds-injector-panel-close:hover {
    background: #f3f4f6;
    color: #111827;
}
.ds-injector-panel-body {
    padding: 10px 14px;
    overflow-y: auto;
    flex: 1;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ds-injector-no-prompt-option {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 12px;
    border-radius: 10px;
    cursor: pointer;
    background: #f9fafb;
    border: 1.5px solid transparent;
    transition: all 0.18s;
    color: #4b5563;
    font-size: 13px;
}
.ds-injector-no-prompt-option:hover {
    background: #f3f4f6;
    border-color: #d1d5db;
}
.ds-injector-no-prompt-option.selected {
    border-color: #f59e0b;
    background: #fffbeb;
    color: #b45309;
}
.ds-injector-no-prompt-option input[type="radio"] {
    accent-color: #f59e0b;
    width: 18px;
    height: 18px;
    cursor: pointer;
    flex-shrink: 0;
}
.ds-injector-prompt-item {
    background: #f9fafb;
    border: 1.5px solid transparent;
    border-radius: 10px;
    padding: 10px 12px;
    cursor: pointer;
    transition: all 0.18s;
    position: relative;
}
.ds-injector-prompt-item:hover {
    background: #f3f4f6;
    border-color: #d1d5db;
}
.ds-injector-prompt-item.selected {
    border-color: #4a6cf7;
    background: #eff6ff;
    box-shadow: 0 0 0 3px rgba(74,108,247,0.1);
}
.ds-injector-prompt-item-row {
    display: flex;
    align-items: center;
    gap: 10px;
}
.ds-injector-prompt-item-row input[type="radio"] {
    accent-color: #4a6cf7;
    width: 18px;
    height: 18px;
    cursor: pointer;
    flex-shrink: 0;
}
.ds-injector-prompt-name {
    flex: 1;
    font-weight: 500;
    color: #1f2937;
    font-size: 13px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
}
.ds-injector-prompt-preview {
    font-size: 11px;
    color: #6b7280;
    margin-top: 4px;
    margin-left: 28px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    max-width: 280px;
}
.ds-injector-item-actions {
    display: flex;
    gap: 4px;
    flex-shrink: 0;
}
.ds-injector-btn-sm {
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: 1px solid #d1d5db;
    background: #ffffff;
    color: #4b5563;
    cursor: pointer;
    font-size: 13px;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s;
}
.ds-injector-btn-sm:hover {
    background: #f3f4f6;
    color: #111827;
}
.ds-injector-btn-sm.danger:hover {
    background: #fee2e2;
    border-color: #ef4444;
    color: #b91c1c;
}
.ds-injector-edit-area {
    margin-top: 8px;
    display: flex;
    flex-direction: column;
    gap: 8px;
}
.ds-injector-edit-area input,
.ds-injector-edit-area textarea {
    width: 100%;
    padding: 10px 12px;
    border-radius: 8px;
    border: 1.5px solid #d1d5db;
    background: #ffffff;
    color: #1f2937;
    font-size: 13px;
    font-family: inherit;
    resize: vertical;
    transition: border-color 0.15s;
}
.ds-injector-edit-area input:focus,
.ds-injector-edit-area textarea:focus {
    outline: none;
    border-color: #4a6cf7;
    box-shadow: 0 0 0 3px rgba(74,108,247,0.1);
}
.ds-injector-edit-area textarea {
    min-height: 80px;
}
.ds-injector-edit-buttons {
    display: flex;
    gap: 8px;
    justify-content: flex-end;
}
.ds-injector-btn {
    padding: 7px 16px;
    border-radius: 8px;
    border: 1.5px solid #d1d5db;
    cursor: pointer;
    font-size: 12px;
    font-weight: 500;
    transition: all 0.15s;
    background: #ffffff;
    color: #374151;
    font-family: inherit;
}
.ds-injector-btn:hover {
    background: #f3f4f6;
    color: #111827;
}
.ds-injector-btn.primary {
    background: #4a6cf7;
    border-color: #4a6cf7;
    color: #ffffff;
}
.ds-injector-btn.primary:hover {
    background: #3b5de7;
    border-color: #3b5de7;
}
.ds-injector-btn.danger {
    background: transparent;
    border-color: #ef4444;
    color: #ef4444;
}
.ds-injector-btn.danger:hover {
    background: #fee2e2;
}
.ds-injector-add-btn {
    width: 100%;
    padding: 10px;
    border-radius: 10px;
    border: 1.5px dashed #d1d5db;
    background: transparent;
    color: #6b7280;
    cursor: pointer;
    font-size: 13px;
    font-family: inherit;
    transition: all 0.18s;
    margin-top: 4px;
}
.ds-injector-add-btn:hover {
    border-color: #4a6cf7;
    color: #4a6cf7;
    background: #eff6ff;
}
.ds-injector-footer {
    padding: 8px 14px;
    border-top: 1px solid #f0f0f0;
    font-size: 11px;
    color: #9ca3af;
    text-align: center;
    flex-shrink: 0;
}
.ds-injector-empty {
    text-align: center;
    color: #9ca3af;
    padding: 20px;
    font-size: 13px;
}
        `);

        // 创建DOM结构
        const root = document.createElement('div');
        root.id = 'ds-prompt-injector-root';
        root.style.cssText = 'right: 20px; top: 80px;';
        document.body.appendChild(root);

        // 切换按钮
        const toggleBtn = document.createElement('button');
        toggleBtn.className = 'ds-injector-toggle-btn';
        toggleBtn.innerHTML = '💬<span class="badge"></span>';
        toggleBtn.title = '管理提示词注入';
        root.appendChild(toggleBtn);

        // 面板容器
        let panelEl = null;
        let panelVisible = false;
        let editingPromptId = null; // 当前正在编辑的提示词ID，null表示不在编辑

        function updateToggleBadge() {
            const selectedId = loadSelectedPromptId();
            if (selectedId) {
                toggleBtn.classList.add('has-active');
            } else {
                toggleBtn.classList.remove('has-active');
            }
        }

        function refreshPanelContent() {
            if (!panelEl) return;
            const body = panelEl.querySelector('.ds-injector-panel-body');
            if (!body) return;
            body.innerHTML = '';
            buildPanelBody(body);
            updateToggleBadge();
        }

        function buildPanelBody(bodyEl) {
            const prompts = loadPrompts();
            const selectedId = loadSelectedPromptId();

            // "不使用提示词"选项
            const noPromptDiv = document.createElement('div');
            noPromptDiv.className = 'ds-injector-no-prompt-option' + (selectedId === null ? ' selected' : '');
            noPromptDiv.innerHTML = `
                <input type="radio" name="ds-prompt-select" value="" ${selectedId === null ? 'checked' : ''}>
                <span>🚫 不使用提示词（直接发送）</span>
            `;
            noPromptDiv.addEventListener('click', (e) => {
                if (e.target.tagName === 'INPUT') return;
                const radio = noPromptDiv.querySelector('input');
                radio.checked = true;
                saveSelectedPromptId(null);
                refreshPanelContent();
                log('已取消选择提示词');
            });
            noPromptDiv.querySelector('input').addEventListener('change', () => {
                saveSelectedPromptId(null);
                refreshPanelContent();
                log('已取消选择提示词');
            });
            bodyEl.appendChild(noPromptDiv);

            // 分隔线
            if (prompts.length > 0) {
                const sep = document.createElement('div');
                sep.style.cssText = 'border-top:1px solid #2a2a42;margin:4px 0;';
                bodyEl.appendChild(sep);
            }

            // 提示词列表
            if (prompts.length === 0) {
                const emptyDiv = document.createElement('div');
                emptyDiv.className = 'ds-injector-empty';
                emptyDiv.textContent = '还没有提示词，点击下方按钮添加';
                bodyEl.appendChild(emptyDiv);
            } else {
                prompts.forEach(prompt => {
                    const isSelected = prompt.id === selectedId;
                    const isEditing = prompt.id === editingPromptId;

                    const itemDiv = document.createElement('div');
                    itemDiv.className = 'ds-injector-prompt-item' + (isSelected ? ' selected' : '');

                    if (!isEditing) {
                        // 正常显示模式
                        itemDiv.innerHTML = `
                            <div class="ds-injector-prompt-item-row">
                                <input type="radio" name="ds-prompt-select" value="${prompt.id}" ${isSelected ? 'checked' : ''}>
                                <span class="ds-injector-prompt-name">${escapeHtml(prompt.name)}</span>
                                <div class="ds-injector-item-actions">
                                    <button class="ds-injector-btn-sm edit-btn" title="编辑">✏️</button>
                                    <button class="ds-injector-btn-sm danger delete-btn" title="删除">🗑️</button>
                                </div>
                            </div>
                            <div class="ds-injector-prompt-preview">${escapeHtml(prompt.text.substring(0, 60))}${prompt.text.length > 60 ? '...' : ''}</div>
                        `;

                        // 点击整行选择
                        itemDiv.addEventListener('click', (e) => {
                            if (e.target.closest('.edit-btn') || e.target.closest('.delete-btn') || e.target.tagName === 'INPUT') return;
                            const radio = itemDiv.querySelector('input');
                            radio.checked = true;
                            saveSelectedPromptId(prompt.id);
                            refreshPanelContent();
                            log('已选择提示词:', prompt.name);
                        });

                        // radio change
                        itemDiv.querySelector('input').addEventListener('change', () => {
                            saveSelectedPromptId(prompt.id);
                            refreshPanelContent();
                            log('已选择提示词:', prompt.name);
                        });

                        // 编辑按钮
                        itemDiv.querySelector('.edit-btn').addEventListener('click', (e) => {
                            e.stopPropagation();
                            editingPromptId = prompt.id;
                            refreshPanelContent();
                        });

                        // 删除按钮
                        itemDiv.querySelector('.delete-btn').addEventListener('click', (e) => {
                            e.stopPropagation();
                            if (confirm(`确定要删除提示词「${prompt.name}」吗？此操作不可撤销。`)) {
                                const promptsList = loadPrompts();
                                const updated = promptsList.filter(p => p.id !== prompt.id);
                                savePrompts(updated);
                                if (loadSelectedPromptId() === prompt.id) {
                                    saveSelectedPromptId(null);
                                }
                                if (editingPromptId === prompt.id) {
                                    editingPromptId = null;
                                }
                                refreshPanelContent();
                                log('已删除提示词:', prompt.name);
                            }
                        });
                    } else {
                        // 编辑模式
                        itemDiv.innerHTML = `
                            <div class="ds-injector-edit-area">
                                <input type="text" class="edit-name-input" value="${escapeHtml(prompt.name)}" placeholder="提示词名称">
                                <textarea class="edit-text-input" placeholder="提示词内容（可使用 {{prompt}} 作为用户输入的占位符）">${escapeHtml(prompt.text)}</textarea>
                                <div class="ds-injector-edit-buttons">
                                    <button class="ds-injector-btn cancel-edit-btn">取消</button>
                                    <button class="ds-injector-btn primary save-edit-btn">保存</button>
                                </div>
                            </div>
                        `;

                        const nameInput = itemDiv.querySelector('.edit-name-input');
                        const textInput = itemDiv.querySelector('.edit-text-input');

                        // 取消
                        itemDiv.querySelector('.cancel-edit-btn').addEventListener('click', (e) => {
                            e.stopPropagation();
                            editingPromptId = null;
                            refreshPanelContent();
                        });

                        // 保存
                        itemDiv.querySelector('.save-edit-btn').addEventListener('click', (e) => {
                            e.stopPropagation();
                            const newName = nameInput.value.trim();
                            const newText = textInput.value;
                            if (!newName) {
                                alert('提示词名称不能为空');
                                return;
                            }
                            const promptsList = loadPrompts();
                            const idx = promptsList.findIndex(p => p.id === prompt.id);
                            if (idx >= 0) {
                                promptsList[idx].name = newName;
                                promptsList[idx].text = newText;
                                savePrompts(promptsList);
                            }
                            editingPromptId = null;
                            refreshPanelContent();
                            log('已更新提示词:', newName);
                        });

                        // 阻止点击事件冒泡
                        itemDiv.addEventListener('click', (e) => {
                            e.stopPropagation();
                        });
                    }

                    bodyEl.appendChild(itemDiv);
                });
            }

            // 添加按钮
            const addBtn = document.createElement('button');
            addBtn.className = 'ds-injector-add-btn';
            addBtn.textContent = '+ 添加新提示词';
            addBtn.addEventListener('click', () => {
                const newPrompt = {
                    id: 'prompt_' + Date.now() + '_' + Math.random().toString(36).substr(2, 6),
                    name: '新提示词',
                    text: '请用中文回答，保持专业详细。\n\n{{prompt}}',
                    createdAt: Date.now()
                };
                const promptsList = loadPrompts();
                promptsList.push(newPrompt);
                savePrompts(promptsList);
                editingPromptId = newPrompt.id; // 自动进入编辑模式
                refreshPanelContent();
                log('已创建新提示词');
            });
            bodyEl.appendChild(addBtn);

            // 提示信息
            if (editingPromptId) {
                const hint = document.createElement('div');
                hint.style.cssText = 'font-size:11px;color:#888;margin-top:4px;text-align:center;';
                hint.textContent = '💡 提示词中可使用 {{prompt}} 代表用户原始输入';
                bodyEl.appendChild(hint);
            }
        }

        function escapeHtml(str) {
            const div = document.createElement('div');
            div.textContent = str;
            return div.innerHTML;
        }

        function showPanel() {
            if (panelEl) {
                panelEl.style.display = 'flex';
                panelVisible = true;
                toggleBtn.classList.add('active');
                refreshPanelContent();
                return;
            }

            panelEl = document.createElement('div');
            panelEl.className = 'ds-injector-panel';

            // Header
            const header = document.createElement('div');
            header.className = 'ds-injector-panel-header';
            header.innerHTML = '<h3>📝 提示词管理</h3>';
            const closeBtn = document.createElement('button');
            closeBtn.className = 'ds-injector-panel-close';
            closeBtn.textContent = '✕';
            closeBtn.title = '关闭面板';
            closeBtn.addEventListener('click', hidePanel);
            header.appendChild(closeBtn);
            panelEl.appendChild(header);

            // Body
            const body = document.createElement('div');
            body.className = 'ds-injector-panel-body';
            buildPanelBody(body);
            panelEl.appendChild(body);

            // Footer
            const footer = document.createElement('div');
            footer.className = 'ds-injector-footer';
            footer.textContent = '仅在新对话首次请求时注入 · 每个会话只注入一次';
            panelEl.appendChild(footer);

            root.appendChild(panelEl);
            panelVisible = true;
            toggleBtn.classList.add('active');
        }

        function hidePanel() {
            if (panelEl) {
                panelEl.style.display = 'none';
            }
            panelVisible = false;
            toggleBtn.classList.remove('active');
            editingPromptId = null;
        }

        function togglePanel() {
            if (panelVisible) {
                hidePanel();
            } else {
                showPanel();
            }
        }

        toggleBtn.addEventListener('click', togglePanel);

        // 点击面板外部关闭
        document.addEventListener('click', (e) => {
            if (panelVisible && panelEl && !root.contains(e.target)) {
                hidePanel();
            }
        });

        // ESC 关闭
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && panelVisible) {
                hidePanel();
            }
        });

        // 初始状态
        updateToggleBadge();

        log('UI面板已初始化');
    }

    // ==================== 初始化 ====================
    function initUI() {
        // 等待 body 可用
        if (document.body) {
            createPanel();
        } else {
            const observer = new MutationObserver(() => {
                if (document.body) {
                    observer.disconnect();
                    createPanel();
                }
            });
            observer.observe(document.documentElement, { childList: true });
        }
    }

    // DOM准备好后初始化UI
    if (document.readyState === 'loading') {
        window.addEventListener('DOMContentLoaded', initUI);
    } else {
        // 如果脚本加载时DOM已经就绪（比如@run-at document-start但加载较慢）
        if (document.body) {
            initUI();
        } else {
            window.addEventListener('DOMContentLoaded', initUI);
        }
    }

    // 额外保险：load事件后再尝试
    window.addEventListener('load', () => {
        if (!document.getElementById('ds-prompt-injector-root')) {
            initUI();
        }
    });

    log('DeepSeek Prompt Injector 已加载');
})();
