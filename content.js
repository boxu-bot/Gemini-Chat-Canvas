// ==========================================================================
// Gemini 对画画布 (Gemini Chat Canvas) - 核心内容脚本
// ==========================================================================

// 暂存架状态管理
let savedSnippets = [];
let activeDiscussionItem = null;
let activeDiscussionLi = null;
let isWaitingForDiscussionReply = false;
let discussionTimeoutTimer = null; // 讨论响应超时监视器
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

// 5.8 视口滚动弹性物理弹簧机制 (Springy Rubber-Band Scroll Simulation with Hyperbolic Tangent)
function applySpringyScroll(element) {
  if (!element) return;
  
  let rawDisplacement = 0;
  let displacement = 0;
  let timer = null;
  let resetTimeout = null; // 用于精确取消的清理定时器
  
  // 阻尼系数
  const resistance = 0.15; 
  // 最大拉拽安全边界值
  const maxBounce = 45; 
  
  const resetSpring = () => {
    if (displacement === 0) return;
    
    // 如果有未完成的清理定时器，立即清除，避免冲突
    if (resetTimeout) {
      clearTimeout(resetTimeout);
    }
    
    // 使用高精度的 CSS 物理阻力弹簧回弹曲线
    element.style.transition = 'transform 0.4s cubic-bezier(0.175, 0.885, 0.32, 1.28)';
    element.style.transform = 'translateY(0)';
    rawDisplacement = 0;
    displacement = 0;
    
    // 动画结束后彻底清除 transition 和 transform，还原原生 Stacking Context，恢复极致顺滑点击与切换！
    resetTimeout = setTimeout(() => {
      element.style.transition = '';
      element.style.transform = '';
      resetTimeout = null;
    }, 400);
  };
  
  element.addEventListener('wheel', (e) => {
    const scrollTop = element.scrollTop;
    const scrollHeight = element.scrollHeight;
    const clientHeight = element.clientHeight;
    const isAtTop = scrollTop === 0;
    const isAtBottom = Math.ceil(scrollTop + clientHeight) >= scrollHeight;
    
    // 当在顶端继续向上滑，或在底端继续向下滑时，触发物理弹簧拉拽
    if ((isAtTop && e.deltaY < 0) || (isAtBottom && e.deltaY > 0)) {
      e.preventDefault();
      
      // 1. 如果正在执行回弹过渡，立即清除正在运行的清理定时器，实现无缝的中断重力拉拽
      if (resetTimeout) {
        clearTimeout(resetTimeout);
        resetTimeout = null;
      }
      
      // 2. 可中断性支持：读取当前的实时视觉 translateY 矩阵
      const computedStyle = window.getComputedStyle(element);
      const matrix = computedStyle.transform || computedStyle.webkitTransform;
      if (matrix && matrix !== 'none') {
        const values = matrix.split('(')[1].split(')')[0].split(',');
        const currentY = parseFloat(values[5]);
        if (!isNaN(currentY) && Math.abs(currentY - displacement) > 0.5) {
          displacement = currentY;
          // 反向还原出原始线性拉拽值，加入严格的安全边界夹持以彻底防范 NaN 与 Infinity 引起的卡顿突跳！
          const ratio = Math.max(-0.99, Math.min(0.99, displacement / maxBounce));
          rawDisplacement = maxBounce * Math.atanh(ratio);
          if (isNaN(rawDisplacement)) rawDisplacement = displacement;
        }
      }
      
      // 3. 擦除正在运行的 Transition 动画，防止浏览器发生缓动帧率死锁
      element.style.transition = 'none';
      
      // 4. 完美的双曲正切非线性弹性物理模型 (Hyperbolic Tangent Spring Physics)
      // 彻底杜绝硬夹持卡顿，呈现极度温和顺滑的拉伸体验
      rawDisplacement -= e.deltaY * resistance;
      displacement = maxBounce * Math.tanh(rawDisplacement / maxBounce);
      
      element.style.transform = `translateY(${displacement}px)`;
      element.style.transformOrigin = 'center';
      
      // 5. 重启 80ms 高连发防抖，极大缩短回弹前的静止等待卡顿时间，让弹性手感瞬发！
      clearTimeout(timer);
      timer = setTimeout(resetSpring, 80);
    }
  }, { passive: false });
}

// 5.9 输入框自适应高度伸缩引擎 (Textarea Auto-Grow Engine)
function adjustTextareaHeight(textarea) {
  if (!textarea) return;
  
  // 1. 临时重设为初始单行高度，防范删除文字时 scrollHeight 发生卡滞滞留
  textarea.style.height = '32px';
  
  const scrollHeight = textarea.scrollHeight;
  const maxHeight = 140; // 最大拉伸高度上限，约折合 6 行多
  
  if (scrollHeight > maxHeight) {
    textarea.style.height = `${maxHeight}px`;
    textarea.style.overflowY = 'auto'; // 达到最大高度后开启滚动条
  } else {
    // 动态撑开高度，使 capsule 圆角外壳同步发生高颜值顺滑胀大形变
    textarea.style.height = `${scrollHeight}px`;
    textarea.style.overflowY = 'hidden'; // 高度未达上限时隐蔽滚动条，保持极致清爽
  }
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
        <div class="gcc-context-tag" id="gcc-context-tag">📌 讨论上下文: 尚未选择内容</div>
        
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
            <textarea class="gcc-input" id="gcc-thread-input" placeholder="问问AI" disabled></textarea>
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
  
  // 动态更新发送按钮启用状态与滚动条可见性
  const updateSendBtnState = () => {
    const hasText = threadInput.value.trim().length > 0;
    threadSendBtn.disabled = !hasText || !activeDiscussionItem;
    
    // 自适应调控输入框的拉伸高度与滚动条开启状态
    adjustTextareaHeight(threadInput);
  };
  threadInput.addEventListener('input', updateSendBtnState);
  
  // D. 绑定局部讨论发送逻辑 (功能 1)
  const sendDiscussion = () => {
    const text = threadInput.value.trim();
    if (!text || !activeDiscussionItem) return;
    
    // 采用极度严密的 XML 标签 and 三引号隔离提示词，防止 Gemini 对短句/疑问句产生“聚合优化”误判
    const prompt = `【局部讨论上下文（仅作为参考背景，不要对其进行全文重组或聚合文档生成）】\n"""\n${activeDiscussionItem}\n"""\n\n【用户对上述上下文的疑问/微调指令】\n"${text}"\n\n【回答要求】\n请严格只针对用户的具体问题进行直接、精准、简明扼要 of 回答，切勿进行任何无意义的信息聚合、格式重排、长文润色或多余 of 去重整理！`;
    
    if (setGeminiInputText(prompt)) {
      threadInput.value = '';
      adjustTextareaHeight(threadInput); // 发送后重置高度为单行
      threadInput.disabled = true; // 正在生成回复时禁用输入框，防范二次重发
      threadInput.placeholder = "AI 正在回答中...";
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
      
      // 启动 60s 超时连接挂死监控
      clearTimeout(discussionTimeoutTimer);
      discussionTimeoutTimer = setTimeout(() => {
        handleDiscussionTimeout(prompt, text);
      }, 60000);
      
      showToast("🚀 讨论指令已载入并自动发送！");
      clickGeminiSend();
    }
  };

  // 🔄 超时重试讨论发送逻辑
  const retrySendDiscussion = (promptText, userText) => {
    // 移除超时失败的 AI 气泡
    const pendingBubble = document.querySelector('.gcc-chat-bubble.ai.pending');
    if (pendingBubble) {
      pendingBubble.remove();
    }
    
    if (setGeminiInputText(promptText)) {
      // 重新插入 AI 等待气泡
      const logEl = document.getElementById('gcc-thread-log');
      if (logEl) {
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
        logEl.scrollTop = logEl.scrollHeight;
      }
      
      // 重新设定 60s 超时监控
      clearTimeout(discussionTimeoutTimer);
      discussionTimeoutTimer = setTimeout(() => {
        handleDiscussionTimeout(promptText, userText);
      }, 60000);
      
      isWaitingForDiscussionReply = true;
      hasStartedGenerating = false;
      lastCapturedText = "";
      lastChangeTime = Date.now();
      
      // 开启滚动锁定以完全阻止主页面滚走
      if (activeDiscussionLi) {
        lockViewportScroll(activeDiscussionLi);
      }
      
      showToast("🔄 正在重新投喂尝试连接...");
      clickGeminiSend();
    }
  };

  // ⚠️ 讨论响应 60s 超时容错诊断处理器
  const handleDiscussionTimeout = (promptText, userText) => {
    if (!isWaitingForDiscussionReply || hasStartedGenerating) return;
    
    const pendingBubble = document.querySelector('.gcc-chat-bubble.ai.pending');
    if (pendingBubble) {
      const contentEl = pendingBubble.querySelector('.gcc-ai-content');
      if (contentEl) {
        // 渲染带有重试和取消按钮的超时警告
        contentEl.innerHTML = `
          <span class="gcc-timeout-warning">⚠️ <b>AI 响应超时。</b>网络连接卡滞或 Gemini 平台发生异常，请选择：</span>
          <div class="gcc-timeout-actions">
            <button class="gcc-btn gcc-timeout-retry-btn">🔄 一键重试</button>
            <button class="gcc-btn gcc-timeout-cancel-btn">❌ 放弃等待</button>
          </div>
        `;
        
        // 绑定一键重试点击逻辑
        contentEl.querySelector('.gcc-timeout-retry-btn').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          retrySendDiscussion(promptText, userText);
        });
        
        // 绑定放弃等待点击逻辑
        contentEl.querySelector('.gcc-timeout-cancel-btn').addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          
          // 彻底恢复状态机
          isWaitingForDiscussionReply = false;
          unlockViewportScroll();
          clearTimeout(discussionTimeoutTimer);
          discussionTimeoutTimer = null;
          
          // 将 pending 气泡转为已中止警告
          pendingBubble.classList.remove('pending');
          contentEl.innerHTML = `⚠️ <b>AI 响应超时。</b>已主动中止等待。`;
          
          // 极致体贴交互：自动将用户未发送成功的话退回到输入框，并聚焦激活！
          const threadInput = document.getElementById('gcc-thread-input');
          const threadSendBtn = document.getElementById('gcc-thread-send-btn');
          if (threadInput) {
            threadInput.disabled = false;
            threadInput.placeholder = "问问AI";
            threadInput.value = userText;
            adjustTextareaHeight(threadInput);
            threadInput.focus();
          }
          if (threadSendBtn) {
            threadSendBtn.disabled = false;
          }
          
          showToast("ℹ️ 已取消等待，问题已退回输入框");
        });
      }
    }
  };

  // 暴露给测试套件进行超时模拟与状态验证
  window.__handleDiscussionTimeout = handleDiscussionTimeout;
  window.__retrySendDiscussion = retrySendDiscussion;
  
  threadSendBtn.addEventListener('click', sendDiscussion);
  threadInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendDiscussion();
    }
  });
  
  // 绑定滚动弹性物理弹簧机制
  const shelf = document.getElementById('gcc-shelf');
  const logEl = document.getElementById('gcc-thread-log');
  applySpringyScroll(shelf);
  applySpringyScroll(logEl);

  // A2. 创建全局划词悬浮面板 (Floating Selection Tooltip Capsule)
  let selectionTooltip = document.createElement('div');
  selectionTooltip.id = 'gcc-selection-tooltip';
  selectionTooltip.className = 'gcc-selection-tooltip gcc-tooltip-hidden';
  selectionTooltip.innerHTML = `
    <button class="gcc-tooltip-btn gcc-tooltip-btn-retain" title="留存选中内容至侧边栏暂存架">📌 留存选中</button>
    <button class="gcc-tooltip-btn gcc-tooltip-btn-discuss" title="针对选中内容发起追问或讨论">💬 讨论选中</button>
  `;
  document.body.appendChild(selectionTooltip);
  
  // 绑定动作按钮事件
  selectionTooltip.querySelector('.gcc-tooltip-btn-retain').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selText = getActiveSelectionText();
    if (selText) {
      retainSnippet(selText);
      hideSelectionTooltip();
      window.getSelection().removeAllRanges(); // 消费后立刻清空蓝条选区，视觉效果极佳！
    }
  });
  
  selectionTooltip.querySelector('.gcc-tooltip-btn-discuss').addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    const selText = getActiveSelectionText();
    if (selText) {
      startDiscussion(selText, document.activeElement);
      hideSelectionTooltip();
      window.getSelection().removeAllRanges(); // 消费后立刻清空蓝条选区，聚焦讨论
    }
  });

  // 初始化全局划词监听器
  initSelectionListener();
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

// 7. 全局自由划词工具舱状态管理
let currentSelectionText = "";

function getActiveSelectionText() {
  return currentSelectionText;
}

function showSelectionTooltip(rect) {
  const tooltip = document.getElementById('gcc-selection-tooltip');
  if (!tooltip) return;
  
  tooltip.classList.remove('gcc-tooltip-hidden');
  tooltip.classList.add('gcc-tooltip-visible');
  
  // 计算居中位置
  const tooltipWidth = tooltip.offsetWidth || 192; // 估算宽度
  const tooltipHeight = tooltip.offsetHeight || 38; // 估算高度
  
  // 浮现在选区的正上方 8px
  const left = rect.left + rect.width / 2 - tooltipWidth / 2 + window.pageXOffset;
  const top = rect.top - tooltipHeight - 8 + window.pageYOffset;
  
  // 边界防溢出保护
  const safeLeft = Math.max(10, Math.min(window.innerWidth - tooltipWidth - 10, left));
  const safeTop = Math.max(10, top);
  
  tooltip.style.left = `${safeLeft}px`;
  tooltip.style.top = `${safeTop}px`;
}

function hideSelectionTooltip() {
  const tooltip = document.getElementById('gcc-selection-tooltip');
  if (tooltip) {
    tooltip.classList.remove('gcc-tooltip-visible');
    tooltip.classList.add('gcc-tooltip-hidden');
  }
  currentSelectionText = "";
}

// 绑定全局鼠标划词高亮监听器
function initSelectionListener() {
  // 鼠标抬起时，计算选区并弹出悬浮窗
  document.addEventListener('mouseup', (e) => {
    // 规避侧边栏或悬浮窗内部的操作，防止干扰
    if (e.target.closest('#gcc-sidebar') || e.target.closest('#gcc-selection-tooltip')) {
      return;
    }
    
    setTimeout(() => {
      const selection = window.getSelection();
      const text = selection.toString().trim();
      
      // 过滤掉长度过小的选区（防单点击）
      if (text.length > 1) {
        try {
          const range = selection.getRangeAt(0);
          const rect = range.getBoundingClientRect();
          
          // 确保选区具有真实的高宽
          if (rect.width > 2 && rect.height > 2) {
            currentSelectionText = text;
            showSelectionTooltip(rect);
          } else {
            hideSelectionTooltip();
          }
        } catch (err) {
          hideSelectionTooltip();
        }
      } else {
        hideSelectionTooltip();
      }
    }, 20);
  });
  
  // 鼠标按下时，若点击在悬浮窗外部，立刻关闭悬浮窗
  document.addEventListener('mousedown', (e) => {
    if (e.target.closest('#gcc-selection-tooltip')) {
      return;
    }
    hideSelectionTooltip();
  });
  
  // 监听页面滚动，实时动态调整划词悬浮窗的位置或隐蔽它以防飘移
  window.addEventListener('scroll', () => {
    hideSelectionTooltip();
  }, { passive: true });
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
  
  // 强力重置前一轮讨论的等待状态与可能残留的滚动物理锁与超时器
  isWaitingForDiscussionReply = false;
  unlockViewportScroll();
  if (discussionTimeoutTimer) {
    clearTimeout(discussionTimeoutTimer);
    discussionTimeoutTimer = null;
  }
  hasStartedGenerating = false;
  lastCapturedText = "";
  
  threadInput.value = '';
  adjustTextareaHeight(threadInput); // 初始化输入框为单行自适应高度
  threadInput.disabled = false;
  threadSendBtn.disabled = true; // 初始为空，置灰禁用
  threadInput.placeholder = "问问AI";
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
    
    // 成功连接并产生字符输出，立即清除 60s 挂死超时器
    if (discussionTimeoutTimer) {
      clearTimeout(discussionTimeoutTimer);
      discussionTimeoutTimer = null;
      console.log("[Gemini Chat Canvas] Generation started. Timeout timer cleared.");
    }
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
      
      // 成功结束，清理可能存在的超时器
      if (discussionTimeoutTimer) {
        clearTimeout(discussionTimeoutTimer);
        discussionTimeoutTimer = null;
      }
      
      const pendingBubble = document.querySelector('.gcc-chat-bubble.ai.pending');
      if (pendingBubble) {
        pendingBubble.classList.remove('pending');
      }
      
      // AI 回复完毕后重新激活输入框以允许用户继续追加追问
      const threadInput = document.getElementById('gcc-thread-input');
      const threadSendBtn = document.getElementById('gcc-thread-send-btn');
      if (threadInput) {
        threadInput.disabled = false;
        threadInput.placeholder = "问问AI";
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

// 确认突变是否发生在插件自建节点内部，避免死循环突变
function isPluginMutation(target) {
  if (!target) return false;
  const element = target.nodeType === Node.ELEMENT_NODE ? target : target.parentElement;
  if (!element) return false;
  
  if (element.closest('#gcc-sidebar') || element.closest('#gcc-toast') || element.closest('#gcc-selection-tooltip')) {
    return true;
  }
  return false;
}

// 10. 开启 DOM 实时 MutationObserver 监测与同步
function startObserver() {
  // 初始化侧边栏和 Toast 节点
  initSidebar();
  
  // DOM 变化监听（专注于流式回答同步，极大降低 CPU 功耗，页面运行速度飞跃提升！）
  const observer = new MutationObserver((mutations) => {
    // 过滤掉所有完全由插件本身引起的 DOM 变化
    let isPurePluginMutation = true;
    for (let mutation of mutations) {
      if (!isPluginMutation(mutation.target)) {
        isPurePluginMutation = false;
        break;
      }
    }
    if (isPurePluginMutation) {
      return;
    }
    
    // 实时同步渲染讨论问答文字流
    trackDynamicReply();
  });
  
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    characterData: true
  });
  
  // 定时器周期保活同步
  setInterval(() => {
    trackDynamicReply();
  }, 1000);
}

// 安全启动
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', startObserver);
} else {
  startObserver();
}
