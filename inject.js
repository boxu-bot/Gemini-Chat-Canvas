(function() {
  // 检测 DOM 属性锁
  const isScrollLocked = () => {
    return document.documentElement.hasAttribute('gcc-scroll-locked');
  };

  // A. 缓存原生浏览器滚动 API
  const originalScrollIntoView = Element.prototype.scrollIntoView;
  const originalScrollTo = Element.prototype.scrollTo;
  const originalScroll = Element.prototype.scroll;
  const originalWindowScrollTo = window.scrollTo;
  const originalWindowScroll = window.scroll;
  const originalWindowScrollBy = window.scrollBy;
  
  // B. 重写 Element 原型滚动方法
  Element.prototype.scrollIntoView = function(...args) {
    if (isScrollLocked()) {
      console.log("[Gemini Chat Canvas] Blocked scrollIntoView via DOM attribute lock.");
      return;
    }
    return originalScrollIntoView.apply(this, args);
  };
  
  Element.prototype.scrollTo = function(...args) {
    if (isScrollLocked()) return;
    return originalScrollTo.apply(this, args);
  };
  
  Element.prototype.scroll = function(...args) {
    if (isScrollLocked()) return;
    return originalScroll.apply(this, args);
  };
  
  // C. 重写 Window 原型/全局滚动方法
  window.scrollTo = function(...args) {
    if (isScrollLocked()) return;
    return originalWindowScrollTo.apply(this, args);
  };
  
  window.scroll = function(...args) {
    if (isScrollLocked()) return;
    return originalWindowScroll.apply(this, args);
  };
  
  window.scrollBy = function(...args) {
    if (isScrollLocked()) return;
    return originalWindowScrollBy.apply(this, args);
  };
  
  // D. 重写 Element.prototype.scrollTop Setter 属性
  const scrollTopDescriptor = Object.getOwnPropertyDescriptor(Element.prototype, 'scrollTop');
  if (scrollTopDescriptor && scrollTopDescriptor.set) {
    const originalSet = scrollTopDescriptor.set;
    Object.defineProperty(Element.prototype, 'scrollTop', {
      set: function(val) {
        if (isScrollLocked()) {
          // 允许侧边栏面板自身进行合理滚动以流式显示讨论内容
          if (this.id === 'gcc-thread-log' || this.closest('#gcc-sidebar')) {
            return originalSet.call(this, val);
          }
          return;
        }
        return originalSet.call(this, val);
      },
      get: scrollTopDescriptor.get,
      configurable: true
    });
  }
  
  console.log("[Gemini Chat Canvas] MAIN world scroll hijacker successfully loaded.");
})();
