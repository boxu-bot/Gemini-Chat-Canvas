// ==========================================================================
// Gemini 对画画布 (Gemini Chat Canvas) - 核心内容脚本
// ==========================================================================

// 暂存架状态管理
let savedSnippets = [];
let activeDiscussionItem = null;

// 1. 健壮查找 Gemini 原生输入框
function findGeminiInput() {
  // 匹配 contenteditable 元素 (Gemini 目前主要输入框类型)
  let editor = document.querySelector('div[contenteditable="true"][role="textbox"]');
  if (editor) return editor;
  
  // 匹配 g-textarea 容器内部的 textarea 或 editor
  let textarea = document.querySelector('g-textarea textarea, g-textarea div[contenteditable="true"]');
  if (textarea) return textarea;
  
  // 匹配通用 textarea 元素
  textarea = document.querySelector('textarea.textarea, textarea[placeholder*="Prompt"], textarea[placeholder*="提示"], textarea');
  if (textarea) return textarea;
  
  return null;
}

// 2. 健壮查找 Gemini 原生发送按钮
function findGeminiSendButton() {
  // 匹配含有发送/Send 相关 aria-label 的按钮
  let btn = document.querySelector('button[aria-label*="Send"], button[aria-label*="发送"], button[aria-label*="Submit"]');
  if (btn) return btn;
  
  // 匹配类名中含 send/Send 的按钮
  btn = document.querySelector('button[class*="send"], button[class*="Send"]');
  if (btn) return btn;
  
  // 匹配输入框附近容器中的 button 元素
  const input = findGeminiInput();
  if (input) {
    const parent = input.closest('form, div[class*="container"], div[class*="area"], div[class*="input"]');
    if (parent) {
      const buttons = parent.querySelectorAll('button');
      if (buttons.length > 0) {
        // 优先寻找带有 SVG 图标的按钮，或者无文本的图标按钮
        for (let b of buttons) {
          if (b.querySelector('svg') || b.textContent.trim() === '') {
            return b;
          }
        }
        // 兜底返回最后一个按钮
        return buttons[buttons.length - 1];
      }
    }
  }
  return null;
}

// 3. 强力向输入框填充内容并派发事件
function setGeminiInputText(text) {
  const input = findGeminiInput();
  if (!input) {
    showToast("❌ 未找到 Gemini 原生输入框，填充失败！");
    return false;
  }
  
  input.focus();
  
  if (input.tagName === 'TEXTAREA' || input.tagName === 'INPUT') {
    input.value = text;
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  } else {
    // 适配 contenteditable 富文本编辑器
    input.innerHTML = '';
    const p = document.createElement('p');
    p.textContent = text;
    input.appendChild(p);
    
    // 派发 input 事件激活前端框架监听
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    
    // 派发 Composition 事件强化反应性
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.dispatchEvent(new CompositionEvent('compositionend', { data: text, bubbles: true }));
  }
  
  // 派发键盘事件辅助激活
  const keyEvent = new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key: ' ',
    char: ' ',
    shiftKey: false
  });
  input.dispatchEvent(keyEvent);
  
  input.focus();
  return true;
}

// 4. 模拟点击发送按钮
function clickGeminiSend() {
  const btn = findGeminiSendButton();
  if (!btn) {
    showToast("❌ 未找到发送按钮，请手动点击发送！");
    return false;
  }
  btn.click();
  return true;
}

// 5. 全局 Toast 提示函数
function showToast(message) {
  let toast = document.getElementById('gcc-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'gcc-toast';
    toast.className = 'gcc-toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  
  setTimeout(() => {
    toast.classList.remove('show');
  }, 2500);
}

// 6. 初始化侧边栏 DOM 及注册事件
function initSidebar() {
  if (document.getElementById('gcc-sidebar')) return;
  
  // A. 创建悬浮折叠把手
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'gcc-toggle-btn';
  toggleBtn.innerHTML = '🎨';
  toggleBtn.title = '打开 Gemini 对话画布';
  toggleBtn.addEventListener('click', toggleSidebar);
  document.body.appendChild(toggleBtn);
  
  // B. 创建侧边栏主体容器
  const sidebar = document.createElement('div');
  sidebar.id = 'gcc-sidebar';
  sidebar.className = 'collapsed';
  
  sidebar.innerHTML = `
    <div class="gcc-header">
      <div class="gcc-title-row">
        <h3 class="gcc-title">🎨 Gemini 对话画布</h3>
        <button class="gcc-close-btn" id="gcc-close-btn">✕</button>
      </div>
      <div class="gcc-tools">
        <button class="gcc-btn gcc-btn-secondary" id="gcc-export-btn">📥 导出原始片段</button>
        <button class="gcc-btn gcc-btn-primary" id="gcc-optimize-btn">✨ 智能聚合优化</button>
      </div>
    </div>
    
    <div class="gcc-shelf" id="gcc-shelf">
      <div class="gcc-shelf-empty">
        <span>📌</span>
        暂无留存片段<br>在网页列表中悬浮并点击“留存”添加
      </div>
    </div>
    
    <div class="gcc-thread">
      <div class="gcc-thread-header">💬 局部讨论区</div>
      <div class="gcc-thread-context" id="gcc-thread-context">请选择步骤发起讨论...</div>
      <div class="gcc-input-container">
        <textarea class="gcc-input" id="gcc-thread-input" placeholder="输入你想追问或调整的意见，回车快速发送..." disabled></textarea>
        <button class="gcc-input-btn" id="gcc-thread-send-btn" disabled>发送给 AI</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(sidebar);
  
  // C. 绑定基础事件监听器
  document.getElementById('gcc-close-btn').addEventListener('click', closeSidebar);
  document.getElementById('gcc-export-btn').addEventListener('click', exportSnippets);
  document.getElementById('gcc-optimize-btn').addEventListener('click', optimizeAggregated);
  
  const threadInput = document.getElementById('gcc-thread-input');
  const threadSendBtn = document.getElementById('gcc-thread-send-btn');
  
  // D. 绑定局部讨论发送逻辑 (功能 1)
  const sendDiscussion = () => {
    const text = threadInput.value.trim();
    if (!text || !activeDiscussionItem) return;
    
    const prompt = `针对你刚才提到的‘${activeDiscussionItem}’，我有以下疑问：${text}`;
    if (setGeminiInputText(prompt)) {
      threadInput.value = '';
      showToast("🚀 讨论指令已载入并自动发送！");
      clickGeminiSend();
      
      // 发送后，平滑滚动视口到底部以便观察最新回复
      setTimeout(() => {
        window.scrollTo({
          top: document.body.scrollHeight,
          behavior: 'smooth'
        });
      }, 350);
    }
  };
  
  threadSendBtn.addEventListener('click', sendDiscussion);
  threadInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendDiscussion();
    }
  });
}

// 侧边栏开启/关闭/折叠切换
function toggleSidebar() {
  const sidebar = document.getElementById('gcc-sidebar');
  if (sidebar) {
    const isCollapsed = sidebar.classList.toggle('collapsed');
    document.body.classList.toggle('gcc-sidebar-active', !isCollapsed);
  }
}

function closeSidebar() {
  const sidebar = document.getElementById('gcc-sidebar');
  if (sidebar) {
    sidebar.classList.add('collapsed');
    document.body.classList.remove('gcc-sidebar-active');
  }
}

function openSidebar() {
  const sidebar = document.getElementById('gcc-sidebar');
  if (sidebar) {
    sidebar.classList.remove('collapsed');
    document.body.classList.add('gcc-sidebar-active');
  }
}

// 7. 注入 Hover 挂件到列表条目
function injectWidgetToLi(li) {
  // 检查是否已经注入过挂件，规避重复操作
  if (li.querySelector('.gcc-hover-widget') || li.classList.contains('gcc-li-relative')) return;
  
  li.classList.add('gcc-li-relative');
  
  const widget = document.createElement('div');
  widget.className = 'gcc-hover-widget';
  
  widget.innerHTML = `
    <button class="gcc-widget-btn gcc-btn-retain" title="留存当前步骤至侧边栏暂存架">📌 留存步骤</button>
    <button class="gcc-widget-btn gcc-btn-discuss" title="针对当前步骤发起追问或调整">💬 讨论步骤</button>
    <button class="gcc-widget-btn gcc-btn-hide" title="隐藏当前步骤，清理无用噪音">❌ 隐藏步骤</button>
  `;
  
  li.appendChild(widget);
  
  // 捕获干净的文本内容，移除按钮文本干扰
  const getCleanText = () => {
    let clonedLi = li.cloneNode(true);
    const widgetInClone = clonedLi.querySelector('.gcc-hover-widget');
    if (widgetInClone) widgetInClone.remove();
    return clonedLi.textContent.trim();
  };
  
  // 绑定挂件按钮动作事件
  widget.querySelector('.gcc-btn-retain').addEventListener('click', (e) => {
    e.stopPropagation();
    retainSnippet(getCleanText());
  });
  
  widget.querySelector('.gcc-btn-discuss').addEventListener('click', (e) => {
    e.stopPropagation();
    startDiscussion(getCleanText());
  });
  
  widget.querySelector('.gcc-btn-hide').addEventListener('click', (e) => {
    e.stopPropagation();
    hideLiElement(li);
  });
}

// 功能 3：平滑隐藏列表项 DOM 节点
function hideLiElement(li) {
  li.classList.add('gcc-li-hiding');
  setTimeout(() => {
    li.style.display = 'none';
    showToast("👁️ 该步骤已暂时平滑隐藏");
  }, 300);
}

// 功能 1：激活下半区局部讨论输入框
function startDiscussion(content) {
  activeDiscussionItem = content;
  openSidebar();
  
  const contextEl = document.getElementById('gcc-thread-context');
  const threadInput = document.getElementById('gcc-thread-input');
  const threadSendBtn = document.getElementById('gcc-thread-send-btn');
  
  contextEl.textContent = `选中步骤: "${content}"`;
  threadInput.disabled = false;
  threadSendBtn.disabled = false;
  threadInput.placeholder = "输入你想微调或质询的问题，回车发送...";
  threadInput.focus();
}

// 功能 2：留存到“黄金资产暂存架”
function retainSnippet(content) {
  if (savedSnippets.includes(content)) {
    showToast("⚠️ 该片段已经在暂存架中！");
    return;
  }
  
  savedSnippets.push(content);
  renderShelf();
  openSidebar();
  showToast("📌 已成功留存至黄金暂存架！");
}

// 移除留存片段
function removeSnippet(index) {
  savedSnippets.splice(index, 1);
  renderShelf();
  showToast("🗑️ 片段已移出暂存架");
}

// 功能 4：信息回流 (🔄 发送给AI 按钮功能)
function sendBackToAI(content) {
  const text = `【上下文参考】投喂之前留存的信息：\n"${content}"`;
  if (setGeminiInputText(text)) {
    showToast("🔄 留存片段已成功投喂至输入框！");
  }
}

// 渲染黄金暂存架列表
function renderShelf() {
  const shelf = document.getElementById('gcc-shelf');
  if (!shelf) return;
  
  if (savedSnippets.length === 0) {
    shelf.innerHTML = `
      <div class="gcc-shelf-empty">
        <span>📌</span>
        暂无留存片段<br>在网页列表中悬浮并点击“留存”添加
      </div>
    `;
    return;
  }
  
  shelf.innerHTML = '';
  savedSnippets.forEach((snippet, index) => {
    const card = document.createElement('div');
    card.className = 'gcc-card';
    card.innerHTML = `
      <div class="gcc-card-text">${escapeHtml(snippet)}</div>
      <div class="gcc-card-actions">
        <button class="gcc-card-btn gcc-card-back" data-idx="${index}">🔄 发送给AI</button>
        <button class="gcc-card-btn gcc-card-del" data-idx="${index}">🗑️ 移除</button>
      </div>
    `;
    shelf.appendChild(card);
  });
  
  // 动态注册卡片内操作按钮事件
  shelf.querySelectorAll('.gcc-card-back').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.getAttribute('data-idx'));
      sendBackToAI(savedSnippets[idx]);
    });
  });
  
  shelf.querySelectorAll('.gcc-card-del').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const idx = parseInt(btn.getAttribute('data-idx'));
      removeSnippet(idx);
    });
  });
}

// HTML 安全字符转义，预防 XSS
function escapeHtml(text) {
  const map = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  };
  return text.replace(/[&<>"']/g, function(m) { return map[m]; });
}

// 功能 5：📥 导出原始片段并复制到剪贴板
function exportSnippets() {
  if (savedSnippets.length === 0) {
    showToast("⚠️ 当前暂存架为空，无可导出的片段！");
    return;
  }
  
  let text = "### 留存的 Gemini 关键步骤片段\n\n";
  savedSnippets.forEach((snippet, i) => {
    text += `${i + 1}. ${snippet}\n\n`;
  });
  
  navigator.clipboard.writeText(text).then(() => {
    showToast("📥 已成功导出并复制至剪贴板！");
  }).catch(err => {
    showToast("❌ 剪贴板复制失败：" + err);
  });
}

// 功能 6：✨ 智能聚合优化
function optimizeAggregated() {
  if (savedSnippets.length === 0) {
    showToast("⚠️ 暂存架中没有素材，无法进行聚合！");
    return;
  }
  
  let materialText = "";
  savedSnippets.forEach((snippet, i) => {
    materialText += `[素材 ${i + 1}]：${snippet}\n`;
  });
  
  const prompt = `请将以下我筛选出的碎片信息进行完整的聚合、去重、逻辑梳理和语言优化，为我生成一篇结构严谨、质量极高的最终整合文档。以下是素材：\n${materialText}`;
  
  if (setGeminiInputText(prompt)) {
    showToast("✨ 聚合指令已装载并自动发送！");
    clickGeminiSend();
    
    // 平滑滚动视口到底部观察响应
    setTimeout(() => {
      window.scrollTo({
        top: document.body.scrollHeight,
        behavior: 'smooth'
      });
    }, 350);
  }
}

// 8. 实时扫描并注入 Hover 按钮挂件
function scanAndInject() {
  // 极度强健的匹配规则：抓取页面上所有的 ol li 和 ul li 元素
  const listItems = document.querySelectorAll('ol li, ul li');
  
  listItems.forEach(li => {
    // 1. 规避侧边栏自带的暂存架卡片列表
    if (li.closest('#gcc-sidebar')) return;
    
    // 2. 规避原站的左侧导航抽屉（避免在侧边导航菜单注入挂件）
    if (li.closest('nav, aside, [class*="navigation"], [class*="sidebar"], [class*="drawer"]')) return;
    
    // 3. 过滤太短的内容节点，并进行挂件注入
    if (li.textContent.trim().length > 1) {
      injectWidgetToLi(li);
    }
  });
}

// 9. 开启 DOM 实时 MutationObserver 监测与周期扫描双保险
function startObserver() {
  // 初始化侧边栏和 Toast 节点
  initSidebar();
  scanAndInject();
  
  // 双保险机制 1：实时 DOM 变化监听（全面监听添加节点与文本更改）
  const observer = new MutationObserver((mutations) => {
    let shouldScan = false;
    for (let mutation of mutations) {
      if (mutation.addedNodes.length > 0 || mutation.type === 'characterData') {
        shouldScan = true;
        break;
      }
    }
    if (shouldScan) {
      scanAndInject();
    }
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  
  // 双保险机制 2：周期性定时器自动兜底扫描（应对 SPA 路由无刷跳转及各种极端渲染延迟）
  setInterval(scanAndInject, 1000);
}

// 安全启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver);
} else {
  startObserver();
}
