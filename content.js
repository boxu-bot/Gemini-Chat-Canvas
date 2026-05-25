// ==========================================================================
// Gemini 对画画布 (Gemini Chat Canvas) - 核心内容脚本
// ==========================================================================

// 暂存架状态管理
let savedSnippets = [];
let activeDiscussionItem = null;
let activeDiscussionLi = null;
let capturedSelectionText = "";
let isWaitingForDiscussionReply = false;
let initialRepliesCount = 0;
let lastCapturedText = "";
let lastChangeTime = 0;
let hasStartedGenerating = false;
let isScrollLocked = false;
let lockedScrolls = [];

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
  // A. 优先级最高：直接匹配带有特定标签、类名或测试ID的发送按钮
  const selectors = [
    'g-textarea-send-button button',
    'button[aria-label*="Send"]',
    'button[aria-label*="发送"]',
    'button[aria-label*="Submit"]',
    '.send-button',
    'button.send-button',
    'button[class*="send"]',
    'button[class*="Send"]',
    '[data-testid*="send"]',
    '[data-testid*="Send"]'
  ];
  
  for (let sel of selectors) {
    let btn = document.querySelector(sel);
    if (btn) return btn;
  }
  
  // B. 兜底搜索：匹配输入框附近容器中的 button 元素
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
    // 选定并清空 contenteditable 的已有文字，使用 insertHTML 模拟打字输入，完美支持多行换行，强力启用发送键
    try {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand('delete', false);
      
      // 将换行符 \n 替换为 <br> 以免被浏览器 insertText 引擎强行截断，实现完美多行输入
      const htmlContent = text.replace(/\n/g, '<br>');
      document.execCommand('insertHTML', false, htmlContent);
    } catch (e) {
      // 兜底直接修改
      input.innerHTML = '';
      const p = document.createElement('p');
      p.textContent = text;
      input.appendChild(p);
    }
    
    // 派发事件激活前端框架监听，特别加入 InputEvent 以及 beforeinput，强力激活 Angular/React 底层状态数据绑定！
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    try {
      input.dispatchEvent(new InputEvent('beforeinput', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
      input.dispatchEvent(new InputEvent('input', { bubbles: true, cancelable: true, inputType: 'insertText', data: text }));
    } catch (err) {}
  }
  
  input.focus();
  return true;
}

// 4. 模拟点击发送按钮（采用硬件鼠标事件序列 + 键盘回车双保险强力激活）
function clickGeminiSend() {
  const btn = findGeminiSendButton();
  const input = findGeminiInput();
  
  let success = false;
  
  // A. 优先尝试硬件级鼠标点击发送按钮
  if (btn && !btn.disabled && btn.getAttribute('aria-disabled') !== 'true') {
    btn.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    btn.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
    btn.click();
    success = true;
  }
  
  // B. 双保险：如果按钮没有被成功点击（例如处于置灰态），或者干脆未找到按钮，在输入框内部派发硬件回车事件流
  if (input) {
    input.focus();
    
    const enterDown = new KeyboardEvent('keydown', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      view: window
    });
    
    const enterUp = new KeyboardEvent('keyup', {
      key: 'Enter',
      code: 'Enter',
      keyCode: 13,
      which: 13,
      bubbles: true,
      cancelable: true,
      view: window
    });
    
    input.dispatchEvent(enterDown);
    input.dispatchEvent(enterUp);
    success = true;
  }
  
  if (!success) {
    showToast("❌ 未能触发发送，请手动点击发送！");
  }
  return success;
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

// 变更页面上下文滚动锁定标志位（采用 DOM 属性传导，彻底跨越 MV3 沙箱隔离，零闪烁防抖）
function setPageScrollLock(locked) {
  if (locked) {
    document.documentElement.setAttribute('gcc-scroll-locked', 'true');
  } else {
    document.documentElement.removeAttribute('gcc-scroll-locked');
  }
}

// 5.5 页面视口滚动锁定机制（彻底解决 Gemini 发送提问后主页面被强制滚至底部的痛点）
function lockViewportScroll(li) {
  if (!li) return;
  lockedScrolls = [];
  
  // 记录 window/document 的滚动高度
  lockedScrolls.push({
    element: window,
    top: window.pageYOffset || document.documentElement.scrollTop
  });
  
  // 向上遍历 li 的所有父节点，记录有滚动高度的容器
  let parent = li.parentElement;
  while (parent && parent !== document.body) {
    lockedScrolls.push({
      element: parent,
      top: parent.scrollTop
    });
    parent = parent.parentElement;
  }
  
  isScrollLocked = true;
  setPageScrollLock(true); // 物理强锁原生 API，杜绝一瞬间的位移
  console.log("[Gemini Chat Canvas] Scroll locked at current view.");
}

function performScrollLock() {
  if (!isScrollLocked) return;
  lockedScrolls.forEach(item => {
    if (item.element === window) {
      window.scrollTo(0, item.top);
    } else {
      item.element.scrollTop = item.top;
    }
  });
}

function unlockViewportScroll() {
  isScrollLocked = false;
  lockedScrolls = [];
  setPageScrollLock(false); // 物理释放原生 API
  console.log("[Gemini Chat Canvas] Scroll unlocked.");
}

// 6. 初始化侧边栏 DOM 及注册事件
function initSidebar() {
  if (document.getElementById('gcc-sidebar')) return;
  
  // A. 创建悬浮折叠把手
  const toggleBtn = document.createElement('button');
  toggleBtn.id = 'gcc-toggle-btn';
  toggleBtn.innerHTML = `
    <svg class="gcc-btn-sparkle" viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M12 2C12 2 12.3 8.3 15.6 11.4C18.7 14.5 22 12 22 12C22 12 15.7 12.3 12.6 15.6C9.5 18.7 12 22 12 22C12 22 11.7 15.7 8.4 12.6C5.3 9.5 2 12 2 12C2 12 8.3 11.7 11.4 8.4C14.5 5.3 12 2 12 2Z" fill="url(#gcc-btn-sparkle-grad)"/>
      <defs>
        <linearGradient id="gcc-btn-sparkle-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
          <stop offset="0%" stop-color="#9bc5ff"/>
          <stop offset="30%" stop-color="#2b66ff"/>
          <stop offset="70%" stop-color="#ff7da7"/>
          <stop offset="100%" stop-color="#fcd06a"/>
        </linearGradient>
      </defs>
    </svg>
  `;
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
        <h3 class="gcc-title">
          <svg class="gcc-gemini-logo" viewBox="0 0 24 24" width="20" height="20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M12 2C12 2 12.3 8.3 15.6 11.4C18.7 14.5 22 12 22 12C22 12 15.7 12.3 12.6 15.6C9.5 18.7 12 22 12 22C12 22 11.7 15.7 8.4 12.6C5.3 9.5 2 12 2 12C2 12 8.3 11.7 11.4 8.4C14.5 5.3 12 2 12 2Z" fill="url(#gemini-logo-grad)"/>
            <defs>
              <linearGradient id="gemini-logo-grad" x1="2" y1="2" x2="22" y2="22" gradientUnits="userSpaceOnUse">
                <stop offset="0%" stop-color="#9bc5ff"/>
                <stop offset="30%" stop-color="#2b66ff"/>
                <stop offset="70%" stop-color="#ff7da7"/>
                <stop offset="100%" stop-color="#fcd06a"/>
              </linearGradient>
            </defs>
          </svg>
          <span>Gemini 对话画布</span>
        </h3>
        <button class="gcc-close-btn" id="gcc-close-btn">✕</button>
      </div>
      
      <div class="gcc-tabs">
        <button class="gcc-tab-btn active" id="gcc-tab-btn-shelf" data-tab="shelf">
          📌 留存区
        </button>
        <button class="gcc-tab-btn" id="gcc-tab-btn-thread" data-tab="thread">
          💬 讨论区
        </button>
      </div>
    </div>

    <!-- 暂存架主面板 -->
    <div class="gcc-pane active" id="gcc-pane-shelf">
      <div class="gcc-shelf-tools">
        <button class="gcc-btn gcc-btn-primary gcc-btn-large" id="gcc-optimize-btn">✨ 智能聚合优化</button>
        <div class="gcc-tools-subrow">
          <button class="gcc-btn gcc-btn-secondary gcc-btn-small" id="gcc-export-btn">📥 导出片段</button>
          <button class="gcc-btn gcc-btn-danger gcc-btn-small" id="gcc-clear-btn">🗑️ 一键清空</button>
        </div>
      </div>
      <div class="gcc-shelf" id="gcc-shelf">
        <div class="gcc-shelf-empty">
          <span>📌</span>
          暂无留存步骤<br>在网页列表中悬浮并点击“留存步骤”添加
        </div>
      </div>
    </div>

    <!-- 讨论区主面板 -->
    <div class="gcc-pane" id="gcc-pane-thread">
      <div class="gcc-thread">
        <!-- 讨论上下文小字标签，收起高度节省空间 -->
        <div class="gcc-context-tag" id="gcc-context-tag">📌 讨论上下文: 尚未选择步骤</div>
        
        <!-- 讨论历史看板：支持多轮对话 -->
        <div class="gcc-thread-log" id="gcc-thread-log">
          <div class="gcc-thread-log-empty" id="gcc-thread-log-empty">
            <span>💬</span>
            没有讨论记录<br>在网页列表中悬浮并点击“讨论步骤”发起追问
          </div>
          <!-- 对话气泡列表会动态插入到这里 -->
        </div>
        
        <div class="gcc-input-container">
          <button class="gcc-input-action-btn" id="gcc-input-add-btn" title="快捷添加工具">
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <line x1="12" y1="5" x2="12" y2="19"></line>
              <line x1="5" y1="12" x2="19" y2="12"></line>
            </svg>
          </button>
          <div class="gcc-input-wrapper">
            <textarea class="gcc-input" id="gcc-thread-input" placeholder="问问 Gemini..." disabled></textarea>
            <button class="gcc-input-btn" id="gcc-thread-send-btn" disabled>
              <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <line x1="22" y1="2" x2="11" y2="13"></line>
                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  `;
  
  document.body.appendChild(sidebar);
  
  // C. 绑定基础事件监听器
  document.getElementById('gcc-close-btn').addEventListener('click', closeSidebar);
  document.getElementById('gcc-export-btn').addEventListener('click', exportSnippets);
  document.getElementById('gcc-optimize-btn').addEventListener('click', optimizeAggregated);
  document.getElementById('gcc-clear-btn').addEventListener('click', clearShelf);
  
  const addBtn = document.getElementById('gcc-input-add-btn');
  if (addBtn) {
    addBtn.addEventListener('click', () => {
      showToast("💡 快捷功能正在路上，敬请期待！");
    });
  }
  
  // E. 绑定子页签切换监听
  const shelfBtn = document.getElementById('gcc-tab-btn-shelf');
  const threadBtn = document.getElementById('gcc-tab-btn-thread');
  shelfBtn.addEventListener('click', () => switchTab('shelf'));
  threadBtn.addEventListener('click', () => switchTab('thread'));
  
  const threadInput = document.getElementById('gcc-thread-input');
  const threadSendBtn = document.getElementById('gcc-thread-send-btn');
  
  // 动态更新发送按钮启用状态
  const updateSendBtnState = () => {
    const hasText = threadInput.value.trim().length > 0;
    threadSendBtn.disabled = !hasText || !activeDiscussionItem;
  };
  threadInput.addEventListener('input', updateSendBtnState);
  
  // D. 绑定局部讨论发送逻辑 (功能 1)
  const sendDiscussion = () => {
    const text = threadInput.value.trim();
    if (!text || !activeDiscussionItem) return;
    
    // 采用极度严密的 XML 标签 and 三引号隔离提示词，防止 Gemini 对短句/疑问句产生“聚合优化”误判
    const prompt = `【局部讨论上下文（仅作为参考背景，不要对其进行全文重组或聚合文档生成）】\n"""\n${activeDiscussionItem}\n"""\n\n【用户对上述上下文的疑问/微调指令】\n"${text}"\n\n【回答要求】\n请严格只针对用户的具体问题进行直接、精准、简明扼要的回答，切勿进行任何无意义的信息聚合、格式重排、长文润色或多余 of 去重整理！`;
    
    if (setGeminiInputText(prompt)) {
      threadInput.value = '';
      threadInput.disabled = true; // 正在生成回复时禁用输入框，防范二次重发
      threadInput.placeholder = "AI 正在回答中，请稍候...";
      threadSendBtn.disabled = true; // 发送后重置为禁用状态
      
      const logEl = document.getElementById('gcc-thread-log');
      if (logEl) {
        // 隐藏空状态
        const emptyState = document.getElementById('gcc-thread-log-empty');
        if (emptyState) emptyState.style.display = 'none';
        
        // 创建并插入用户问题气泡
        const userBubble = document.createElement('div');
        userBubble.className = 'gcc-chat-bubble user';
        userBubble.innerHTML = `<div class="gcc-bubble-content">${escapeHtml(text)}</div>`;
        logEl.appendChild(userBubble);
        
        // 创建并插入 AI 等待气泡（包含 Gemini 星星 SVG 头像，使用全局渐变 ID）
        const aiBubble = document.createElement('div');
        aiBubble.className = 'gcc-chat-bubble ai pending';
        aiBubble.innerHTML = `
          <div class="gcc-ai-header">
            <svg class="gcc-sparkle-icon" viewBox="0 0 24 24" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M12 2C12 2 12.3 8.3 15.6 11.4C18.7 14.5 22 12 22 12C22 12 15.7 12.3 12.6 15.6C9.5 18.7 12 22 12 22C12 22 11.7 15.7 8.4 12.6C5.3 9.5 2 12 2 12C2 12 8.3 11.7 11.4 8.4C14.5 5.3 12 2 12 2Z" fill="url(#gemini-logo-grad)"/>
            </svg>
            <span>Gemini</span>
          </div>
          <div class="gcc-bubble-content gcc-ai-content">🤖 正在等候 AI 响应并在此处同步...</div>
        `;
        logEl.appendChild(aiBubble);
        
        // 强制下滚至底部
        setTimeout(() => { logEl.scrollTop = logEl.scrollHeight; }, 10);
      }
      
      // 记录发送前的消息总数，以精确区分 Gemini 的新答复和历史旧答复
      initialRepliesCount = document.querySelectorAll('message-content, .message-content, div[class*="message-content"], div[class*="reply"]').length;
      
      // 重置并启动同步和文字稳定性跟踪状态
      isWaitingForDiscussionReply = true;
      hasStartedGenerating = false;
      lastCapturedText = "";
      lastChangeTime = Date.now();
      
      // 开启滚动锁定以完全阻止主页面滚走
      if (activeDiscussionLi) {
        lockViewportScroll(activeDiscussionLi);
      }
      
      showToast("🚀 讨论指令已载入并自动发送！");
      clickGeminiSend();
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
  
  const retainBtn = widget.querySelector('.gcc-btn-retain');
  const discussBtn = widget.querySelector('.gcc-btn-discuss');
  const hideBtn = widget.querySelector('.gcc-btn-hide');
  
  // 鼠标按下那一刻极速捕获当前页面用户划选的蓝条选区，防范点击移走焦点造成划词丢失
  const captureSelection = () => {
    const sel = window.getSelection().toString().trim();
    if (sel.length > 0) {
      capturedSelectionText = sel;
      console.log("[Gemini Chat Canvas] Captured cursor selection text:", sel);
    } else {
      capturedSelectionText = "";
    }
  };
  
  retainBtn.addEventListener('mousedown', captureSelection);
  discussBtn.addEventListener('mousedown', captureSelection);
  
  // 捕获干净的文本内容，移除按钮文本干扰（如果用户手动划选了部分文字，则优先以选中的划词作为讨论上下文）
  const getCleanText = () => {
    if (capturedSelectionText) {
      const selected = capturedSelectionText;
      capturedSelectionText = ""; // 消费后即重置
      return selected;
    }
    
    let clonedLi = li.cloneNode(true);
    const widgetInClone = clonedLi.querySelector('.gcc-hover-widget');
    if (widgetInClone) widgetInClone.remove();
    return clonedLi.textContent.trim();
  };
  
  // 绑定挂件按钮动作事件
  retainBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    retainSnippet(getCleanText());
  });
  
  discussBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    startDiscussion(getCleanText(), li);
  });
  
  hideBtn.addEventListener('click', (e) => {
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

// 子页签自由切换逻辑
function switchTab(tabName) {
  const shelfBtn = document.getElementById('gcc-tab-btn-shelf');
  const threadBtn = document.getElementById('gcc-tab-btn-thread');
  const shelfPane = document.getElementById('gcc-pane-shelf');
  const threadPane = document.getElementById('gcc-pane-thread');
  
  if (!shelfBtn || !threadBtn || !shelfPane || !threadPane) return;
  
  if (tabName === 'shelf') {
    shelfBtn.classList.add('active');
    threadBtn.classList.remove('active');
    shelfPane.classList.add('active');
    threadPane.classList.remove('active');
  } else if (tabName === 'thread') {
    shelfBtn.classList.remove('active');
    threadBtn.classList.add('active');
    shelfPane.classList.remove('active');
    threadPane.classList.add('active');
  }
}

// 功能 1：激活局部讨论面板并路由至讨论页签
function startDiscussion(content, li) {
  activeDiscussionItem = content;
  activeDiscussionLi = li;
  openSidebar();
  switchTab('thread');
  
  const contextEl = document.getElementById('gcc-context-tag');
  const threadInput = document.getElementById('gcc-thread-input');
  const threadSendBtn = document.getElementById('gcc-thread-send-btn');
  
  if (contextEl) {
    contextEl.textContent = `📌 讨论上下文: "${content}"`;
    contextEl.title = content; // 悬停气泡提示完整内容
  }
  
  // 强力重置前一轮讨论的等待状态与可能残留的滚动物理锁
  isWaitingForDiscussionReply = false;
  unlockViewportScroll();
  hasStartedGenerating = false;
  lastCapturedText = "";
  
  threadInput.value = '';
  threadInput.disabled = false;
  threadSendBtn.disabled = true; // 初始为空，置灰禁用
  threadInput.placeholder = "输入您的问题，Enter/发送按钮提交给 AI...";
  threadInput.focus();
  
  // 初始化清理历史记录，呈现空讨论看板
  const logEl = document.getElementById('gcc-thread-log');
  if (logEl) {
    const emptyState = document.getElementById('gcc-thread-log-empty');
    logEl.innerHTML = '';
    if (emptyState) {
      logEl.appendChild(emptyState);
      emptyState.style.display = 'flex';
    } else {
      logEl.innerHTML = `
        <div class="gcc-thread-log-empty" id="gcc-thread-log-empty">
          <span>💬</span>
          没有讨论记录<br>在网页列表中悬浮并点击“讨论步骤”发起追问
        </div>
      `;
    }
  }
}

// 功能 2：留存到“黄金暂存架”并自动切换到留存页签
function retainSnippet(content) {
  if (savedSnippets.includes(content)) {
    showToast("⚠️ 该片段已经在暂存架中！");
    switchTab('shelf');
    return;
  }
  
  savedSnippets.push(content);
  renderShelf();
  openSidebar();
  switchTab('shelf');
  showToast("📌 已成功留存至黄金暂存架！");
}

// 移除留存片段
function removeSnippet(index) {
  savedSnippets.splice(index, 1);
  renderShelf();
  showToast("🗑️ 片段已移出暂存架");
}

// 功能 7：一键清空黄金暂存架
function clearShelf() {
  if (savedSnippets.length === 0) {
    showToast("⚠️ 暂存架本就是空的！");
    return;
  }
  if (confirm("确定要清空黄金暂存架中的所有留存片段吗？")) {
    savedSnippets = [];
    renderShelf();
    showToast("🗑️ 暂存架已成功清空！");
  }
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

// 8. 实时同步 AI 回复文字到侧边栏局部讨论区 (双保险同步器)
function trackDynamicReply() {
  if (!isWaitingForDiscussionReply) return;
  
  // 寻找到页面中所有的回复内容容器
  const replies = document.querySelectorAll('message-content, .message-content, div[class*="message-content"], div[class*="reply"]');
  
  // 如果页面上的回复数量还没有增加，说明 AI 的新回复容器还没生成，继续等待，绝不提前抓取历史旧数据！
  if (replies.length <= initialRepliesCount) {
    return;
  }
  
  const latestReply = replies[replies.length - 1];
  if (!latestReply) return;
  
  let rawText = latestReply.textContent.trim();
  // 过滤自身按钮残留文本
  rawText = rawText.replace(/📌 留存步骤\s*💬 讨论步骤\s*❌ 隐藏步骤/g, '').trim();
  
  if (!rawText) return; // 新回复容器刚创建，但还没有内容文字，继续等待
  
  // 开始有字数了，初始化生成状态
  if (!hasStartedGenerating) {
    hasStartedGenerating = true;
    lastCapturedText = rawText;
    lastChangeTime = Date.now();
  }
  
  const pendingContent = document.querySelector('.gcc-chat-bubble.ai.pending .gcc-ai-content');
  if (pendingContent) {
    pendingContent.innerHTML = rawText.replace(/\n/g, '<br>');
    
    // 自动滚下日志区以保持显示最新的一句回答 (智能滚动锁定)
    const logEl = document.getElementById('gcc-thread-log');
    if (logEl) {
      const isNearBottom = logEl.scrollHeight - logEl.clientHeight - logEl.scrollTop < 60;
      if (isNearBottom) {
        logEl.scrollTop = logEl.scrollHeight;
      }
    }
  }
  
  // 实时执行视口滚动锁定以压制主站的自动下滚行为
  performScrollLock();
  
  // 文字稳定性监控：如果内容变化，更新时间戳；如果超过 3.5 秒内容不变，则视为输出完毕，切断同步通道并去除 pending 标记
  if (rawText !== lastCapturedText) {
    lastCapturedText = rawText;
    lastChangeTime = Date.now();
  } else {
    if (Date.now() - lastChangeTime > 3500) {
      isWaitingForDiscussionReply = false;
      unlockViewportScroll(); // 接收完毕，释放滚动锁定
      
      const pendingBubble = document.querySelector('.gcc-chat-bubble.ai.pending');
      if (pendingBubble) {
        pendingBubble.classList.remove('pending');
      }
      
      // AI 回复完毕后重新激活输入框以允许用户继续追加追问
      const threadInput = document.getElementById('gcc-thread-input');
      const threadSendBtn = document.getElementById('gcc-thread-send-btn');
      if (threadInput) {
        threadInput.disabled = false;
        threadInput.placeholder = "输入微调或追问，Enter发送...";
        threadInput.focus();
      }
      if (threadSendBtn) {
        threadSendBtn.disabled = true; // 此时输入框已清空，重置发送按钮为禁用状态
      }
      
      showToast("✅ AI 回复接收完毕");
      console.log("[Gemini Chat Canvas] Synchronization stopped: reply output finalized.");
    }
  }
}

// 9. 实时扫描并注入 Hover 按钮挂件
function scanAndInject() {
  // 极度强健的匹配规则：抓取页面上所有的 ol li 和 ul li 元素
  const listItems = document.querySelectorAll('ol li, ul li');
  
  listItems.forEach(li => {
    // 1. 规避侧边栏自带的暂存架卡片列表
    if (li.closest('#gcc-sidebar')) return;
    
    // 2. 规避原站的左侧导航抽屉（避免在侧边导航菜单注入挂件）
    if (li.closest('nav, aside, [class*="navigation"], [class*="sidebar"], [class*="drawer"]')) return;
    
    // 2.5 过滤层级分类父节点（如果 li 里面还包含嵌套列表，则它只是大分类，跳过！）
    if (li.querySelector('ol, ul')) return;
    
    // 3. 过滤太短的内容节点，并进行挂件注入
    if (li.textContent.trim().length > 1) {
      injectWidgetToLi(li);
    }
  });
}

// 确认突变是否发生在插件自建节点内部，避免死循环突变
function isPluginMutation(target) {
  if (!target) return false;
  const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
  if (!element) return false;
  
  if (element.closest('#gcc-sidebar') || element.closest('#gcc-toast') || element.closest('.gcc-hover-widget')) {
    return true;
  }
  return false;
}

// 10. 开启 DOM 实时 MutationObserver 监测与周期扫描双保险
function startObserver() {
  // 初始化侧边栏和 Toast 节点
  initSidebar();
  scanAndInject();
  
  // 双保险机制 1：实时 DOM 变化监听（全面监听添加节点与文本更改）
  const observer = new MutationObserver((mutations) => {
    // 1. 过滤掉所有完全由插件本身引起的 DOM 变化，彻底防范死循环与内存崩溃
    let isPurePluginMutation = true;
    for (let mutation of mutations) {
      if (!isPluginMutation(mutation.target)) {
        isPurePluginMutation = false;
        break;
      }
    }
    if (isPurePluginMutation) {
      return; // 如果全是插件自建节点引发的变化，直接退出，绝对安全！
    }
    
    // 2. 检查是否有真实的页面内容节点变化，来决定是否触发注入
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
    
    // 3. 实时同步渲染讨论问答
    trackDynamicReply();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  
  // 双保险机制 2：周期性定时器自动兜底扫描（应对 SPA 路由无刷跳转及各种极端渲染延迟）
  setInterval(() => {
    scanAndInject();
    trackDynamicReply();
  }, 1000);
}

// 安全启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver);
} else {
  startObserver();
}
